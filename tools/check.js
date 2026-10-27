#!/usr/bin/env node
/* Diet AI — end-to-end checks. Not part of the site; nothing here is loaded by it.

   Run from the repo root against a local static server:
       npx http-server -p 8099 -s .   &
       node tools/check.js
   Needs Playwright with Chromium (preinstalled in Claude Code cloud sessions).

   Every request to the real analytics Worker is intercepted, and the Razorpay
   page is blocked, so a run can neither pollute funnel data nor take a payment.
   Exits non-zero if any check fails. */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const BASE = process.env.BASE || 'http://localhost:8099';
// The live dietai-events Worker's allow-list, read from its source 2026-10-26.
// Events outside it are rejected with a 400 and never stored.
const ALLOWED = ['page_view', 'plan_generated', 'premium_click', 'premium_unlocked', 'pack_opened'];
const GUIDES = ['indian-diet-plan-for-weight-loss', 'north-indian-diet-plan', 'south-indian-diet-plan',
  'east-indian-diet-plan', 'west-indian-diet-plan', 'central-indian-diet-plan', 'north-east-indian-diet-plan'];

let failed = 0;
const ok = (cond, label, detail) => {
  console.log((cond ? '  PASS ' : '  FAIL ') + label + (detail !== undefined ? '  — ' + detail : ''));
  if (!cond) failed++;
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const sent = [];
  await ctx.route('**://*.workers.dev/**', r => { try { sent.push(JSON.parse(r.request().postData())); } catch (e) {} r.fulfill({ status: 204, body: '' }); });
  await ctx.route('**://pages.razorpay.com/**', r => r.abort());
  await ctx.route('**://cdnjs.cloudflare.com/**', r => r.abort()); // decorative Three.js
  const errs = [];
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message));

  console.log('\nFunnel');
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  ok(await page.evaluate(() => typeof window.dietaiLog === 'function'), 'logger defined before the app runs');
  ok(!(await page.evaluate(() => !!document.querySelector('script[src*="premium.js"]'))), 'retired premium.js not loaded');
  await page.evaluate(() => { region = 'south'; diet = 'veg';
    document.getElementById('age').value = 32; document.getElementById('height').value = 175; document.getElementById('weight').value = 90; generatePlan(); });
  await page.waitForTimeout(300);
  ok(sent.some(e => e.event === 'plan_generated'), 'plan_generated sent');
  ok(await page.evaluate(() => document.querySelectorAll('#previewOut .pv-row').length >= 4), 'free Monday preview renders');
  ok(await page.evaluate(() => !!document.querySelector('#previewOut .pv-locked')), 'Tuesday–Sunday locked');
  await page.click('#payBtn').catch(() => {});
  await page.waitForTimeout(300);
  ok(sent.some(e => e.event === 'premium_click'), 'premium_click sent from the real CTA (#payBtn)');
  for (const pg of ctx.pages()) if (pg !== page) await pg.close();

  await page.goto(BASE + '/?premium=unlocked', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  ok(sent.some(e => e.event === 'premium_unlocked'), 'premium_unlocked sent before the URL is stripped');
  ok(!page.url().includes('premium='), 'unlock param stripped from the URL', page.url());
  ok(await page.isVisible('#premUnlocked'), 'paid section visible');
  ok(await page.evaluate(() => document.querySelectorAll('#weekOut details').length === 7), '7-day week built');
  await page.evaluate(() => { lastWeek = null; buildWeek(false); });
  await page.waitForTimeout(300); // beacons are async
  ok(sent.some(e => e.event === 'pack_opened'), 'pack_opened sent when the week is built');

  console.log('\nSaved plan must never override what is on screen (free and paid visitors)');
  // A non-veg East plan is saved; a vegetarian then opens the site from the South guide link.
  // Run as both a free and a paying visitor: each takes a different code path on load.
  for (const paid of [false, true]) {
    const who = paid ? 'paid' : 'free';
    await page.evaluate(p => { region = 'east'; diet = 'nonveg';
      document.getElementById('age').value = 30; document.getElementById('height').value = 170; document.getElementById('weight').value = 70;
      generatePlan(); p ? localStorage.setItem('dietai_premium', '1') : localStorage.removeItem('dietai_premium'); }, paid);
    await page.evaluate(() => { window.__stale = true; });
    // a unique query per run forces a real reload; same URL + #hash can be a same-page jump
    await page.goto(BASE + '/?region=south&run=' + who + '#planner', { waitUntil: 'networkidle' });
    ok(await page.evaluate(() => !window.__stale), `[${who}] page really reloaded`);
    const st = await page.evaluate(() => ({ region, diet, uiRegion: document.querySelector('#regionSeg button.on').dataset.region,
      uiDiet: document.querySelector('#dietSeg button.on').dataset.diet, paid: localStorage.getItem('dietai_premium') === '1' }));
    ok(st.paid === paid, `[${who}] visitor state set up`);
    ok(st.region === 'south' && st.uiRegion === 'south', `[${who}] URL region wins over the saved plan`, JSON.stringify(st));
    ok(st.diet === st.uiDiet, `[${who}] diet variable matches the highlighted button`, `${st.diet} vs ${st.uiDiet}`);
    const nv = await page.evaluate(() => { generatePlan();
      return { region: lastPlan.region, diet: lastPlan.diet, nonveg: buildDay(0, lastPlan.target, lastPlan.protein).meals.filter(m => m[2].g === 'n').map(m => m[2].t) }; });
    ok(nv.region === 'south' && nv.diet === 'veg' && nv.nonveg.length === 0, `[${who}] a Veg selection never produces non-veg meals`, JSON.stringify(nv));
  }
  await page.evaluate(() => localStorage.setItem('dietai_premium', '1'));

  console.log('\nProtein target across regions (top-up must close the gap)');
  const cases = [['north', 'nonveg', 'male', 32, 175, 90, 'lose'], ['south', 'veg', 'female', 45, 155, 95, 'lose'],
    ['east', 'egg', 'male', 25, 180, 65, 'gain'], ['west', 'veg', 'female', 30, 160, 52, 'maintain'],
    ['northeast', 'nonveg', 'male', 55, 168, 120, 'lose'], ['pan', 'veg', 'male', 19, 172, 48, 'gain'],
    ['central', 'egg', 'female', 60, 150, 78, 'lose']];
  for (const c of cases) {
    const r = await page.evaluate(([rg, dt, sx, a, h, w, gl]) => {
      region = rg; diet = dt; sex = sx; goal = gl;
      document.getElementById('age').value = a; document.getElementById('height').value = h; document.getElementById('weight').value = w;
      generatePlan();
      const d = buildDay(0, lastPlan.target, lastPlan.protein);
      let p = 0; d.meals.forEach(m => p += Math.round(m[2].p * d.scale));
      const t = topUp(lastPlan.protein - p, diet);
      return { goal: lastPlan.protein, final: p + (t ? t.got : 0) };
    }, c);
    ok(r.final >= r.goal - 8, `${c[0]}/${c[1]}/${c[2]}/${c[5]}kg`, `${r.final} g of ${r.goal} g`);
  }

  console.log('\nBad input is rejected, never silently clamped');
  for (const [age, h, w, field, why] of [[28, 170, 2, 'weight', 'weight 2 (typo for 72)'], [280, 170, 72, 'age', 'age 280 (typo for 28)'],
      [28, 17, 72, 'height', 'height 17 (typo for 170)'], [28, 1700, 72, 'height', 'height 1700'], [12, 150, 45, 'age', 'age 12 (a child)'],
      [17, 165, 55, 'age', 'age 17'], [30, 120, 290, 'weight', 'BMI over 80']]) {
    const r = await page.evaluate(([a, hh, ww]) => { const before = JSON.stringify(lastPlan);
      document.getElementById('age').value = a; document.getElementById('height').value = hh; document.getElementById('weight').value = ww;
      generatePlan(); return { changed: JSON.stringify(lastPlan) !== before, invalid: [...document.querySelectorAll('[aria-invalid="true"]')].map(e => e.id),
        toast: document.getElementById('toast').textContent }; }, [age, h, w]);
    ok(!r.changed && r.invalid.length === 1 && r.invalid[0] === field, `rejects ${why}, flags only that field`, `flags ${r.invalid.join(',') || 'nothing'}: "${r.toast.slice(0, 60)}"`);
  }
  const good = await page.evaluate(() => { document.getElementById('age').value = 18; document.getElementById('height').value = 170; document.getElementById('weight').value = 65;
    generatePlan(); return { age18: !!lastPlan && lastPlan.w === 65, flagged: document.querySelectorAll('[aria-invalid="true"]').length }; });
  ok(good.age18 && good.flagged === 0, 'accepts a valid 18-year-old and clears the error state');

  console.log('\nThe paid week uses every dish the data allows');
  const variety = await page.evaluate(() => {
    const bad = [];
    for (const rg of Object.keys(REGIONS)) for (const dt of ['veg', 'egg', 'nonveg']) for (const prot of [80, 140]) {
      const seen = { B: new Set(), L: new Set(), D: new Set(), S: new Set() }, keys = ['B', 'L', 'D', 'S'];
      for (let d = 0; d < 7; d++) buildDay(d, 2000, prot, rg, dt).meals.forEach((m, i) => seen[keys[i]].add(m[2].t));
      const tags = allowedTags(dt);
      keys.forEach(k => { const avail = Math.min(7, REGIONS[rg].meals[k].filter(m => tags.includes(m.g)).length);
        if (seen[k].size < avail) bad.push(`${rg}/${dt}/${prot}g ${k}: ${seen[k].size} of ${avail}`); });
    }
    return bad;
  });
  ok(variety.length === 0, 'every slot rotates through all allowed dishes over 7 days', variety.slice(0, 4).join('; ') || 'all slots full');

  console.log('\nPaying in the Razorpay tab unlocks the tab the customer started in');
  await page.evaluate(() => { localStorage.removeItem('dietai_premium'); localStorage.removeItem('dietai_ev_premium_unlocked'); });
  await page.goto(BASE + '/?run=xtab', { waitUntil: 'networkidle' });
  await page.evaluate(() => { document.getElementById('age').value = 30; document.getElementById('height').value = 170; document.getElementById('weight').value = 70; generatePlan(); });
  ok(await page.isVisible('#premLocked'), 'offer shown before payment');
  const payTab = await ctx.newPage();
  await payTab.goto(BASE + '/?premium=unlocked', { waitUntil: 'networkidle' });
  await page.bringToFront(); await page.waitForTimeout(700);
  ok(await page.isVisible('#premUnlocked') && !(await page.isVisible('#payBtn')), 'original tab unlocks, pay button gone');
  ok(await page.evaluate(() => document.querySelectorAll('#weekOut details').length === 7), 'original tab builds the week');
  await payTab.close();

  console.log('\nGrocery list');
  const junk = await page.evaluate(() => { region = 'east'; diet = 'nonveg'; generatePlan(); lastWeek = null; buildWeek(true);
    return [...document.querySelectorAll('#weekOut .gro-row')].map(r => r.textContent).filter(t => /NaN|undefined|uava|× 0|\b0 g\b/.test(t)); });
  ok(junk.length === 0, 'no malformed rows', junk.join(' | ') || 'none');

  console.log('\nAccessibility');
  const a11y = await page.evaluate(() => {
    const name = el => (el.getAttribute('aria-label') || '').trim() || (el.labels && el.labels[0] ? el.labels[0].textContent.trim() : '') || el.textContent.trim();
    return {
      inputs: [...document.querySelectorAll('input,select')].filter(el => el.type !== 'hidden' && !name(el)).map(el => el.id),
      buttons: [...document.querySelectorAll('button,a.btn')].filter(el => el.offsetParent !== null && !name(el)).length,
      pressed: [...document.querySelectorAll('#goalSeg button,#dietSeg button,#sexSeg button,#regionSeg button')].filter(b => !b.hasAttribute('aria-pressed')).length,
      tabs: document.querySelectorAll('[role="tab"][aria-selected]').length };
  });
  ok(a11y.inputs.length === 0, 'every input has an accessible name', a11y.inputs.join(',') || 'all named');
  ok(a11y.buttons === 0, 'every visible button has a name');
  ok(a11y.pressed === 0, 'every toggle reports aria-pressed');
  ok(a11y.tabs === 2, 'tabs expose aria-selected');

  console.log('\nPrint (the paid pack)');
  await page.evaluate(() => document.querySelectorAll('#weekOut details').forEach(d => d.open = true));
  await page.emulateMedia({ media: 'print' });
  const pr = await page.evaluate(() => {
    const shown = s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none'; };
    return { leaks: ['header', '.hero', '.app', '.faq', 'footer', '#payBtn', '.prem h2', '#premUnlocked>.btn'].filter(shown),
      pack: shown('#weekOut') && shown('#printHead'), ink: getComputedStyle(document.querySelector('#weekOut .wd-body b')).color };
  });
  await page.emulateMedia({ media: 'screen' });
  ok(pr.leaks.length === 0, 'no marketing elements print', pr.leaks.join(',') || 'none');
  ok(pr.pack, 'plan and print header print');
  ok(pr.ink === 'rgb(17, 17, 17)', 'plan text prints dark', pr.ink);

  console.log('\nGuides');
  for (const slug of GUIDES) {
    const g = await ctx.newPage();
    g.on('pageerror', e => errs.push(slug + ': ' + e.message));
    const res = await g.goto(`${BASE}/${slug}/`, { waitUntil: 'networkidle' });
    const i = await g.evaluate(() => {
      const ld = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
      return { faqMatch: ld.find(x => x['@type'] === 'FAQPage').mainEntity.length === document.querySelectorAll('details').length,
        tables: document.querySelectorAll('table').length, junk: /NaN|undefined|\[object/.test(document.body.innerText),
        canonical: document.querySelector('link[rel=canonical]').href };
    });
    ok(res.status() === 200 && i.faqMatch && i.tables === 2 && !i.junk && i.canonical.endsWith('/' + slug + '/'), '/' + slug + '/');
    await g.close();
  }
  await page.goto(`${BASE}/south-indian-diet-plan/`, { waitUntil: 'networkidle' });
  await page.click('.cta .btn'); await page.waitForLoadState('networkidle');
  ok(await page.evaluate(() => region === 'south' && document.querySelector('#regionSeg button.on').dataset.region === 'south'), 'guide CTA opens the planner preset to its region');
  const sm = await (await page.request.get(BASE + '/sitemap.xml')).text();
  ok(GUIDES.every(s => sm.includes(`https://dietai.in/${s}/`)), 'sitemap lists every guide');
  for (const f of ['/robots.txt', '/sitemap.xml']) ok((await page.request.get(BASE + f)).status() === 200, f + ' served');

  console.log('\nEvents vs the live Worker allow-list');
  const names = [...new Set(sent.map(e => e.event))].sort();
  names.forEach(n => console.log('  ' + (ALLOWED.includes(n) ? 'accepted ' : 'REJECTED ') + n));
  ['page_view', 'plan_generated', 'premium_click', 'premium_unlocked', 'pack_opened']
    .forEach(n => ok(names.includes(n), 'core funnel event fires: ' + n));

  console.log('\nPage errors');
  ok(errs.length === 0, 'no uncaught errors', errs.join(' | ') || 'none');

  await browser.close();
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})();
