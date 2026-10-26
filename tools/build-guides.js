#!/usr/bin/env node
/* Builds the regional diet-plan guide pages and the sitemap.

   Why these exist: every visitor who builds a plan arrives from Google or Bing
   (D1 events, Jul–Oct 2026: 63 of 68 plans came from search). Search is the only
   acquisition channel that works, so each guide is another door into the planner
   for a real query — "south indian diet plan", "gujarati diet plan" and so on.

   Every meal, calorie and protein figure is read from the REGIONS / FOODS data in
   index.html, so a guide can never disagree with what the planner shows.

   The output is plain static HTML that is committed to the repo. The site still
   has no build step; run this only when the meal data or the copy changes:
       node tools/build-guides.js
*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://dietai.in';
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// ---- pull the meal data straight out of the app -------------------------
function grab(name) {
  const m = html.match(new RegExp('var ' + name + '\\s*=\\s*([\\[{][\\s\\S]*?\\n[\\]}]);'));
  if (!m) throw new Error('could not find ' + name + ' in index.html');
  return vm.runInNewContext('(' + m[1] + ')');
}
const REGIONS = grab('REGIONS');
const FOODS = grab('FOODS');
const food = n => { const f = FOODS.find(x => x.n === n); if (!f) throw new Error('FOODS has no ' + n); return f; };

// ---- per-region editorial: the only hand-written part --------------------
// Tips are general, non-medical nutrition observations. Figures quoted in them
// come from FOODS above, never from memory.
const G = {
  north: {
    slug: 'north-indian-diet-plan',
    title: 'North Indian Diet Plan for Weight Loss (Veg & Non-Veg)',
    h1: 'North Indian diet plan for weight loss',
    cuisine: 'North Indian',
    desc: 'A free North Indian diet plan built from rajma-chawal, dal-roti, paneer and chole — sample 1,500 and 2,000 kcal days with calories and protein for every meal.',
    lede: 'You do not have to give up roti, dal or rajma to lose weight. North Indian food is already built on some of the best cheap protein in the country — dal, rajma, chole, paneer, curd. What usually goes wrong is the ghee, the second paratha and the portion of rice, not the food itself.',
    tips: [
      ['Watch the ghee, not the dal', 'A teaspoon of ghee or butter is roughly 45 kcal, and a tadka or a buttered roti can carry two or three. That is where a home-cooked North Indian day quietly gains 200–300 kcal.'],
      ['Roti or rice is a portion question', `One roti is about ${food('Roti / Chapati (1)').k} kcal and a cup of cooked rice about ${food('Plain rice (1 cup)').k} kcal. Two rotis and one cup of rice are close — how many you eat matters far more than which.`],
      ['Lean on rajma, chole and dal', `A cup of cooked dal is around ${food('Dal cooked (1 cup)').p} g of protein, rajma ${food('Rajma cooked (1 cup)').p} g, chole ${food('Chole cooked (1 cup)').p} g. Make one of them the centre of lunch and dinner and protein mostly takes care of itself.`],
      ['Thin lassi, not sweet lassi', `Sweet lassi carries a lot of sugar. Salted lassi or chaas (about ${food('Buttermilk / Chaas (1 glass)').k} kcal a glass) gives you the curd without it.`],
      ['Paratha is a weekend food', 'A stuffed paratha cooked in ghee can be two to three times a plain roti. Keep it to breakfast a couple of days a week and pair it with curd.'],
    ],
    faq3: ['Is roti better than rice for weight loss?', `Neither is "better". One roti is about ${food('Roti / Chapati (1)').k} kcal and a cup of cooked rice about ${food('Plain rice (1 cup)').k} kcal, so two rotis and a cup of rice land in the same place. Pick the one you enjoy and control how much of it you eat.`],
  },
  south: {
    slug: 'south-indian-diet-plan',
    title: 'South Indian Diet Plan for Weight Loss (Veg & Non-Veg)',
    h1: 'South Indian diet plan for weight loss',
    cuisine: 'South Indian',
    desc: 'A free South Indian diet plan built from idli, dosa, sambar rice, ragi and fish curry — sample 1,500 and 2,000 kcal days with calories and protein for every meal.',
    lede: 'Idli, dosa, sambar and rasam are some of the lightest everyday food in India. The one lever that matters in a South Indian diet is rice: keep the sambar and rasam, trim the rice, and add protein where idli and dosa are thin on it.',
    tips: [
      ['Rice is the lever', `A cup of cooked rice is about ${food('Plain rice (1 cup)').k} kcal. Cutting a meal's rice by a quarter and adding more sambar or poriyal is the single easiest change.`],
      ['Keep sambar and rasam', `They are low in calories and add volume. A cup of sambar is about ${food('Sambar (1 cup)').k} kcal with ${food('Sambar (1 cup)').p} g of protein.`],
      ['Go easy on coconut chutney', 'Coconut is calorie-dense. One or two spoons of chutney is fine; a katori of it is a meal on its own.'],
      ['Idli and dosa need a protein partner', `Two idlis are about ${food('Idli (2)').k} kcal but only ${food('Idli (2)').p} g of protein. Pair them with sambar, curd or a sundal.`],
      ['Ragi is a good swap', 'Ragi mudde or ragi dosa in place of some rice adds fibre and keeps you full longer.'],
    ],
    faq3: ['Is idli good for weight loss?', `Yes, it is low in fat — two idlis are about ${food('Idli (2)').k} kcal. The catch is protein: only about ${food('Idli (2)').p} g. Eat idli with sambar or curd, and add a protein-rich lunch.`],
  },
  east: {
    slug: 'east-indian-diet-plan',
    title: 'Bengali, Bihari & Odia Diet Plan for Weight Loss',
    h1: 'East Indian diet plan for weight loss',
    cuisine: 'East Indian',
    desc: 'A free Bengali, Bihari and Odia diet plan built from macher jhol, dal-bhaat, litti-chokha and sattu — sample 1,500 and 2,000 kcal days with calories and protein.',
    lede: 'Rice and fish, dal-bhaat, litti-chokha, sattu: the food of Bengal, Bihar and Odisha has excellent cheap protein in it. The two things to manage are the size of the rice mound and the fried sides that come with it.',
    tips: [
      ['Portion the bhaat', `A cup and a half of cooked rice is about ${Math.round(food('Plain rice (1 cup)').k * 1.5)} kcal. Keep the fish or dal the same and trim the rice first.`],
      ['Fish is your best friend', `Cooked fish is about ${food('Fish, cooked (100g)').p} g of protein per 100 g for roughly ${food('Fish, cooked (100g)').k} kcal. A light macher jhol is close to an ideal weight-loss meal.`],
      ['One fried side, not three', 'Bhaja, fries and pakoras in mustard oil add up fast. Pick one per meal.'],
      ['Sattu is cheap protein', `A glass of sattu drink is about ${food('Sattu drink (1 glass)').k} kcal with ${food('Sattu drink (1 glass)').p} g of protein — one of the best-value breakfasts in India.`],
      ['Count the mishti', 'Sweets are fine; just count them as the calories they are rather than as an extra.'],
    ],
    faq3: ['Is fish curry good for weight loss?', `Usually, yes. Cooked fish gives about ${food('Fish, cooked (100g)').p} g of protein per 100 g for around ${food('Fish, cooked (100g)').k} kcal. Keep the gravy light on oil and watch the rice served with it.`],
  },
  west: {
    slug: 'west-indian-diet-plan',
    title: 'Gujarati & Maharashtrian Diet Plan for Weight Loss',
    h1: 'Gujarati & Maharashtrian diet plan for weight loss',
    cuisine: 'Gujarati and Maharashtrian',
    desc: 'A free Gujarati and Maharashtrian diet plan built from thepla, dhokla, bhakri, dal-dhokli and Konkan fish — sample 1,500 and 2,000 kcal days with calories and protein.',
    lede: 'Thepla, dhokla, bhakri, misal and Konkan fish all fit a weight-loss plan. Two things are worth watching in western Indian food: added sugar in dal and kadhi, and the fried farsan that turns up with tea.',
    tips: [
      ['Notice the sugar', 'Many Gujarati dals and kadhis are cooked with sugar or jaggery. Asking for it to be halved changes very little in taste and a lot in calories over a week.'],
      ['Steamed farsan over fried', `Dhokla is steamed — two pieces are about ${food('Dhokla (2 pcs)').k} kcal. Khakhra is also light. Fried farsan is the expensive one.`],
      ['Bajra and jowar rotla', 'Millet rotlas and bhakri are filling and fit well; keep the ghee on them small.'],
      ['Chaas with every meal', `A glass of buttermilk is about ${food('Buttermilk / Chaas (1 glass)').k} kcal and helps with fullness.`],
      ['Konkan fish for protein', 'If you eat fish, a fish fry or curry with solkadhi is a strong, high-protein lunch.'],
    ],
    faq3: ['Is dhokla good for weight loss?', `Yes, it is steamed rather than fried — two pieces are about ${food('Dhokla (2 pcs)').k} kcal with ${food('Dhokla (2 pcs)').p} g of protein. Watch the sweet chutney and the tempering oil.`],
  },
  central: {
    slug: 'central-indian-diet-plan',
    title: 'MP & Chhattisgarh Diet Plan for Weight Loss',
    h1: 'Central Indian diet plan for weight loss',
    cuisine: 'Central Indian',
    desc: 'A free Madhya Pradesh and Chhattisgarh diet plan built from Indori poha, dal bafla, kadhi-chawal and sprouts — sample 1,500 and 2,000 kcal days with calories and protein.',
    lede: 'Indori poha, dal bafla, kadhi-chawal, bhutte ka kees: central Indian food is simple and filling. The trick is keeping the poha without the jalebi, and the bafla without the bowl of ghee.',
    tips: [
      ['Poha yes, jalebi no', `A plate of poha is about ${food('Poha (1 plate)').k} kcal. It is the jalebi beside it that doubles breakfast.`],
      ['Ask for less ghee on bafla', 'Dal bafla is traditionally soaked in ghee. With a teaspoon instead of a ladle it fits a weight-loss day.'],
      ['Sprouts and chana are cheap protein', `A cup of sprouts is about ${food('Sprouts (1 cup)').p} g of protein for ${food('Sprouts (1 cup)').k} kcal.`],
      ['Kadhi-chawal: more kadhi, less chawal', 'Kadhi is light; the rice is where the calories are.'],
      ['Snack on roasted chana', 'Roasted chana or makhana beats namkeen for both protein and calories.'],
    ],
    faq3: ['Is poha good for weight loss?', `Yes. A plate is about ${food('Poha (1 plate)').k} kcal and keeps you full. It is low in protein (about ${food('Poha (1 plate)').p} g), so add boiled chana or peanuts, and skip the jalebi.`],
  },
  northeast: {
    slug: 'north-east-indian-diet-plan',
    title: 'North-East Indian Diet Plan for Weight Loss',
    h1: 'North-East Indian diet plan for weight loss',
    cuisine: 'North-East Indian',
    desc: 'A free North-East Indian diet plan built from thukpa, steamed momos, river fish, greens and sticky rice — sample 1,500 and 2,000 kcal days with calories and protein.',
    lede: 'Food across the North-East is often boiled, steamed or fermented, with little oil — which already makes it one of the easiest cuisines in India to lose weight on. The rice portion and the fried versions of dishes are the things to keep an eye on.',
    tips: [
      ['It is already lean', 'Boiled greens, steamed fish and bamboo-shoot curries are low in oil. Keep cooking the way you already do.'],
      ['Steamed momos, not fried', `Six steamed veg momos are about ${food('Momos, steamed veg (6)').k} kcal. Fried momos are far more.`],
      ['Thukpa is a full meal', 'A big bowl of thukpa with chicken or tofu covers carbohydrate, vegetables and protein in one dish.'],
      ['Portion the sticky rice', 'Sticky rice is dense; half a cup goes further than it looks.'],
      ['Fish and greens', 'River fish with lai xaak or other greens is about as good as a weight-loss lunch gets.'],
    ],
    faq3: ['Are momos healthy for weight loss?', `Steamed momos can fit: six steamed veg momos are about ${food('Momos, steamed veg (6)').k} kcal with ${food('Momos, steamed veg (6)').p} g of protein. Choose steamed over fried, and go easy on the mayo.`],
  },
  pan: {
    slug: 'indian-diet-plan-for-weight-loss',
    title: 'Indian Diet Plan for Weight Loss (Free Sample Days)',
    h1: 'Indian diet plan for weight loss',
    cuisine: 'Indian',
    desc: 'A free Indian diet plan for weight loss built from everyday food — dal-roti, idli, poha, rajma-chawal — with sample 1,500 and 2,000 kcal days, calories and protein for every meal.',
    lede: 'You can lose weight on ordinary Indian home food. Dal, roti, rice, sabzi, curd, eggs and paneer are all fine — weight loss comes from eating a little less than you burn, consistently, and getting enough protein so it is fat you lose and not muscle.',
    tips: [
      ['Calories decide weight; protein decides what you lose', 'A steady deficit of about 500 kcal a day is roughly 0.45 kg a week. Enough protein makes sure most of it comes from fat.'],
      ['Portion the grains first', `A roti is about ${food('Roti / Chapati (1)').k} kcal and a cup of rice about ${food('Plain rice (1 cup)').k} kcal. Trimming grains is easier than cutting anything else.`],
      ['Cheap vegetarian protein', `Dal (${food('Dal cooked (1 cup)').p} g a cup), chana (${food('Chole cooked (1 cup)').p} g a cup), paneer (${food('Paneer (100g)').p} g per 100 g) and curd all count. Soya chunks are the cheapest of all.`],
      ['Watch the oil and ghee', 'Cooking fat is the hidden calorie in Indian food. Measure it for a week and you will see where the extra calories were.'],
      ['Chai adds up', `A cup of chai with milk and sugar is about ${food('Chai with milk & sugar').k} kcal. Four a day is a small meal.`],
    ],
    faq3: ['Do I need to eat chicken to get enough protein?', `No. Dal, rajma, chole, paneer, curd, sprouts and soya chunks can cover it. A cup of dal is about ${food('Dal cooked (1 cup)').p} g of protein and 100 g of paneer about ${food('Paneer (100g)').p} g. The free planner works out your target and fills any gap.`],
  },
};
const ORDER = ['pan', 'north', 'south', 'east', 'west', 'central', 'northeast'];

// ---- the same meal maths the planner uses --------------------------------
const SLOTS = [['Breakfast', 'B'], ['Lunch', 'L'], ['Dinner', 'D'], ['Snack', 'S']];
function pick(arr, tags, mode) {
  let ok = arr.filter(m => tags.includes(m.g));
  if (!ok.length) ok = arr.filter(m => m.g === 'v');
  return ok.slice().sort((a, b) => mode === 'protein' ? b.p - a.p : (b.p / b.k) - (a.p / a.k))[0];
}
function sampleDay(rid, tags, target, mode) {
  const R = REGIONS[rid].meals;
  const meals = SLOTS.map(([n, k]) => [n, pick(R[k], tags, mode)]);
  const base = meals.reduce((s, m) => s + m[1].k, 0);
  const scale = Math.max(0.75, Math.min(1.35, target / base)); // same clamp as buildDay()
  const rows = meals.map(([n, m]) => ({ slot: n, t: m.t, d: m.d, k: Math.round(m.k * scale), p: Math.round(m.p * scale), g: m.g }));
  return { rows, scale, k: rows.reduce((s, r) => s + r.k, 0), p: rows.reduce((s, r) => s + r.p, 0) };
}

// ---- rendering ------------------------------------------------------------
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TAG = { v: 'Veg', e: 'Egg', n: 'Non-veg' };

function dayTable(day, caption) {
  const note = Math.abs(day.scale - 1) < 0.005
    ? 'Portions as described.'
    : `Portions scaled ×${day.scale.toFixed(2)} from the descriptions — eat a little ${day.scale > 1 ? 'more' : 'less'} rice or roti than written.`;
  return `<div class="tbl"><table>
<caption>${esc(caption)}</caption>
<thead><tr><th scope="col">Meal</th><th scope="col">What to eat</th><th scope="col" class="n">kcal</th><th scope="col" class="n">Protein</th></tr></thead>
<tbody>${day.rows.map(r => `<tr><th scope="row">${r.slot}</th><td><b>${esc(r.t)}</b><span>${esc(r.d)}</span></td><td class="n">${r.k}</td><td class="n">${r.p} g</td></tr>`).join('')}</tbody>
<tfoot><tr><th scope="row">Day</th><td>${esc(note)}</td><td class="n">${day.k.toLocaleString('en-IN')}</td><td class="n">${day.p} g</td></tr></tfoot>
</table></div>`;
}

function mealList(rid) {
  const R = REGIONS[rid].meals;
  const names = { B: 'Breakfasts', L: 'Lunches', D: 'Dinners', S: 'Snacks' };
  return Object.keys(names).map(k => `<div class="ml"><h3>${names[k]}</h3><ul>${R[k].map(m =>
    `<li><span class="mt">${esc(m.t)} <i class="tg tg-${m.g}">${TAG[m.g]}</i></span><span class="mn">${m.k} kcal · ${m.p} g</span></li>`).join('')}</ul></div>`).join('');
}

function faqFor(rid) {
  const g = G[rid];
  return [
    [`Can I lose weight eating ${g.cuisine} food?`, `Yes. Weight loss comes from eating somewhat fewer calories than you burn, consistently — not from a particular cuisine. Keep the ${g.cuisine} meals you like, control the portion of rice or roti and the cooking fat, and get enough protein.`],
    ['How many calories should I eat to lose weight?', 'It depends on your age, height, weight, sex and how active you are. The free planner works it out with the Mifflin-St Jeor formula and subtracts 500 kcal a day, which is roughly 0.45 kg a week. It never goes below 1,500 kcal for men or 1,200 kcal for women.'],
    g.faq3,
  ];
}

const CSS = `:root{--bg:#07090f;--card:rgba(255,255,255,.045);--line:rgba(255,255,255,.09);--line2:rgba(255,255,255,.16);--ink:#eef2f8;--muted:#94a0b5;--g1:#34e58c;--g2:#0ec47a;--p:#5aa2ff;--c:#ffb84d;--f:#ff6b81}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--ink);line-height:1.6;-webkit-text-size-adjust:100%}
a{color:var(--g1)}
:focus-visible{outline:3px solid var(--g1);outline-offset:2px;border-radius:6px}
.wrap{max-width:760px;margin:0 auto;padding:0 18px}
header{border-bottom:1px solid var(--line);background:rgba(7,9,15,.9)}
.nav{display:flex;align-items:center;justify-content:space-between;height:58px;gap:12px}
.logo{display:flex;align-items:center;gap:9px;font-weight:800;font-size:18px;color:var(--ink);text-decoration:none}
.logo i{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,var(--g1),var(--g2));display:grid;place-items:center;font-style:normal;font-size:16px}
.btn{display:inline-flex;align-items:center;justify-content:center;border-radius:12px;padding:13px 20px;font-weight:800;font-size:15.5px;text-decoration:none;background:linear-gradient(135deg,var(--g1),var(--g2));color:#04160c}
.btn.sm{padding:8px 14px;font-size:13.5px}
.crumb{font-size:13px;color:var(--muted);margin:22px 0 10px}
.crumb a{color:var(--muted)}
h1{font-size:clamp(28px,6vw,42px);line-height:1.12;letter-spacing:-.03em;font-weight:850;text-wrap:balance;margin-bottom:14px}
h2{font-size:22px;letter-spacing:-.02em;margin:38px 0 10px;text-wrap:balance}
h3{font-size:15px;margin-bottom:6px}
p{max-width:66ch}
.lede{font-size:17.5px;color:#cfd7e4}
.cta{margin:22px 0 6px;display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.cta small{color:var(--muted);font-size:13px}
.tbl{overflow-x:auto;margin:12px 0 4px;border:1px solid var(--line);border-radius:14px;background:var(--card)}
table{border-collapse:collapse;width:100%;font-size:14.5px}
caption{text-align:left;padding:12px 14px 4px;font-weight:800;color:var(--ink)}
th,td{padding:10px 14px;text-align:left;vertical-align:top;border-top:1px solid var(--line)}
thead th{font-size:11.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);border-top:none}
tbody th,tfoot th{font-weight:700;color:var(--muted);white-space:nowrap}
td b{display:block;color:var(--ink)}
td span{display:block;color:var(--muted);font-size:13px}
.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
tfoot td,tfoot th{font-weight:800;color:var(--ink)}
tfoot td:nth-child(2){font-weight:500;color:var(--muted);font-size:12.5px}
@media(max-width:560px){th,td{padding:9px 8px}table{font-size:13.5px}tbody th,tfoot th{font-size:12px}td span{font-size:12px}thead th{font-size:10.5px;letter-spacing:.3px}caption{padding:12px 10px 4px}}
.note{font-size:14px;color:var(--muted);margin-top:8px}
.tips{list-style:none;display:grid;gap:10px;margin-top:12px}
.tips li{border-left:3px solid var(--g1);padding:4px 0 4px 14px}
.tips b{display:block}
.tips span{color:#c4ccd9;font-size:15px}
.mls{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:12px}
@media(max-width:600px){.mls{grid-template-columns:1fr}}
.ml ul{list-style:none}
.ml li{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-top:1px solid var(--line);font-size:14px}
.mn{color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.tg{font-style:normal;font-size:10.5px;font-weight:800;padding:1px 6px;border-radius:999px;margin-left:4px;vertical-align:1px}
.tg-v{background:rgba(52,229,140,.13);color:var(--g1)}.tg-e{background:rgba(255,184,77,.14);color:var(--c)}.tg-n{background:rgba(255,107,129,.14);color:var(--f)}
details{border:1px solid var(--line);border-radius:12px;background:var(--card);margin-top:10px}
summary{padding:13px 15px;font-weight:700;cursor:pointer}
details p{padding:0 15px 14px;color:#c4ccd9;font-size:15px}
.final{margin:40px 0 0;padding:24px 20px;border-radius:18px;border:1px solid rgba(52,229,140,.28);background:linear-gradient(160deg,rgba(52,229,140,.12),rgba(52,229,140,.03))}
.final h2{margin-top:0}
.others{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.others a{border:1px solid var(--line2);border-radius:999px;padding:7px 13px;font-size:13.5px;color:var(--ink);text-decoration:none}
footer{border-top:1px solid var(--line);margin-top:44px;padding:22px 0 30px;color:var(--muted);font-size:13px}
footer p{max-width:none;margin-top:8px;font-size:12px;color:#66738a}
@media print{body{background:#fff;color:#111}header,.cta,.final,.others,footer{display:none}.tbl{border-color:#ccc}}`;

function page(rid) {
  const g = G[rid];
  const url = `${SITE}/${g.slug}/`;
  const veg = sampleDay(rid, ['v'], 1500, 'lean');
  const nonveg = sampleDay(rid, ['v', 'e', 'n'], 2000, 'protein');
  const faq = faqFor(rid);
  const planner = `/?region=${rid}&amp;utm_source=guide-${rid}#planner`;
  const ld = [
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Diet AI', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: g.h1, item: url } ] },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => (
      { '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ];
  const others = ORDER.filter(x => x !== rid).map(x => `<a href="/${G[x].slug}/">${esc(G[x].h1.replace(/ for weight loss$/, ''))}</a>`).join('');

  return `<!DOCTYPE html>
<html lang="en-IN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(g.title)} | Diet AI</title>
<meta name="description" content="${esc(g.desc)}">
<link rel="canonical" href="${url}">
<meta name="theme-color" content="#07090f">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Diet AI">
<meta property="og:title" content="${esc(g.title)}">
<meta property="og:description" content="${esc(g.desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%A5%97%3C/text%3E%3C/svg%3E">
<script src="/events.js"></script>
<style>${CSS}</style>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body>
<header><div class="wrap nav"><a class="logo" href="/"><i aria-hidden="true">🥗</i> Diet AI</a><a class="btn sm" href="${planner}">Get my plan — free</a></div></header>
<main class="wrap">
<nav class="crumb" aria-label="Breadcrumb"><a href="/">Diet AI</a> › ${esc(g.h1)}</nav>
<h1>${esc(g.h1)}</h1>
<p class="lede">${esc(g.lede)}</p>
<div class="cta"><a class="btn" href="${planner}">Build my ${esc(g.cuisine)} plan at my calories</a><small>Free · no sign-up · 10 seconds</small></div>

<h2>A sample vegetarian day</h2>
<p>Built from ${esc(g.cuisine)} everyday meals, choosing the option with the most protein per calorie at each meal and scaling portions to about 1,500 kcal.</p>
${dayTable(veg, `Vegetarian · ${veg.k.toLocaleString('en-IN')} kcal · ${veg.p} g protein`)}
<p class="note">${veg.p < 90 ? `${veg.p} g of protein is below what most adults should aim for while losing weight. The free planner works out your own target from your weight and adds a top-up — soya chunks, paneer or curd — to close the gap.` : 'Protein here is in a healthy range for most adults losing weight.'}</p>

<h2>A sample higher-protein day</h2>
<p>The same region with eggs, chicken or fish allowed, choosing the highest-protein option at each meal, scaled to about 2,000 kcal — closer to what many men need while losing weight.</p>
${dayTable(nonveg, `With egg, chicken or fish · ${nonveg.k.toLocaleString('en-IN')} kcal · ${nonveg.p} g protein`)}

<h2>What makes the difference in ${esc(g.cuisine)} food</h2>
<ul class="tips">${g.tips.map(([b, s]) => `<li><b>${esc(b)}</b><span>${esc(s)}</span></li>`).join('')}</ul>

<h2>Every meal the planner builds ${esc(g.cuisine)} plans from</h2>
<p>Calories and protein per portion as described. The planner rotates through these and scales them to your target.</p>
<div class="mls">${mealList(rid)}</div>

<h2>How the numbers are worked out</h2>
<p>Your daily calorie need is estimated with the Mifflin-St Jeor equation, adjusted for activity. For weight loss we subtract 500 kcal a day — roughly 0.45 kg a week — and never go below 1,500 kcal for men or 1,200 kcal for women. Protein is set at 1.8 g per kg of body weight, using an adjusted weight above a BMI of 25 so the target stays realistic. Every calorie figure is an approximation of a typical home-cooked portion.</p>

<h2>Questions people ask</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n')}

<section class="final">
<h2>Your plan, at your calories</h2>
<p>These sample days are for an average person. Enter your age, height and weight and the planner builds a ${esc(g.cuisine)} day at your exact calorie and protein targets, with a water goal and a tracker.</p>
<div class="cta"><a class="btn" href="${planner}">Get my free plan</a><small>Private — nothing you enter leaves your phone.</small></div>
</section>

<h2>Diet plans for other regions</h2>
<div class="others">${others}</div>
</main>
<footer><div class="wrap">© ${new Date().getFullYear()} <a href="/">dietai.in</a> · Free Indian diet plans
<p>Diet AI provides general nutrition estimates for educational purposes only and is not medical advice. Calorie and protein figures are approximations. Consult a qualified doctor or registered dietitian before making significant changes to your diet, especially if you are pregnant, under 18, or managing a health condition.</p></div></footer>
</body>
</html>
`;
}

// ---- write pages + sitemap ------------------------------------------------
const written = [];
for (const rid of ORDER) {
  if (!REGIONS[rid]) throw new Error('index.html has no region ' + rid);
  const dir = path.join(ROOT, G[rid].slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), page(rid));
  written.push(G[rid].slug);
}

const today = new Date().toISOString().slice(0, 10);
const urls = [['/', '1.0'], ...written.map(s => ['/' + s + '/', '0.8'])];
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, p]) => `  <url>
    <loc>${SITE}${u}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>${p}</priority>
  </url>`).join('\n')}
</urlset>
`);

console.log('wrote', written.length, 'guides:', written.join(', '));
console.log('sitemap.xml:', urls.length, 'URLs');
