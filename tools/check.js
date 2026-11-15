#!/usr/bin/env node
/* Diet AI — end-to-end checks. Not part of the site; nothing here is loaded by it.

   Run from the repo root against a local static server:
       npx http-server -p 8099 -s .   &
       node tools/check.js
   Needs Playwright with Chromium (preinstalled in Claude Code cloud sessions).

   What runs for real: the site, and the Worker's own code (worker/index.js), called in
   this process for every request the page makes to dietai-events. What is faked:
   Razorpay's servers and its checkout window (tools/fake-razorpay.js), which sign
   payments exactly as Razorpay documents — HMAC-SHA256 of "order_id|payment_id" with a
   key secret generated fresh for this run. Nothing can reach the live Worker, the live
   funnel data or a real payment. Exits non-zero if any check fails. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { createFakeRazorpay, createFakeD1, CHECKOUT_JS, rid } = require('./fake-razorpay');

const BASE = process.env.BASE || 'http://localhost:8099';
const WORKER = 'https://dietai-events.sudhanshuxg.workers.dev';
const GUIDES = ['indian-diet-plan-for-weight-loss', 'north-indian-diet-plan', 'south-indian-diet-plan',
  'east-indian-diet-plan', 'west-indian-diet-plan', 'central-indian-diet-plan', 'north-east-indian-diet-plan'];
const CAL_PAGES = [1200, 1500, 1800, 2000];
const TOKEN_RE = /^v1\.pay_[A-Za-z0-9]{6,40}\.\d{9,11}\.[a-f0-9]{64}$/;

let failed = 0;
const ok = (cond, label, detail) => {
  console.log((cond ? '  PASS ' : '  FAIL ') + label + (detail !== undefined ? '  — ' + detail : ''));
  if (!cond) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* A crash inside one section is reported as a failure and the run carries on. */
async function section(title, fn) {
  console.log('\n' + title);
  try { await fn(); } catch (e) { ok(false, 'section crashed', String(e && e.message || e).split('\n')[0].slice(0, 160)); }
}

(async () => {
  const worker = (await import(pathToFileURL(path.join(__dirname, '..', 'worker', 'index.js')).href)).default;
  const KEY_ID = 'rzp_test_' + crypto.randomBytes(7).toString('hex');
  const KEY_SECRET = crypto.randomBytes(24).toString('base64url');
  const rz = createFakeRazorpay({ keyId: KEY_ID, keySecret: KEY_SECRET });
  rz.install();
  const db = createFakeD1();
  const ENV = { EVENTS: db, ADMIN_KEY: 'local-admin', RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET };
  const ENV_OFF = { EVENTS: db, ADMIN_KEY: 'local-admin' };
  let workerEnv = ENV;
  const call = async (pathname, body, o = {}) => {
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': o.ip || '10.9.9.9' };
    if (o.origin !== null) headers.Origin = o.origin || 'http://localhost:8099';
    const method = o.method || 'POST';
    const res = await worker.fetch(new Request(WORKER + pathname, { method, headers, body: method === 'POST' ? JSON.stringify(body || {}) : undefined }), o.env || ENV);
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch (e) {}
    return { status: res.status, data, text, headers: res.headers };
  };
  // This suite runs on test keys, so its sales are logged as payment_verified_test.
  const paidRows = (pid, ev = 'payment_verified_test') => db.rows.filter((r) => r.event === ev && String(r.meta).includes(pid));

  // ================================================================ Worker
  console.log('\nWorker: health and switches');
  let r = await call('/api/health', null, { method: 'GET' });
  ok(r.status === 200 && r.data.payments.configured === true && r.data.payments.mode === 'test', 'health reports payments on, test mode', JSON.stringify(r.data.payments));
  ok(!r.text.includes(KEY_SECRET), 'health never contains the key secret');
  r = await call('/api/health', null, { method: 'GET', env: ENV_OFF });
  ok(r.data.payments.configured === false && r.data.payments.mode === 'off', 'health reports payments off when keys are missing');
  r = await call('/pay/order', {}, { env: ENV_OFF });
  ok(r.status === 503 && r.data.error === 'payments_not_configured', 'pay endpoints answer 503 until the keys are set');
  r = await call('/pay/order', null, { method: 'GET' });
  ok(r.status === 405, 'GET on a pay endpoint is refused');

  console.log('\nWorker: order creation — the price is set by the server, never the page');
  r = await call('/pay/order', { amount: 1, region: 'south', diet: 'veg<script>' });
  const sentOrder = rz.calls.filter((c) => c.path === '/orders').pop();
  ok(r.status === 200 && /^order_/.test(r.data.order_id), 'order created', r.data.order_id);
  ok(sentOrder.body.amount === 9900 && sentOrder.body.currency === 'INR', 'Razorpay asked for exactly ₹99 even though the page sent amount=1', JSON.stringify({ amount: sentOrder.body.amount }));
  ok(sentOrder.body.notes.product === 'dietai' && sentOrder.body.notes.diet === 'vegscript', 'order tagged as Diet AI; page-supplied notes sanitised', JSON.stringify(sentOrder.body.notes));
  ok(sentOrder.body.receipt.length <= 40, 'receipt within Razorpay\'s 40-character limit', sentOrder.body.receipt);
  ok(r.data.key_id === KEY_ID && !r.text.includes(KEY_SECRET), 'response carries the public key id, never the secret');

  console.log('\nWorker: verifying a payment');
  const order1 = r.data.order_id;
  const p1 = rz.pay(order1, 'success');
  r = await call('/pay/verify', { order_id: order1, payment_id: p1.payment_id, signature: p1.signature });
  ok(r.status === 200 && TOKEN_RE.test(r.data.token || ''), 'genuine Razorpay signature → unlock token', (r.data.token || '').slice(0, 32) + '…');
  const token1 = r.data.token;
  ok(paidRows(p1.payment_id).length === 1, 'server records the sale (test keys → payment_verified_test, never a real sale)');
  r = await call('/pay/verify', { order_id: order1, payment_id: p1.payment_id, signature: p1.signature });
  ok(r.status === 200 && paidRows(p1.payment_id).length === 1, 'repeat confirmation does not double-count the sale');
  const bad = (p1.signature[0] === 'a' ? 'b' : 'a') + p1.signature.slice(1);
  r = await call('/pay/verify', { order_id: order1, payment_id: p1.payment_id, signature: bad });
  ok(r.status === 400 && r.data.error === 'bad_signature' && !r.data.token, 'one altered character in the signature → rejected, no token');
  const forged = crypto.createHmac('sha256', 'not-the-secret').update(order1 + '|' + p1.payment_id).digest('hex');
  r = await call('/pay/verify', { order_id: order1, payment_id: p1.payment_id, signature: forged });
  ok(r.status === 400 && !r.data.token, 'signature made with a guessed secret → rejected');
  const orderX = (await call('/pay/order', {})).data.order_id;
  r = await call('/pay/verify', { order_id: orderX, payment_id: p1.payment_id, signature: rz.sign(orderX, p1.payment_id) });
  ok(r.status === 400 && r.data.error === 'order_mismatch', 'a real payment cannot be replayed against another order', r.data.error);
  r = await call('/pay/verify', { order_id: 'order_x', payment_id: 'pay_<x>', signature: 'zz' });
  ok(r.status === 400 && r.data.error === 'bad_request', 'malformed IDs rejected before any work');
  const orderA = (await call('/pay/order', {})).data.order_id;
  const pA = rz.pay(orderA, 'authorized');
  r = await call('/pay/verify', { order_id: orderA, payment_id: pA.payment_id, signature: pA.signature });
  ok(r.status === 200 && rz.payments.get(pA.payment_id).status === 'captured' && rz.calls.some((c) => c.path === '/payments/' + pA.payment_id + '/capture'),
    'authorized (held) payment is captured so Razorpay does not auto-refund it');

  console.log('\nWorker: order status — for when the UPI app took over the phone');
  const orderP = (await call('/pay/order', {})).data.order_id;
  r = await call('/pay/status', { order_id: orderP });
  ok(r.data.paid === false && r.data.state === 'no_attempt', 'unpaid order: no_attempt');
  const pP = rz.pay(orderP, 'pending');
  r = await call('/pay/status', { order_id: orderP });
  ok(r.data.paid === false && r.data.state === 'created', 'UPI request out, not approved: created (keep waiting)');
  rz.payments.get(pP.payment_id).status = 'captured';
  r = await call('/pay/status', { order_id: orderP });
  ok(r.data.paid === true && TOKEN_RE.test(r.data.token || '') && paidRows(pP.payment_id).length === 1, 'approved → paid, token issued, sale recorded once');
  const orderF = (await call('/pay/order', {})).data.order_id;
  rz.pay(orderF, 'fail');
  r = await call('/pay/status', { order_id: orderF });
  ok(r.data.paid === false && r.data.state === 'failed' && r.data.reason === 'payment_timed_out', 'failed UPI payment reported with its reason', r.data.reason);

  console.log('\nWorker: restore from a payment ID');
  const pagePay = rz.addPayment({ notes: { email: 'buyer@example.com', phone: '+910000000000' } }); // old payment page: no product note
  r = await call('/pay/restore', { payment_id: pagePay.id });
  ok(r.status === 200 && TOKEN_RE.test(r.data.token || ''), 'a ₹99 payment from the old Razorpay payment page restores');
  const cf = rz.addPayment({ amount: 49900, notes: { product: 'claimfight' } });
  r = await call('/pay/restore', { payment_id: cf.id });
  ok(r.status === 404, 'a ClaimFight (₹499) payment does not unlock Diet AI');
  const otherProduct = rz.addPayment({ notes: { product: 'claimfight' } }); // ₹99, but tagged for another product
  r = await call('/pay/restore', { payment_id: otherProduct.id });
  ok(r.status === 404, 'a ₹99 payment tagged for another product does not unlock Diet AI');
  const cheap = rz.addPayment({ amount: 100, notes: { product: 'dietai' } }); // checkout opened with the public key and a made-up ₹1
  r = await call('/pay/restore', { payment_id: cheap.id });
  ok(r.status === 404, 'a ₹1 payment that claims to be Diet AI does not unlock');
  const refunded = rz.addPayment({ amount_refunded: 9900, refund_status: 'full' });
  r = await call('/pay/restore', { payment_id: refunded.id });
  ok(r.status === 410 && r.data.error === 'refunded', 'refunded payment does not unlock');
  const failedPay = rz.addPayment({ status: 'failed', captured: false });
  r = await call('/pay/restore', { payment_id: failedPay.id });
  ok(r.status === 402 && r.data.error === 'not_paid', 'failed payment does not unlock');
  r = await call('/pay/restore', { payment_id: rid('pay') });
  ok(r.status === 404, 'unknown payment ID → not found');

  console.log('\nWorker: unlock tokens');
  r = await call('/pay/check', { token: token1 });
  ok(r.data.ok === true && r.data.payment_id === p1.payment_id, 'issued token checks out');
  const parts = token1.split('.');
  r = await call('/pay/check', { token: [parts[0], parts[1], String(Number(parts[2]) + 1), parts[3]].join('.') });
  ok(r.data.ok === false, 'token with an edited timestamp fails');
  r = await call('/pay/check', { token: [parts[0], rid('pay'), parts[2], parts[3]].join('.') });
  ok(r.data.ok === false, 'token moved to another payment ID fails');
  r = await call('/pay/check', { token: token1 }, { env: Object.assign({}, ENV, { RAZORPAY_KEY_SECRET: 'rotated' }) });
  ok(r.data.ok === false, 'tokens die with a rotated Razorpay secret (the page re-issues from the payment ID)');

  console.log('\nWorker: who may call it');
  const LIVE = Object.assign({}, ENV, { RAZORPAY_KEY_ID: 'rzp_live_' + KEY_ID.slice(9) });
  r = await call('/pay/check', { token: token1 }, { env: LIVE, origin: 'http://localhost:8099' });
  ok(r.status === 403 && r.data.error === 'origin_not_allowed', 'live keys: a page that is not dietai.in is refused');
  r = await call('/pay/check', { token: token1 }, { env: LIVE, origin: null });
  ok(r.status === 403, 'live keys: a request with no Origin (script, bot) is refused');
  r = await call('/pay/check', { token: token1 }, { env: LIVE, origin: 'https://dietai.in' });
  ok(r.status === 200 && r.headers.get('Access-Control-Allow-Origin') === 'https://dietai.in', 'live keys: dietai.in allowed, CORS header set');
  ok(!db.rows.some((x) => x.event === 'payment_verified'), 'no test-key payment was ever logged as a real sale');
  const oL = (await call('/pay/order', {})).data.order_id;
  const pL = rz.pay(oL, 'success');
  r = await call('/pay/verify', { order_id: oL, payment_id: pL.payment_id, signature: pL.signature }, { env: LIVE, origin: 'https://dietai.in' });
  ok(r.status === 200 && paidRows(pL.payment_id, 'payment_verified').length === 1 && paidRows(pL.payment_id).length === 0, 'live keys: the same flow is logged as payment_verified, the real sale count');
  r = await call('/pay/check', { token: token1 }, { origin: 'https://dietai-git-preview.vercel.app' });
  ok(r.status === 200 && r.headers.get('Access-Control-Allow-Origin') === 'https://dietai-git-preview.vercel.app', 'test keys: previews may run a full test payment');
  let limitedAt = 0;
  for (let i = 1; i <= 20 && !limitedAt; i++) { const x = await call('/pay/restore', { payment_id: rid('pay') }, { ip: '10.1.2.3' }); if (x.status === 429) limitedAt = i; }
  ok(limitedAt === 16, 'restore guesses rate-limited per visitor (16th try in 10 min refused)', 'refused at try ' + limitedAt);
  rz.setDown(true);
  r = await call('/pay/order', {}, { ip: '10.4.4.4' });
  rz.setDown(false);
  ok(r.status === 502 && r.data.error === 'razorpay_error', 'Razorpay outage → clean 502 the page can explain');

  console.log('\nWorker: every event the site sends is on the allow-list');
  const fs = require('fs');
  const src = ['index.html', 'events.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n');
  const names = [...new Set([...src.matchAll(/(?:logEv|dietaiLog|dietaiLogOnce|logOnce|log)\('([a-z_]+)'/g)].map((m) => m[1]))].sort();
  const rejected = [];
  for (const ev of names) { const x = await call('/e', { product: 'dietai', event: ev }); if (x.status !== 200) rejected.push(ev); }
  ok(names.length >= 14 && rejected.length === 0, `all ${names.length} event names in the code are accepted`, rejected.join(',') || names.join(' '));

  // ================================================================ Browser
  const browser = await chromium.launch();
  const sent = [];           // every beacon the page sent to /e
  const eventStatus = [];    // what the Worker answered for each
  let workerDown = false;
  let ipN = 0;
  async function newCtx() {
    const ip = '10.20.' + (++ipN) + '.1';
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' });
    await ctx.route(WORKER + '/**', async (route) => {
      const req = route.request();
      if (workerDown) return route.abort('connectionrefused');
      try {
        const body = ['GET', 'HEAD', 'OPTIONS'].includes(req.method()) ? undefined : req.postData();
        const headers = Object.assign({}, req.headers(), { 'cf-connecting-ip': ip });
        const res = await worker.fetch(new Request(req.url(), { method: req.method(), headers, body }), workerEnv);
        const text = await res.text();
        if (new URL(req.url()).pathname === '/e') {
          try { const ev = JSON.parse(body); sent.push(ev); eventStatus.push({ ev: ev.event, status: res.status }); } catch (e) {}
        }
        const h = {}; res.headers.forEach((v, k) => { h[k] = v; });
        await route.fulfill({ status: res.status, headers: h, body: text });
      } catch (e) { console.log('    (route error)', e.message); await route.abort(); }
    });
    await ctx.route('https://checkout.razorpay.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: CHECKOUT_JS }));
    await ctx.route('https://fake-razorpay.test/**', async (r) => {
      const b = JSON.parse(r.request().postData() || '{}');
      await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(rz.pay(b.order_id, b.scenario)) });
    });
    await ctx.route('**://pages.razorpay.com/**', (r) => r.abort());
    await ctx.route('**://cdnjs.cloudflare.com/**', (r) => r.abort()); // decorative Three.js
    ctx.setDefaultTimeout(6000);
    return ctx;
  }
  const errs = [];
  async function newPage(ctx) {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(e.message));
    return page;
  }
  const fill = (page, a, h, w) => page.evaluate(([a, h, w]) => { document.getElementById('age').value = a; document.getElementById('height').value = h; document.getElementById('weight').value = w; generatePlan(); }, [a, h, w]);
  const status = (page) => page.evaluate(() => document.getElementById('payStatus').hidden ? '' : document.getElementById('payStatus').textContent);
  const unlockOf = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('dietai_unlock') || 'null'); } catch (e) { return null; } });
  const waitUnlocked = (page, ms = 8000) => page.waitForSelector('#premUnlocked', { state: 'visible', timeout: ms }).then(() => true, () => false);

  let ctx, page, paidToken = '';
  await section('Checkout on a phone: the happy path', async () => {
    ctx = await newCtx();
    page = await newPage(ctx);
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    ok(await page.evaluate(() => typeof window.dietaiLog === 'function'), 'logger defined before the app runs');
    ok(!(await page.evaluate(() => !!document.querySelector('script[src*="premium.js"]'))), 'retired premium.js not loaded');
    await page.evaluate(() => { region = 'south'; diet = 'veg'; });
    await fill(page, 32, 175, 90);
    await sleep(250);
    ok(sent.some((e) => e.event === 'plan_generated'), 'plan_generated sent');
    ok(await page.evaluate(() => document.querySelectorAll('#previewOut .pv-row').length >= 4), 'free Monday preview renders');
    ok(await page.evaluate(() => !!document.querySelector('#previewOut .pv-locked')), 'Tuesday–Sunday locked');
    ok(await page.evaluate(() => document.getElementById('payBtn').tagName === 'BUTTON' && !document.querySelector('a[href*="pages.razorpay.com"]')), 'pay button opens checkout on the page; no payment-page link left');
    ok(await page.isVisible('#weekCta'), 'a "see all 7 days" button sits right under the free plan');
    await page.tap('#weekCta');
    await page.waitForTimeout(900);
    ok(sent.some((e) => e.event === 'week_cta_click') && sent.some((e) => e.event === 'premium_seen'), 'tapping it scrolls to the offer; week_cta_click and premium_seen logged');
    await page.tap('#payBtn');
    const unlocked1 = await waitUnlocked(page);
    ok(unlocked1, 'tap → Razorpay checkout → payment → unlocked on the same page');
    const opened = await page.evaluate(() => window.__rzpOpened[window.__rzpOpened.length - 1]);
    ok(opened && opened.amount === 9900 && opened.currency === 'INR' && /^order_/.test(opened.order_id) && opened.key === KEY_ID, 'checkout opened for ₹99 with a server-made order', opened ? opened.order_id : 'not opened');
    ok(opened && opened.config.display.sequence[0] === 'block.upi' && opened.config.display.blocks.upi.instruments[0].method === 'upi' && opened.config.display.preferences.show_default_blocks === true, 'UPI shown first; cards and netbanking still offered');
    ok(opened && opened.modal.confirm_close === true && opened.modal.backdropclose === false && opened.retry.enabled === true, 'checkout asks before closing and allows retries');
    const u1 = await unlockOf(page);
    ok(u1 && TOKEN_RE.test(u1.t), 'browser holds a server-signed unlock token', u1 ? u1.t.slice(0, 28) + '…' : 'none');
    const pay1 = u1 ? u1.t.split('.')[1] : '';
    ok(paidRows(pay1).length === 1 && JSON.parse(paidRows(pay1)[0].meta).via === 'checkout', 'server recorded the sale');
    await sleep(300);
    ok(sent.some((e) => e.event === 'premium_click') && sent.some((e) => e.event === 'checkout_opened') && sent.some((e) => e.event === 'premium_unlocked' && e.meta && e.meta.via === 'checkout'), 'premium_click → checkout_opened → premium_unlocked logged');
    ok(await page.evaluate(() => document.querySelectorAll('#weekOut details').length === 7), '7-day week built straight away');
    ok(await page.evaluate((p) => document.getElementById('payIdShow').textContent === p, pay1), 'payment ID shown so the customer can restore later');
    ok(await page.evaluate(() => localStorage.getItem('dietai_pending_order') === null), 'pending order cleared');
    await page.evaluate(() => { lastWeek = null; buildWeek(false); });
    await sleep(300);
    ok(sent.some((e) => e.event === 'pack_opened'), 'pack_opened sent when the week is built');
    paidToken = u1.t;
    await ctx.close();
  });
  await section('UPI timed out, then paid on the second try', async () => {
    ctx = await newCtx(); page = await newPage(ctx);
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await fill(page, 28, 160, 60);
    await page.evaluate(() => { window.__rzpScenario = 'fail'; });
    await page.tap('#payBtn');
    await page.waitForFunction(() => /No money was taken/.test(document.getElementById('payStatus').textContent), null, { timeout: 6000 }).catch(() => {});
    const failMsg = await status(page);
    ok(/timed out/.test(failMsg) && /No money was taken/.test(failMsg), 'customer told plainly: timed out, no money taken, try again', failMsg.slice(0, 80));
    ok(await page.isVisible('#premLocked') && !(await unlockOf(page)), 'still locked after a failed payment');
    ok(await page.evaluate(() => !document.getElementById('payBtn').disabled), 'pay button usable again');
    await sleep(250);
    ok(sent.some((e) => e.event === 'payment_failed' && e.meta && e.meta.reason === 'payment_timed_out'), 'payment_failed logged with Razorpay\'s reason');
    await page.evaluate(() => { window.__rzpScenario = 'success'; });
    await page.tap('#payBtn');
    ok(await waitUnlocked(page), 'second attempt pays and unlocks');
    await ctx.close();
  });
  await section('Checkout closed without paying', async () => {
    ctx = await newCtx(); page = await newPage(ctx);
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.evaluate(() => { window.__rzpScenario = 'dismiss'; });
    await page.tap('#payBtn');
    await page.waitForFunction(() => /nothing was charged/.test(document.getElementById('payStatus').textContent), null, { timeout: 6000 }).catch(() => {});
    ok(/nothing was charged/.test(await status(page)) && await page.isVisible('#premLocked'), 'closing checkout says nothing was charged and stays locked');
    ok(await page.evaluate(() => localStorage.getItem('dietai_pending_order') === null), 'abandoned order forgotten');
    await ctx.close();
  });
  await section('Paid in the UPI app, but the phone dropped the browser tab', async () => {
    ctx = await newCtx(); page = await newPage(ctx);
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await fill(page, 40, 165, 80);
    await page.evaluate(() => { window.__rzpScenario = 'killed'; });
    await page.tap('#payBtn');
    await page.waitForEvent('load', { timeout: 6000 }).catch(() => {});
    ok(await waitUnlocked(page), 'coming back to the page finds the payment and unlocks');
    const uK = await unlockOf(page);
    ok(uK && paidRows(uK.t.split('.')[1]).some((x) => JSON.parse(x.meta).via === 'recovery'), 'sale recorded via recovery');
    await ctx.close();
  });
  await section('UPI request sent, approved a little later', async () => {
    ctx = await newCtx(); page = await newPage(ctx);
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.evaluate(() => { window.__rzpScenario = 'pending'; });
    await page.tap('#payBtn');
    await page.waitForEvent('load', { timeout: 6000 }).catch(() => {});
    await page.waitForFunction(() => /Waiting for your UPI app/.test(document.getElementById('payStatus').textContent), null, { timeout: 6000 }).catch(() => {});
    ok(/Waiting for your UPI app/.test(await status(page)), 'page says it is waiting for the UPI app');
    const pendingOrder = await page.evaluate(() => JSON.parse(localStorage.getItem('dietai_pending_order')).id);
    for (const p of rz.payments.values()) if (p.order_id === pendingOrder) p.status = 'captured';
    ok(await waitUnlocked(page, 12000), 'unlocks by itself once the UPI app approves');
    await ctx.close();
  });
  await section('Restore on a new phone', async () => {
    ctx = await newCtx(); page = await newPage(ctx);
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.click('#restoreBox summary');
    await page.fill('#restoreId', 'abc123');
    await page.click('#restoreBtn');
    ok(await page.evaluate(() => document.getElementById('restoreId').getAttribute('aria-invalid') === 'true'), 'a non-ID is flagged on the field');
    await page.fill('#restoreId', rid('pay'));
    await page.click('#restoreBtn');
    await page.waitForFunction(() => /couldn't find/.test(document.getElementById('payStatus').textContent), null, { timeout: 5000 }).catch(() => {});
    ok(/couldn't find/.test(await status(page)) && await page.isVisible('#premLocked'), 'unknown payment ID: explained, stays locked');
    await page.fill('#restoreId', refunded.id);
    await page.click('#restoreBtn');
    await page.waitForFunction(() => /refunded/.test(document.getElementById('payStatus').textContent), null, { timeout: 5000 }).catch(() => {});
    ok(/refunded/.test(await status(page)), 'refunded payment: explained, stays locked');
    await page.fill('#restoreId', '  ' + pagePay.id + ' ');
    await page.click('#restoreBtn');
    ok(await waitUnlocked(page), 'real payment ID (from the old payment page) restores the pack');
    await ctx.close();

    ctx = await newCtx(); page = await newPage(ctx);
    await page.goto(BASE + '/?restore=' + encodeURIComponent(paidToken) + '&utm_source=whatsapp', { waitUntil: 'networkidle' });
    ok(await waitUnlocked(page), 'restore link unlocks a fresh browser');
    ok(!page.url().includes('restore=') && page.url().includes('utm_source=whatsapp'), 'token removed from the address bar, other params kept', page.url().replace(BASE, ''));
    await ctx.close();

    ctx = await newCtx(); page = await newPage(ctx);
    const tp = paidToken.split('.');
    await page.goto(BASE + '/?restore=' + [tp[0], rid('pay'), tp[2], tp[3]].join('.'), { waitUntil: 'networkidle' });
    await page.waitForFunction(() => /didn't check out/.test(document.getElementById('payStatus').textContent), null, { timeout: 5000 }).catch(() => {});
    ok(await page.isVisible('#premLocked') && /didn't check out/.test(await status(page)), 'edited restore link refused');
    await ctx.close();
  });
  await section('The old free unlock is gone', async () => {
    ctx = await newCtx(); page = await newPage(ctx);
    await page.goto(BASE + '/?premium=unlocked', { waitUntil: 'networkidle' });
    await sleep(500);
    ok(await page.isVisible('#premLocked') && !(await page.isVisible('#premUnlocked')), '/?premium=unlocked no longer unlocks');
    ok(!page.url().includes('premium='), 'old param removed from the address bar');
    ok(await page.evaluate(() => document.getElementById('restoreBox').open) && /no longer works/.test(await status(page)), 'paying customers from the old link are pointed to restore');
    ok(!sent.some((e) => e.event === 'premium_unlocked' && e.meta && e.meta.first !== undefined), 'no fake "sale" logged for the old link');
    await ctx.close();

    ctx = await newCtx();
    await ctx.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('dietai_premium', '1'); } });
    page = await newPage(ctx);
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    ok(await page.isVisible('#premLocked') && await page.evaluate(() => localStorage.getItem('dietai_premium') === null), 'old "dietai_premium" flag no longer counts (and is cleared)');
    await ctx.close();

    ctx = await newCtx();
    await ctx.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1');
      localStorage.setItem('dietai_unlock', JSON.stringify({ t: 'v1.pay_Forged00000000x1.' + Math.floor(Date.now() / 1000) + '.' + 'ab'.repeat(32), v: 0 })); } });
    page = await newPage(ctx);
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForSelector('#premLocked', { state: 'visible', timeout: 6000 }).catch(() => {});
    ok(await page.isVisible('#premLocked') && !(await unlockOf(page)), 'a hand-made token is caught at the server re-check and removed');
    await ctx.close();
  });
  await section('When payments cannot run', async () => {
    workerEnv = ENV_OFF;
    ctx = await newCtx(); page = await newPage(ctx);
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.tap('#payBtn');
    await page.waitForFunction(() => !document.getElementById('payStatus').hidden, null, { timeout: 6000 }).catch(() => {});
    ok(/being switched on/.test(await status(page)) && await page.evaluate(() => !document.getElementById('payBtn').disabled), 'keys not set yet: clear message, button usable');
    await ctx.close();
    workerEnv = ENV;
    workerDown = true;
    ctx = await newCtx(); page = await newPage(ctx);
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.tap('#payBtn');
    await page.waitForFunction(() => !document.getElementById('payStatus').hidden, null, { timeout: 20000 }).catch(() => {});
    ok(/couldn't open the secure checkout/.test(await status(page)) && /Nothing was charged/.test(await status(page)), 'no connection: says so, nothing charged');
    await ctx.close();
    workerDown = false;
  });
  await section('Two tabs: unlocking in one unlocks the other', async () => {
    ctx = await newCtx(); page = await newPage(ctx);
    await page.goto(BASE + '/?run=a', { waitUntil: 'networkidle' });
    await fill(page, 30, 170, 70);
    ok(await page.isVisible('#premLocked'), 'offer shown in the first tab');
    const tabB = await newPage(ctx);
    await tabB.goto(BASE + '/?restore=' + encodeURIComponent(paidToken), { waitUntil: 'networkidle' });
    await waitUnlocked(tabB);
    await page.bringToFront(); await sleep(700);
    ok(await page.isVisible('#premUnlocked') && !(await page.isVisible('#payBtn')), 'first tab unlocks, pay button gone');
    ok(await page.evaluate(() => document.querySelectorAll('#weekOut details').length === 7), 'first tab builds the week');
    await ctx.close();

    // ---------------------------------------------------------------- app checks
  });
  await section('Saved plan must never override what is on screen (free and paid visitors)', async () => {
    // A non-veg East plan is saved; a vegetarian then opens the site from the South guide link.
    for (const paid of [false, true]) {
      const who = paid ? 'paid' : 'free';
      const c2 = await newCtx();
      if (paid) await c2.addInitScript((t) => { localStorage.setItem('dietai_unlock', JSON.stringify({ t, v: Date.now() })); }, paidToken);
      const pg = await newPage(c2);
      await pg.goto(BASE + '/', { waitUntil: 'networkidle' });
      await pg.evaluate(() => { region = 'east'; diet = 'nonveg';
        document.getElementById('age').value = 30; document.getElementById('height').value = 170; document.getElementById('weight').value = 70; generatePlan(); });
      await pg.evaluate(() => { window.__stale = true; });
      await pg.goto(BASE + '/?region=south&run=' + who + '#planner', { waitUntil: 'networkidle' });
      ok(await pg.evaluate(() => !window.__stale), `[${who}] page really reloaded`);
      ok(await pg.evaluate(() => isPremium()) === paid, `[${who}] visitor state set up`);
      const st = await pg.evaluate(() => ({ region, diet, uiRegion: document.querySelector('#regionSeg button.on').dataset.region,
        uiDiet: document.querySelector('#dietSeg button.on').dataset.diet }));
      ok(st.region === 'south' && st.uiRegion === 'south', `[${who}] URL region wins over the saved plan`, JSON.stringify(st));
      ok(st.diet === st.uiDiet, `[${who}] diet variable matches the highlighted button`, `${st.diet} vs ${st.uiDiet}`);
      const nv = await pg.evaluate(() => { generatePlan();
        return { region: lastPlan.region, diet: lastPlan.diet, nonveg: buildDay(0, lastPlan.target, lastPlan.protein).meals.filter((m) => m[2].g === 'n').map((m) => m[2].t) }; });
      ok(nv.region === 'south' && nv.diet === 'veg' && nv.nonveg.length === 0, `[${who}] a Veg selection never produces non-veg meals`, JSON.stringify(nv));
      await c2.close();
    }
    ctx = await newCtx();
    await ctx.addInitScript((t) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('dietai_unlock', JSON.stringify({ t, v: Date.now() })); } }, paidToken);
    page = await newPage(ctx);
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  });
  await section('Day totals tell the truth (meals + protein top-up + any extra = the number shown)', async () => {
    const cases = [['north', 'nonveg', 'male', 32, 175, 90, 'lose'], ['south', 'veg', 'female', 45, 155, 95, 'lose'],
      ['east', 'egg', 'male', 25, 180, 65, 'gain'], ['west', 'veg', 'female', 30, 160, 52, 'maintain'],
      ['northeast', 'nonveg', 'male', 55, 168, 120, 'lose'], ['pan', 'veg', 'male', 19, 172, 48, 'gain'],
      ['central', 'egg', 'female', 60, 150, 78, 'lose']];
    for (const c of cases) {
      const res = await page.evaluate(([rg, dt, sx, a, h, w, gl]) => {
        region = rg; diet = dt; sex = sx; goal = gl;
        document.getElementById('age').value = a; document.getElementById('height').value = h; document.getElementById('weight').value = w;
        generatePlan(); lastWeek = null; buildWeek(true);
        const days = [...document.querySelectorAll('#weekOut details.week-day')].map((d) => {
          const meals = [...d.querySelectorAll('.wd-body > div')].map((x) => (x.textContent.match(/\((\d+) kcal \/ (\d+)g P\)/) || []).slice(1).map(Number)).filter((x) => x.length);
          const tuTxt = (d.querySelector('.wd-body') .textContent.match(/\+(\d+)g protein, \+(\d+) kcal/) || []).slice(1).map(Number);
          const exTxt = (d.querySelector('.wd-body').textContent.match(/\(\+(\d+) kcal, \+(\d+)g protein\)/) || []).slice(1).map(Number);
          const tot = (d.querySelector('.daytot span:last-child').textContent.replace(/,/g, '').match(/(\d+) kcal · (\d+)g/) || []).slice(1).map(Number);
          const sum = (d.querySelector('summary span').textContent.replace(/,/g, '').match(/(\d+) kcal · (\d+)g/) || []).slice(1).map(Number);
          return { mealK: meals.reduce((s, m) => s + m[0], 0), mealP: meals.reduce((s, m) => s + m[1], 0), tuP: tuTxt[0] || 0, tuK: tuTxt[1] || 0, exK: exTxt[0] || 0, exP: exTxt[1] || 0,
            totK: tot[0], totP: tot[1], sumK: sum[0], sumP: sum[1], note: !!d.querySelector('.daynote'), short: /short of your protein goal/.test(d.textContent) };
        });
        return { target: lastPlan.target, protein: lastPlan.protein, days };
      }, c);
      const addsUp = res.days.every((d) => d.mealK + d.tuK + d.exK === d.totK && d.mealP + d.tuP + d.exP === d.totP && d.totK === d.sumK && d.totP === d.sumP);
      const onTarget = res.days.every((d) => d.totK <= res.target * 1.05 || d.note);
      const shortSaid = res.days.every((d) => d.totP >= res.protein - 8 || d.short);
      const worst = Math.max(...res.days.map((d) => d.totK - res.target));
      ok(addsUp && onTarget && shortSaid, `${c[0]}/${c[1]}/${c[2]}/${c[5]}kg/${c[6]}`,
        `target ${res.target} kcal, days ${Math.min(...res.days.map((d) => d.totK))}–${Math.max(...res.days.map((d) => d.totK))} kcal (worst ${worst >= 0 ? '+' : ''}${worst}), protein ${Math.min(...res.days.map((d) => d.totP))}–${Math.max(...res.days.map((d) => d.totP))} g of ${res.protein} g`);
    }
    const sweep = await page.evaluate(() => {
      const bodies = [['male', 32, 175, 90, 'lose'], ['female', 45, 155, 95, 'lose'], ['male', 25, 180, 65, 'gain'], ['female', 30, 160, 52, 'maintain'], ['male', 55, 168, 120, 'lose']];
      let n = 0, over = 0, flagged = 0, hidden = 0, maxOver = -1e9;
      for (const rg of Object.keys(REGIONS)) for (const dt of ['veg', 'egg', 'nonveg']) for (const bd of bodies) {
        region = rg; diet = dt; sex = bd[0]; goal = bd[4];
        document.getElementById('age').value = bd[1]; document.getElementById('height').value = bd[2]; document.getElementById('weight').value = bd[3];
        generatePlan();
        for (let d = 0; d < 7; d++) {
          const day = buildDay(d, lastPlan.target, lastPlan.protein, rg, dt); n++;
          let k = 0; day.meals.forEach((m) => { k += Math.round(m[2].k * day.scale); });
          const tuK = day.tu ? day.tu.items.reduce((s, it) => s + it.kcal, 0) : 0;
          const exK = day.ex ? day.ex.items.reduce((s, it) => s + it.kcal, 0) : 0;
          if (k + tuK + exK !== day.totK) hidden++;
          const diff = day.totK - lastPlan.target, noted = diff > Math.max(60, lastPlan.target * 0.05); // dayTotalHTML shows a note then
          if (noted) flagged++;
          if (day.totK > lastPlan.target * 1.05 && !noted) over++;
          maxOver = Math.max(maxOver, day.totK - lastPlan.target);
        }
      }
      return { n, over, flagged, hidden, maxOver };
    });
    ok(sweep.hidden === 0 && sweep.over === 0 && sweep.flagged <= sweep.n * 0.02, `all ${sweep.n} plan-days (7 regions × 3 diets × 5 bodies × 7 days): nothing hidden, none >5% over without saying so`,
      `worst day +${sweep.maxOver} kcal; ${sweep.flagged} day(s) carry an "over target" note`);
    const pv = await page.evaluate(() => { localStorage.removeItem('dietai_unlock'); region = 'south'; diet = 'veg'; sex = 'female'; goal = 'lose';
      document.getElementById('age').value = 45; document.getElementById('height').value = 155; document.getElementById('weight').value = 95; generatePlan();
      const rows = [...document.querySelectorAll('#previewOut .pv-row .kk')].map((x) => Number((x.textContent.match(/(\d+) kcal/) || [0, 0])[1]));
      const tot = Number(document.querySelector('#previewOut .daytot span:last-child').textContent.replace(/,/g, '').match(/(\d+) kcal/)[1]);
      return { rows: rows.reduce((s, x) => s + x, 0), tot, monday: buildDay(0, lastPlan.target, lastPlan.protein, 'south', 'veg').totK };
    });
    ok(pv.rows === pv.tot && pv.tot === pv.monday, 'free Monday preview total = its rows = the paid Monday', JSON.stringify(pv));
    await page.evaluate((t) => localStorage.setItem('dietai_unlock', JSON.stringify({ t, v: Date.now() })), paidToken);
  });
  await section('High calorie targets are met, not just flagged (muscle gain, very active)', async () => {
    const r = await page.evaluate(() => {
      const bodies = [['male', 22, 175, 60, '1.55', 'gain'], ['male', 30, 178, 72, '1.725', 'gain'], ['male', 25, 183, 80, '1.9', 'maintain'],
        ['female', 24, 160, 48, '1.375', 'gain'], ['male', 32, 175, 90, '1.375', 'lose'], ['female', 45, 155, 95, '1.375', 'lose']];
      let n = 0, under = 0, over = 0, ex = 0, loseEx = 0, worst = 0;
      for (const rg of Object.keys(REGIONS)) for (const dt of ['veg', 'egg', 'nonveg']) for (const [sx, a, h, w, act, gl] of bodies) {
        region = rg; diet = dt; sex = sx; goal = gl;
        document.getElementById('age').value = a; document.getElementById('height').value = h; document.getElementById('weight').value = w; document.getElementById('activity').value = act;
        generatePlan();
        for (let d = 0; d < 7; d++) {
          const day = buildDay(d, lastPlan.target, lastPlan.protein, rg, dt), diff = day.totK - lastPlan.target, lim = Math.max(60, lastPlan.target * 0.05); n++;
          if (-diff > lim) under++; if (diff > lim) over++; if (day.ex) { ex++; if (gl === 'lose') loseEx++; }
          if (Math.abs(diff) > Math.abs(worst)) worst = diff;
        }
      }
      document.getElementById('activity').value = '1.375';
      return { n, under, over, ex, loseEx, worst };
    });
    ok(r.under === 0 && r.over === 0, `all ${r.n} plan-days land within 5% of the target`, `worst ${r.worst > 0 ? '+' : ''}${r.worst} kcal; ${r.ex} days needed an extra`);
    ok(r.loseEx === 0, 'fat-loss plans at light activity never get an extra');
    const g = await page.evaluate(() => { region = 'north'; diet = 'veg'; sex = 'male'; goal = 'gain';
      document.getElementById('age').value = 22; document.getElementById('height').value = 175; document.getElementById('weight').value = 60; document.getElementById('activity').value = '1.55';
      generatePlan(); lastWeek = null; buildWeek(true);
      const want = {}; lastWeek.forEach((w) => [w.day.tu, w.day.ex].forEach((x) => { if (x) x.items.forEach((it) => { if (it.k !== 'atta') want[it.k] = (want[it.k] || 0) + it.amt; }); }));
      const rowFor = (label) => { const row = [...document.querySelectorAll('#weekOut .gro-row')].find((x) => x.firstChild.textContent.indexOf(label) === 0); return row ? row.lastChild.textContent : null; };
      const kk = [...document.querySelectorAll('#mealPlan .meal .mk')].map((x) => Number((x.textContent.match(/(\d+) kcal/) || [0, 0])[1])).reduce((s, x) => s + x, 0);
      const shown = Number(document.querySelector('#mealPlan .daytot span:last-child').textContent.replace(/,/g, '').match(/(\d+) kcal/)[1]);
      const out = { want, banana: rowFor('Banana'), peanuts: rowFor('Peanuts'), plan: document.getElementById('mealPlan').textContent, note: document.getElementById('portionNote').textContent,
        share: planText(), week: document.getElementById('weekOut').textContent, kk, shown, target: lastPlan.target };
      document.getElementById('activity').value = '1.375';
      return out;
    });
    ok(/Extra to reach your target/.test(g.plan) && /with the protein top-up and the extra|with the extra/.test(g.note) && g.kk === g.shown && Math.abs(g.shown - g.target) <= g.target * 0.05,
      'a muscle-gain plan shows the extra, and its rows add up to the day total', `${g.shown} of ${g.target} kcal`);
    ok(/Extra to reach your target/.test(g.week) && /Extra to reach your target/.test(g.share), 'the paid week and the WhatsApp text include the extra');
    const num = (t) => (t ? parseFloat(t.replace(/[^\d.]/g, '')) * (/kg/.test(t) ? 1000 : 1) : 0);
    ok((!g.want.banana || num(g.banana) >= g.want.banana) && (!g.want.peanuts || num(g.peanuts) >= g.want.peanuts), 'the grocery list covers the extras', `banana ${g.banana} for ${g.want.banana || 0}, peanuts ${g.peanuts} for ${g.want.peanuts || 0} g`);
  });
  await section('Grocery list', async () => {
    const gro = await page.evaluate(() => { region = 'south'; diet = 'egg'; sex = 'male'; goal = 'lose';
      document.getElementById('age').value = 32; document.getElementById('height').value = 175; document.getElementById('weight').value = 90;
      generatePlan(); lastWeek = null; buildWeek(true);
      const want = {}; lastWeek.forEach((w) => { if (w.day.tu) w.day.tu.items.forEach((it) => { want[it.k] = (want[it.k] || 0) + it.amt; }); });
      const rowFor = (label) => { const r = [...document.querySelectorAll('#weekOut .gro-row')].find((x) => x.firstChild.textContent.indexOf(label) === 0); return r ? r.lastChild.textContent : null; };
      return { want, soya: rowFor('Soya chunks'), junk: [...document.querySelectorAll('#weekOut .gro-row')].map((r) => r.textContent).filter((t) => /NaN|undefined|uava|× 0|\b0 g\b/.test(t)) };
    });
    const soyaG = gro.soya ? (/kg/.test(gro.soya) ? parseFloat(gro.soya) * 1000 : parseFloat(gro.soya)) : 0;
    ok(gro.want.soya ? Math.abs(soyaG - gro.want.soya) <= 10 : true, 'top-up soya is on the shopping list in the right amount', `${gro.soya} for ${gro.want.soya || 0} g of top-ups`);
    ok(gro.junk.length === 0, 'no malformed rows', gro.junk.join(' | ') || 'none');
  });
  await section('The paid week uses every dish the data allows', async () => {
    const variety = await page.evaluate(() => {
      const bad = [];
      for (const rg of Object.keys(REGIONS)) for (const dt of ['veg', 'egg', 'nonveg']) for (const prot of [80, 140]) {
        const seen = { B: new Set(), L: new Set(), D: new Set(), S: new Set() }, keys = ['B', 'L', 'D', 'S'];
        for (let d = 0; d < 7; d++) buildDay(d, 2000, prot, rg, dt).meals.forEach((m, i) => seen[keys[i]].add(m[2].t));
        const tags = allowedTags(dt);
        keys.forEach((k) => { const avail = Math.min(7, REGIONS[rg].meals[k].filter((m) => tags.includes(m.g)).length);
          if (seen[k].size < avail) bad.push(`${rg}/${dt}/${prot}g ${k}: ${seen[k].size} of ${avail}`); });
      }
      return bad;
    });
    ok(variety.length === 0, 'every slot rotates through all allowed dishes over 7 days', variety.slice(0, 4).join('; ') || 'all slots full');
  });
  await section('Bad input is rejected, never silently clamped', async () => {
    for (const [age, h, w, field, why] of [[28, 170, 2, 'weight', 'weight 2 (typo for 72)'], [280, 170, 72, 'age', 'age 280 (typo for 28)'],
        [28, 17, 72, 'height', 'height 17 (typo for 170)'], [28, 1700, 72, 'height', 'height 1700'], [12, 150, 45, 'age', 'age 12 (a child)'],
        [17, 165, 55, 'age', 'age 17'], [30, 120, 290, 'weight', 'BMI over 80']]) {
      const res = await page.evaluate(([a, hh, ww]) => { const before = JSON.stringify(lastPlan);
        document.getElementById('age').value = a; document.getElementById('height').value = hh; document.getElementById('weight').value = ww;
        generatePlan(); return { changed: JSON.stringify(lastPlan) !== before, invalid: [...document.querySelectorAll('[aria-invalid="true"]')].map((e) => e.id),
          toast: document.getElementById('toast').textContent }; }, [age, h, w]);
      ok(!res.changed && res.invalid.length === 1 && res.invalid[0] === field, `rejects ${why}, flags only that field`, `flags ${res.invalid.join(',') || 'nothing'}: "${res.toast.slice(0, 60)}"`);
    }
    const good = await page.evaluate(() => { document.getElementById('age').value = 18; document.getElementById('height').value = 170; document.getElementById('weight').value = 65;
      generatePlan(); return { age18: !!lastPlan && lastPlan.w === 65, flagged: document.querySelectorAll('[aria-invalid="true"]').length }; });
    ok(good.age18 && good.flagged === 0, 'accepts a valid 18-year-old and clears the error state');
  });
  await section('Tracker starts a new day at midnight, even in a tab left open', async () => {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const g = await c.newPage();
    await g.route(/^https:\/\//, (r) => r.abort());
    await g.clock.install({ time: new Date('2026-11-15T23:50:00') });
    await g.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await g.evaluate(() => { document.getElementById('fName').value = 'Roti / Chapati (1)'; document.getElementById('fCal').value = 120; document.getElementById('fProt').value = 3; addFood(); tapWater(2);
      document.getElementById('wIn').value = 70; logWeight(); });
    const before = await g.evaluate(() => ({ n: foods.length, w: waterN }));
    await g.clock.fastForward('00:20:00');
    const after = await g.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); return { n: foods.length, w: waterN, saved: localStorage.getItem('dietai_foods'), shown: document.getElementById('sCount').textContent }; });
    ok(before.n === 1 && before.w === 3 && after.n === 0 && after.w === 0 && after.saved === '[]' && after.shown === '0', "yesterday's food and water clear on return after midnight", JSON.stringify({ before, after: { n: after.n, w: after.w } }));
    await g.evaluate(() => { document.getElementById('fName').value = 'Banana (1)'; document.getElementById('fCal').value = 105; addFood(); });
    ok(await g.evaluate(() => foods.length === 1 && JSON.parse(localStorage.getItem('dietai_foods')).length === 1), 'logging the next day works as normal');
    const wl = await g.evaluate(() => { document.getElementById('wIn').value = 69.5; logWeight(); return JSON.parse(localStorage.getItem('dietai_weightlog')); });
    ok(wl.length === 2 && wl[0].w === 70 && wl[1].w === 69.5 && wl[0].d !== wl[1].d, "a weight logged after midnight starts a new day instead of overwriting yesterday's", JSON.stringify(wl));
    await c.close();
  });
  await section('Every body the form accepts gets a sane plan (ages 18–100, 120–230 cm, 30–300 kg)', async () => {
    const f = await page.evaluate(() => {
      const issues = []; let plans = 0, days = 0, weeks = 0, offNoted = 0;
      const toastOrig = window.toast; window.toast = () => {};
      const acts = ['1.2', '1.375', '1.55', '1.725', '1.9'], diets = ['veg', 'egg', 'nonveg'], regs = Object.keys(REGIONS);
      let i = 0;
      for (const a of [18, 30, 60, 100]) for (const h of [120, 150, 175, 200, 230]) for (const w of [30, 45, 70, 120, 200, 300]) for (const sx of ['male', 'female']) for (const gl of ['lose', 'maintain', 'gain']) {
        const dt = diets[i % 3], rg = regs[i % regs.length];
        region = rg; diet = dt; sex = sx; goal = gl; lastPlan = null;
        document.getElementById('age').value = a; document.getElementById('height').value = h; document.getElementById('weight').value = w; document.getElementById('activity').value = acts[i % acts.length]; i++;
        generatePlan();
        if (!lastPlan || lastPlan.w !== w) continue;
        plans++;
        const L = lastPlan;
        if (![L.target, L.protein, L.carbs, L.fat, L.water].every((x) => Number.isFinite(x) && x > 0)) issues.push(`numbers ${a}/${h}/${w}/${sx}/${gl}`);
        for (let d = 0; d < 7; d++) {
          const day = buildDay(d, L.target, L.protein, rg, dt); days++;
          if (!Number.isFinite(day.totK) || day.totK <= 0 || !Number.isFinite(day.totP)) issues.push(`day ${a}/${h}/${w}/${sx}/${gl}`);
          if (Math.abs(day.totK - L.target) > Math.max(60, L.target * 0.05)) { if (/daynote/.test(dayTotalHTML(day))) offNoted++; else issues.push(`silent miss ${a}/${h}/${w}/${sx}/${gl}`); }
        }
        if (i % 9 === 0) { lastWeek = null; buildWeek(true); weeks++;
          if (/NaN|undefined|\[object/.test(document.getElementById('weekOut').innerHTML + planText())) issues.push(`junk ${a}/${h}/${w}/${sx}/${gl}`); }
      }
      window.toast = toastOrig; document.getElementById('activity').value = '1.375';
      return { plans, days, weeks, offNoted, issues };
    });
    ok(f.plans > 400 && f.issues.length === 0, `${f.plans} accepted bodies × 7 days: no broken numbers, and every day that misses its target says so`,
      `${f.days} days, ${f.weeks} weeks rendered; ${f.offNoted} extreme-body days carry a note${f.issues.length ? '; ' + f.issues.slice(0, 3).join(' | ') : ''}`);
  });
  await section('Accessibility', async () => {
    const a11y = await page.evaluate(() => {
      const name = (el) => (el.getAttribute('aria-label') || '').trim() || (el.labels && el.labels[0] ? el.labels[0].textContent.trim() : '') || el.textContent.trim();
      return {
        inputs: [...document.querySelectorAll('input,select')].filter((el) => el.type !== 'hidden' && !name(el)).map((el) => el.id),
        buttons: [...document.querySelectorAll('button,a.btn')].filter((el) => el.offsetParent !== null && !name(el)).length,
        pressed: [...document.querySelectorAll('#goalSeg button,#dietSeg button,#sexSeg button,#regionSeg button')].filter((b) => !b.hasAttribute('aria-pressed')).length,
        tabs: document.querySelectorAll('[role="tab"][aria-selected]').length,
        live: document.getElementById('payStatus').getAttribute('aria-live') };
    });
    ok(a11y.inputs.length === 0, 'every input has an accessible name', a11y.inputs.join(',') || 'all named');
    ok(a11y.buttons === 0, 'every visible button has a name');
    ok(a11y.pressed === 0, 'every toggle reports aria-pressed');
    ok(a11y.tabs === 2, 'tabs expose aria-selected');
    ok(a11y.live === 'polite', 'payment messages are announced to screen readers');
  });
  await section('Print (the paid pack)', async () => {
    await page.evaluate(() => { region = 'north'; diet = 'veg'; generatePlan(); lastWeek = null; buildWeek(true); document.querySelectorAll('#weekOut details').forEach((d) => d.open = true); });
    await page.emulateMedia({ media: 'print' });
    const pr = await page.evaluate(() => {
      const shown = (s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }; // false inside a hidden parent too
      return { leaks: ['header', '.hero', '.app', '.faq', 'footer', '#payBtn', '.prem h2', '#premUnlocked>.btn', '#restoreBox', '#payStatus'].filter(shown),
        pack: shown('#weekOut') && shown('#printHead'), totals: [...document.querySelectorAll('#weekOut .daytot')].filter((e) => e.getClientRects().length > 0).length,
        head: document.getElementById('printHead').textContent, ink: getComputedStyle(document.querySelector('#weekOut .wd-body b')).color };
    });
    await page.emulateMedia({ media: 'screen' });
    ok(pr.leaks.length === 0, 'no marketing or payment elements print', pr.leaks.join(',') || 'none');
    ok(pr.pack && pr.totals === 7, 'plan, header and all 7 day totals print', pr.totals + ' totals');
    ok(/Day totals include the protein top-up/.test(pr.head), 'printout says the totals include the top-up');
    ok(pr.ink === 'rgb(17, 17, 17)', 'plan text prints dark', pr.ink);
    await ctx.close();
  });
  await section('Claims nobody qualified has checked are gone', async () => {
    ctx = await newCtx(); page = await newPage(ctx);
    const BANNED = [/dietitians use/i, /most dietitians consider/i, /safe minimum/i, /exact calorie/i, /AI nutrition coach/i, /healthy weight/i,
      /makes sure most of it comes from fat/i, /as good as a weight-loss lunch gets/i, /ideal weight-loss meal/i, /easiest cuisines in India to lose weight/i,
      /what most adults should aim for/i, /healthy range for most adults/i, /same formulas dietitians/i, /keeps you full longer/i];
    for (const u of ['/', ...GUIDES.map((g) => '/' + g + '/'), ...CAL_PAGES.map((k) => `/${k}-calorie-indian-diet-plan/`)]) {
      const html = await (await page.request.get(BASE + u)).text();
      const hits = BANNED.filter((re) => re.test(html)).map(String);
      ok(hits.length === 0, 'no unchecked claims on ' + u, hits.join(' ') || 'clean');
    }
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    const faq = await page.evaluate(() => {
      const ld = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent).find((x) => x['@type'] === 'FAQPage').mainEntity;
      const vis = [...document.querySelectorAll('.faq details')].map((d) => ({ q: d.querySelector('summary').textContent.trim(), a: d.querySelector('.fa').textContent.trim() }));
      return ld.length === vis.length && ld.every((x, i) => x.name === vis[i].q && x.acceptedAnswer.text === vis[i].a);
    });
    ok(faq, 'search-engine FAQ markup matches the FAQ visitors read, word for word');
  });
  await section('Guides', async () => {
    for (const slug of GUIDES) {
      const g = await newPage(ctx);
      const res = await g.goto(`${BASE}/${slug}/`, { waitUntil: 'networkidle' });
      const i = await g.evaluate(() => {
        const ld = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
        return { faqMatch: ld.find((x) => x['@type'] === 'FAQPage').mainEntity.length === document.querySelectorAll('details').length,
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
    ok(GUIDES.every((s) => sm.includes(`https://dietai.in/${s}/`)), 'sitemap lists every guide');
    for (const k of CAL_PAGES) {
      const g = await newPage(ctx);
      const res = await g.goto(`${BASE}/${k}-calorie-indian-diet-plan/`, { waitUntil: 'networkidle' });
      const i = await g.evaluate((k) => {
        const ld = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
        const totals = [...document.querySelectorAll('table tfoot td.n:nth-of-type(2)')].map((td) => Number(td.textContent.replace(/,/g, '')));
        return { faqMatch: ld.find((x) => x['@type'] === 'FAQPage').mainEntity.length === document.querySelectorAll('details').length,
          tables: document.querySelectorAll('table').length, totals, junk: /NaN|undefined|\[object/.test(document.body.innerText),
          linked: !!document.querySelector('a[href="/#planner"], a[href^="/?utm_source=cal-"]') };
      }, k);
      const near = i.totals.length === 3 && i.totals.every((t) => Math.abs(t - k) <= k * 0.03);
      ok(res.status() === 200 && i.faqMatch && i.tables === 3 && !i.junk && near && i.linked, `/${k}-calorie-indian-diet-plan/: 3 days within 3% of ${k} kcal`, i.totals.join(', '));
      await g.close();
    }
    ok(CAL_PAGES.every((k) => sm.includes(`https://dietai.in/${k}-calorie-indian-diet-plan/`)), 'sitemap lists every calorie page');
    {
      const g = await newPage(ctx);
      const res = await g.goto(`${BASE}/vegetarian-indian-diet-plan/`, { waitUntil: 'networkidle' });
      const i = await g.evaluate(() => {
        const ld = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
        const dayTables = [...document.querySelectorAll('table')].filter((t) => t.querySelector('tfoot'));
        return { faqMatch: ld.find((x) => x['@type'] === 'FAQPage').mainEntity.length === document.querySelectorAll('details').length,
          tables: document.querySelectorAll('table').length,
          totals: dayTables.map((t) => Number(t.querySelector('tfoot td.n:nth-of-type(2)').textContent.replace(/,/g, ''))),
          meat: /\b(eggs?|omelette|chicken|fish|mutton|prawns?|keema)\b/i.test(dayTables.map((t) => t.querySelector('tbody').innerText).join(' ')),
          junk: /NaN|undefined|\[object/.test(document.body.innerText),
          canonical: document.querySelector('link[rel=canonical]').href };
      });
      ok(res.status() === 200 && i.faqMatch && i.tables === 4 && !i.junk && !i.meat && i.canonical === 'https://dietai.in/vegetarian-indian-diet-plan/'
        && i.totals.length === 3 && i.totals.every((t) => Math.abs(t - 1500) <= 45), '/vegetarian-indian-diet-plan/: 3 days within 3% of 1,500 kcal, no egg or meat', i.totals.join(', '));
      await g.click('.cta .btn'); await g.waitForLoadState('networkidle');
      ok(await g.evaluate(() => diet === 'veg'), 'vegetarian page button opens the planner set to vegetarian');
      await g.close();
    }
    ok(sm.includes('https://dietai.in/vegetarian-indian-diet-plan/'), 'sitemap lists the vegetarian page');
    {
      const g = await newPage(ctx);
      const res = await g.goto(`${BASE}/indian-diet-plan-for-weight-gain/`, { waitUntil: 'networkidle' });
      const i = await g.evaluate(() => {
        const ld = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
        const tables = [...document.querySelectorAll('table')];
        const rowsK = tables.map((t) => [...t.querySelectorAll('tbody tr')].reduce((s, r) => s + Number(r.querySelector('td.n').textContent.replace(/,/g, '')), 0));
        const totals = tables.map((t) => Number(t.querySelector('tfoot td.n:nth-of-type(2)').textContent.replace(/,/g, '')));
        return { faqMatch: ld.find((x) => x['@type'] === 'FAQPage').mainEntity.length === document.querySelectorAll('details').length,
          n: tables.length, totals, rowsK, extras: tables.filter((t) => /^Extra/.test([...t.querySelectorAll('tbody th')].pop().textContent)).length,
          meat: /chicken|fish|mutton|keema|prawn/i.test(tables[0].innerText), junk: /NaN|undefined|\[object/.test(document.body.innerText) };
      });
      ok(res.status() === 200 && i.faqMatch && i.n === 3 && !i.junk && i.meat && i.totals.every((t, k) => Math.abs(t - 2800) <= 84 && t === i.rowsK[k]) && i.extras === 3,
        '/indian-diet-plan-for-weight-gain/: 3 days within 3% of 2,800 kcal, each with its extra row, rows add up', i.totals.join(', '));
      await g.click('.cta .btn'); await g.waitForLoadState('networkidle');
      ok(await g.evaluate(() => goal === 'gain' && document.querySelector('#goalSeg button.on').dataset.goal === 'gain'), 'weight-gain page button opens the planner set to Build muscle');
      await g.close();
    }
    ok(sm.includes('https://dietai.in/indian-diet-plan-for-weight-gain/'), 'sitemap lists the weight-gain page');
    {
      const r = await page.request.get(BASE + '/policies/'); const t = await r.text();
      const sections = ['terms', 'pricing', 'privacy', 'delivery'].every((id) => t.includes(`id="${id}"`));
      ok(r.status() === 200 && sections && !/mailto:|@[a-z0-9-]+\.[a-z]/i.test(t) && !/refund/i.test(t) && /₹99, one time/.test(t),
        '/policies/: terms, pricing, privacy and delivery; no email and no refund promise (owner chose to wait)');
      const linksPol = async (u) => (await (await page.request.get(BASE + u)).text()).includes('href="/policies/"');
      ok(await linksPol('/') && await linksPol('/north-indian-diet-plan/') && await linksPol('/1200-calorie-indian-diet-plan/') && await linksPol('/vegetarian-indian-diet-plan/') && await linksPol('/indian-diet-plan-for-weight-gain/'),
        'every page links to the policies page');
      ok(!sm.includes('/policies/'), 'policies page stays out of the sitemap');
    }
    const linksVeg = async (u) => (await (await page.request.get(BASE + u)).text()).includes('href="/vegetarian-indian-diet-plan/"');
    ok(await linksVeg('/') && await linksVeg('/1500-calorie-indian-diet-plan/') && await linksVeg('/north-indian-diet-plan/'), 'homepage, calorie pages and guides link to the vegetarian page');
    const linksGain = async (u) => (await (await page.request.get(BASE + u)).text()).includes('href="/indian-diet-plan-for-weight-gain/"');
    ok(await linksGain('/') && await linksGain('/2000-calorie-indian-diet-plan/') && await linksGain('/south-indian-diet-plan/') && await linksGain('/vegetarian-indian-diet-plan/'), 'homepage, calorie pages, guides and the vegetarian page link to the weight-gain page');
    ok((await (await page.request.get(BASE + '/googlea16ee8de3adc33ae.html')).text()).trim() === 'google-site-verification: googlea16ee8de3adc33ae.html', 'Google Search Console verification file served');
    const robots = await (await page.request.get(BASE + '/robots.txt')).text();
    ok(/Disallow: \/\*\?restore=/.test(robots), 'robots.txt keeps restore links out of search');
    for (const f of ['/robots.txt', '/sitemap.xml']) ok((await page.request.get(BASE + f)).status() === 200, f + ' served');
    await ctx.close();
  });
  await section('Only served on https://dietai.in (GitHub Pages still answers on http://)', async () => {
    // A separate browser with Chrome's own http->https upgrade turned off, so a pass means the page did it.
    const b = await chromium.launch({ args: ['--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable'] });
    const ROOT = path.join(__dirname, '..');
    const files = { '/': 'index.html', '/south-indian-diet-plan/': 'south-indian-diet-plan/index.html', '/1500-calorie-indian-diet-plan/': '1500-calorie-indian-diet-plan/index.html' };
    async function visit(url, js = true) {
      const c = await b.newContext({ javaScriptEnabled: js });
      const httpHits = [];
      await c.route(/^http:\/\/(www\.)?dietai\.in\//, (r) => {
        const u = new URL(r.request().url());
        httpHits.push(u.pathname);
        const f = files[u.pathname];
        return f ? r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(ROOT, f)) }) : r.fulfill({ status: 404, body: '' });
      });
      await c.route(/^https:\/\/dietai\.in\//, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>https</title><p>landed</p>' }));
      await c.route(/^https:\/\/(?!dietai\.in\/)/, (r) => r.abort());
      const p = await c.newPage();
      await p.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
      if (js) await p.waitForURL(/^https:\/\//, { timeout: 4000 }).catch(() => {}); else await sleep(400);
      const out = { url: p.url(), httpHits };
      await c.close();
      return out;
    }
    let v = await visit('http://dietai.in/?restore=v1.pay_X.1.ab#week');
    ok(v.httpHits.includes('/') && v.url === 'https://dietai.in/?restore=v1.pay_X.1.ab#week', 'http://dietai.in moves to https and keeps a restore link intact', v.url);
    v = await visit('http://www.dietai.in/south-indian-diet-plan/');
    ok(v.httpHits.length > 0 && v.url === 'https://dietai.in/south-indian-diet-plan/', 'http://www.dietai.in guide page moves to https://dietai.in', v.url);
    v = await visit('http://dietai.in/1500-calorie-indian-diet-plan/');
    ok(v.httpHits.length > 0 && v.url === 'https://dietai.in/1500-calorie-indian-diet-plan/', 'calorie page moves to https too', v.url);
    v = await visit('http://dietai.in/', false);
    ok(v.url === 'http://dietai.in/', 'the move comes from the page itself (with JavaScript off nothing moves)', v.url);
    const c2 = await b.newContext(); const p2 = await c2.newPage();
    await c2.route(/^https:\/\//, (r) => r.abort());
    await p2.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(500);
    ok(p2.url().startsWith(BASE), 'local and preview hosts are left alone', p2.url());
    await c2.close(); await b.close();
    const cfg = fs.readFileSync(path.join(ROOT, '_config.yml'), 'utf8');
    const ex = ((cfg.match(/^exclude:\n((?:[ \t]+-[^\n]*\n?)+)/m) || [])[1] || '').split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
    ok(['REVENUE-NOTES.md', 'README.md', 'worker', 'tools'].every((x) => ex.includes(x)), 'GitHub Pages build leaves out the notes, README, Worker source and tools', ex.join(', '));
    const site = ['index.html', 'sitemap.xml', 'robots.txt', 'sw.js', 'events.js', 'premium.js', 'manifest.json', 'og.png', 'CNAME', 'googlea16ee8de3adc33ae.html', '2cae93f145dcf1d71723273726fad40a.txt', ...GUIDES, ...CAL_PAGES.map((k) => k + '-calorie-indian-diet-plan'), 'vegetarian-indian-diet-plan', 'indian-diet-plan-for-weight-gain', 'policies'];
    ok(site.every((f) => !ex.includes(f) && fs.existsSync(path.join(ROOT, f))), 'every page and file the site needs is still published (' + site.length + ')');
    ok(!/^(include|baseurl|permalink|plugins):/m.test(cfg), 'the config changes nothing else about the build');
  });
  console.log('\nEvents the pages sent, as the Worker answered them');
  const byEv = {}; eventStatus.forEach((e) => { byEv[e.ev] = byEv[e.ev] || new Set(); byEv[e.ev].add(e.status); });
  Object.keys(byEv).sort().forEach((n) => console.log('  ' + ([...byEv[n]].every((s) => s === 200) ? 'accepted ' : 'REJECTED ') + n));
  ok(eventStatus.length > 0 && eventStatus.every((e) => e.status === 200), 'every event sent was accepted');
  ['page_view', 'plan_generated', 'week_cta_click', 'premium_seen', 'premium_click', 'checkout_opened', 'premium_unlocked', 'pack_opened', 'payment_failed', 'checkout_closed', 'restore_used', 'legacy_unlock_link']
    .forEach((n) => ok(!!byEv[n], 'funnel event fires: ' + n));

  console.log('\nPage errors');
  ok(errs.length === 0, 'no uncaught errors', errs.join(' | ') || 'none');

  await browser.close();
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

