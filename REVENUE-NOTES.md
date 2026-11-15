# Diet AI — revenue notes

Written 2026-09-05. Conclusions live here, not in a chat transcript.

## 15 Nov 2026 — sixth pass: https only, and internal files off the site

**http:// was a live path.** GitHub Pages "Enforce HTTPS" is off (the certificate is ready
and the DNS check passes), so `http://dietai.in` serves the site too. That would have
broken the new payments in two ways: the Worker accepts only `https://` origins, so
checkout fails with `origin_not_allowed` for anyone on http; and browser storage is kept
per origin, so an unlock or a saved plan made on http is invisible on https. Fix in code:
the first script on every page sends http visitors to `https://dietai.in`, keeping the
path, the query (restore links) and the hash. Ticking the setting is step 9 in
`worker/README.md` and needs a yes.

**Internal notes were public pages.** With no `_config.yml`, Jekyll rendered this file as
a page at `https://dietai.in/REVENUE-NOTES` (status 200, checked 15 Nov) and served
`tools/*.js` and `build-preview.py`; after the merge it would also have served the Worker
source and its runbook. `_config.yml` now leaves `REVENUE-NOTES.md`, `README.md`,
`worker/` and `tools/` out of the build. The repo itself is public, so these files stay
readable on GitHub: keys and anything secret never go in the repo.

**Two Worker fixes before it goes live.** Restore accepted any amount when a payment carried
the `dietai` tag, but payment notes come from the browser — now a payment must be exactly ₹99
and not tagged for another product (your 21 Oct ₹99 payment, untagged, still restores). And
test-key payments were logged as `payment_verified`, the real sale count; they are now
`payment_verified_test`, so the coming test payment can't show up as a sale.

**One more door from search: `/vegetarian-indian-diet-plan/`.** "Vegetarian diet plan for
weight loss" is a common diet search in India (volume not measured — check Search Console
once it has data), and no page answered it. Three
vegetarian days (no egg or meat) at 1,500 kcal — the highest-protein vegetarian day each
region's meals allow, skipping the two regions the 1,500 kcal page already shows, so no table
is duplicated — plus a vegetarian protein table sorted by protein per 100 kcal (soya chunks
first). Every figure, including the 1.6 g/kg protein goal, is read from `index.html`. Linked
from the homepage footer, the guides and the calorie pages; the sitemap now has 13 URLs.

**Muscle-gain plans now reach their target.** Meals stop growing at 1.35× portions, so for a
young man building muscle (targets around 2,750–3,200 kcal) every day came out 500–1,100 kcal
short, with only a note to "add a roti". A new "Extra to reach your target" row closes the gap
with everyday foods in the tracker's own figures — toned milk, banana, peanuts, roti — and is
counted in the day totals, the paid week, the grocery list, the printout and the WhatsApp text.
Across 882 plan-days (6 bodies × 7 regions × 3 diets × 7 days) every day now lands within 5% of
its target. Fat-loss plans at light activity never get an extra, so the main audience sees no change.

**A page for the other half of the planner: `/indian-diet-plan-for-weight-gain/`.** Now
that gain plans reach their target, they get a door from search too: three days at 2,800 kcal
(non-veg, egg, vegetarian), each built with the planner's own `EXTRA` list and `extraFor()`
code read from `index.html`, so the page and the app can't drift apart. Its button opens the
planner on Build muscle (`?goal=gain`, a new preset). Guide tables now say how much more or
less rice/roti to eat ("about 35% more") instead of "a little". Sitemap: 14 URLs.

**Tracker rolls over at midnight.** "Today" was fixed when the page loaded, and phones keep tabs
open for days, so yesterday's food, water and weight entry carried into today until a reload. Every tracker
action and every return to the tab now checks the date first.

**Fuzzed the planner across every body the form accepts** (ages 18–100, 120–230 cm, 30–300 kg,
both sexes, all goals, activities, diets and regions): 456 accepted bodies × 7 days, no broken
numbers, and every day that misses its target says so. The days that still miss are extreme:
targets above ~3,700 kcal (200–300 kg, or 230 cm athletes), where meals at 1.35× plus the largest
extra can't reach, and tiny women at the 1,200 kcal floor (up to ~100 kcal over). Open question
for a nutritionist, not code: for very high BMIs the formula uses actual weight, so a 300 kg
"athlete" gets a fat-loss target near 7,800 kcal; an adjusted weight would be more sensible.

**Decision (owner, 15 Nov): live Razorpay keys directly, no test-mode payment.** The live keys
will be checked without spending — a restore with the 21 Oct ₹99 payment and a ₹99 order
created but not paid — then the real checkout opened and closed on dietai.in after the merge.
Deploying waits for the owner's "yes, deploy DietAI" (asked 15 Nov: "Not yet").

**Terms, privacy and delivery page (`/policies/`).** The site took ₹99 with no terms, privacy or
delivery page, and the Razorpay customer-support contact (phone, email, website) is empty, so
receipts show no way to reach the seller. Owner's choices (15 Nov): seller shown as "Diet AI"
only; no contact email yet; no refund promise yet; leave Razorpay's support details empty.
The page covers terms, pricing (₹99 one time), privacy (written from what the code actually
sends and stores) and delivery (digital, instant, "Already paid?" if it doesn't open). Linked
from every footer, kept out of the sitemap. The data FAQ now says a made plan's region, diet,
goal and calorie target are counted, and that the payment ID and amount are kept — it used to
say plans are never uploaded. Still open: a contact route. Razorpay's own guidance sends
buyers to the seller's contact page, and buyers who can't reach a seller go to their bank.

**Checks:** 202, all passing. New: http → https on the planner, a guide and a calorie page,
a restore link survives the move, nothing moves with JavaScript off or on localhost, and
the build config leaves out the internal files while keeping all 22 files the site needs.

## 14 Nov 2026 — fifth pass: verified payments, honest day totals, toned-down claims

Supersedes the "honour-based paywall" and "every day hits protein" lines further down.

**Payments.** The pack unlocked from a URL anyone could type (`/?premium=unlocked`), the
restore link was that same URL, and `premium_unlocked` fired whenever it was opened. Now
the page opens Razorpay's checkout itself (UPI first), the Worker (`worker/index.js`,
deployed as `dietai-events`) creates the order at a fixed ₹99, checks Razorpay's signature
and the payment, and issues a signed unlock token. The URL does nothing; the legacy
`dietai_premium` flag is ignored. A UPI app that kills the browser tab no longer loses the
sale: the order ID is saved first and checked on return. Customers restore on a new phone
with their payment ID or a personal restore link. Razorpay data, 14 Nov: the one stranger
who tried to pay (21 Oct) failed with `payment_timed_out` at `payment_authentication` —
the UPI request was never approved in their app. Checkout now says exactly that, says no
money was taken, and offers the retry.

**The authoritative sale metric is now `payment_verified`**, written by the Worker after
Razorpay confirms the money (one row per payment). Runs on test keys are logged as
`payment_verified_test` instead, so they never count. `premium_unlocked` is secondary.

**Calories.** Top-up calories were never counted: across 735 plan-days (7 regions × 3
diets × 5 body types × 7 days) the real day ran a median **+667 kcal** over target, worst
+1,087 — the whole fat-loss deficit and more. Now meals shrink to make room (to the usual
75% floor), the top-up is capped by the calories left (+3% slack), and every total shown —
planner, free Monday, the 7 days, print, WhatsApp text — is meals + top-up. After: median
+29 kcal, worst +67, none hidden. Top-up order is now by protein per calorie (soya, eggs,
paneer, curd).

**The trade-off this exposed, and the call made (15 Nov).** With calories honest, the
1.8 g/kg protein target was out of reach on most weight-loss days. It is now **1.6 g/kg** —
the top of the 1.2–1.6 g/kg range the ISSN position stand gives for the general population
(see "Protein target evidence" below). Days that still fall short say so ("still ~X g short
of your protein goal"). One constant, `PROTEIN_PER_KG` in `generatePlan()`:

| protein target | weight-loss plan-days >8 g short (of 441) |
|---|---|
| 1.8 g/kg (until 15 Nov) | 426 (97%) |
| **1.6 g/kg (now)** | 248 (56%) |
| 1.4 g/kg | 64 (15%) |

Delivered protein on those days is still ~1.5 g/kg of adjusted weight (median).

**Claims removed or softened** (no qualified person has checked them): "the formula
dietitians use", "same formulas dietitians use" (1.8 g/kg is not that), "the pace most
dietitians consider sustainable", "safe minimum", "exact calorie targets", "AI nutrition
coach", "Healthy weight" (now "BMI 18.5–25 range" — Indian guidelines use a lower upper
cut-off; also a decision for an expert), guide lines such as "makes sure most of it comes
from fat", "ideal weight-loss meal", "what most adults should aim for". The page `<title>`
still says "Free AI Diet Plan" — left alone on purpose (it is what ranks; decide with
Search Console data).

**Funnel, read from D1 on 14 Nov (27 Oct–14 Nov).** Home page visits: Google 26, Bing 8,
Yahoo/DuckDuckGo 3, "direct" 37 (owner, deploy bots, tests). The 7 regional guides: 1 visit.
Plans built: 34 from search. ₹99 clicks from search visitors: **0** (the one click was the
owner). So the blocker is attention and traffic, not checkout: the offer sat below the
tracker buttons. Added a "See all 7 days" button under the plan and two events,
`premium_seen` and `week_cta_click`, to tell whether people now reach the offer.

**Search.** dietai.in had never been added to Google Search Console (no property on
sudhanshuxg@gmail.com), so Google was never sent the sitemap — likely why the guides get
no visits. A URL-prefix property for https://dietai.in/ was created on 14 Nov;
`googlea16ee8de3adc33ae.html` verifies it once the site is deployed. Then submit
`sitemap.xml` and request indexing for the guides. `2cae93f145dcf1d71723273726fad40a.txt`
is the IndexNow key (Bing, Yandex) — no account needed. Four calorie-level pages added
(1,200 / 1,500 / 1,800 / 2,000 kcal), generated from the planner's data.

**Protein target evidence (for the decision above).** ICMR-NIN 2020 RDA for healthy
Indian adults: 0.83 g/kg (1 g/kg on cereal-based diets). ISSN position stand on diets for
body-weight reduction: 1.2–1.6 g/kg for the general population, 1.6–2.2 g/kg with
resistance training. The planner's 1.8 g/kg sits above the general-population range;
1.6 g/kg is the top of it — now the planner's target.

**Checks.** `tools/check.js` now runs the real Worker code against a fake Razorpay that
signs payments exactly as Razorpay does (fresh secret per run): 156 checks, all passing.
The same checks against the previous `main`: 36 fail, including the free URL unlock and
every unchecked claim. Deploy steps: `worker/README.md`.

## The finding that matters most

**Until this change, dietai.in could not report a sale.** Two independent bugs:

1. `index.html` stripped `?premium=unlocked` from the URL with `history.replaceState`
   during parsing. `events.js` was loaded with `defer`, so it ran *after* the strip
   and always saw a clean URL. `premium_unlocked` never fired — not once, ever.
2. The click tracker listened for `#premiumBtn`, an element that only existed
   inside the retired `premium.js`. The real CTA is `#payBtn`. Never tracked.

So `page_view` and `plan_generated` were the only events reaching the Worker.
**A conversion rate of zero and a conversion rate that is never measured look
identical in that data.** Any conclusion previously drawn about whether Diet AI
sells was drawn from an instrument that could not report a sale.

Fix: `events.js` now loads early (not deferred) and exposes `window.dietaiLog`;
the page calls it explicitly. There is also a backstop — if a browser is premium
but the purchase was never reported, it reports on the next visit, which covers
the stale-CDN case.

## Event contract (Worker `dietai-events`)

The Worker only stores events on its allow-list (read from its live source,
2026-10-26). Anything else gets a 400 and is dropped silently.

| event | when | stored today? |
|---|---|---|
| `page_view` | once per tab session — meta: page path | yes |
| `plan_generated` | every plan build — meta: region, diet, goal, target | yes |
| `premium_click` | the real ₹99 CTA — meta: whether a plan existed | yes |
| `premium_unlocked` | **the sale.** Fired before the URL is stripped. Once per browser, ever. | yes |
| `pack_opened` | a paying customer built their 7 days | yes |
| `share_plan` / `share_week` | WhatsApp share | **no — needs Worker change** |
| `pack_printed` | customer printed the pack | **no — needs Worker change** |
| `restore_copied` | customer saved their restore link | **no — needs Worker change** |

The whole purchase funnel is on the allow-list. The four secondary events need
one line changed in the Worker — a code change, not a key:
Cloudflare dashboard → Workers & Pages → `dietai-events` → Edit code → replace line 3 with

```js
const ALLOWED_EVENTS = ['page_view', 'plan_generated', 'premium_click', 'premium_unlocked', 'pack_opened', 'share_plan', 'share_week', 'pack_printed', 'restore_copied'];
```

→ Deploy.

## What the data actually says (D1 + Razorpay, read 2026-10-26)

| | Jul | Aug | Sep | Oct |
|---|---|---|---|---|
| page views | 23 | 17 | 19 | 63 |
| plans built | 0* | 9 | 12 | 47 |

\* plan logging started 9 Aug.

- **Search is the only channel that works, and it converts.** Google: 45 views →
  43 plans. Bing: 19 views → 20 plans (plans can repeat in one visit). "Direct": 46
  views → 2 plans — that bucket is the owner, tests, bots and PWA opens; ignore it.
  No social, no WhatsApp, no ads.
- **October tripled.** Whatever Google started doing in October, it is the growth.
- **Razorpay, Jul–Oct: two ₹99 attempts.** 21 Oct — a real customer (not the owner)
  tried to pay; UPI **timed out** on the customer side, no money taken. 26 Oct — the
  owner's own test payment, captured; one minute later D1 recorded a visit referred
  by `pages.razorpay.com` and **no `premium_unlocked`** — the tracking bug reproduced
  live with real money. Neither attempt produced a `premium_click` either.
- So: a stranger found the site through search, built a plan, and tried to pay. n=1,
  so it proves the path exists, not a conversion rate.

`source` is **first-touch** and survives the Razorpay round-trip. Without that,
every sale would be attributed to `pages.razorpay.com`. Shares carry
`?utm_source=whatsapp` so referral traffic is distinguishable from direct.

The funnel to watch: `page_view → plan_generated → premium_click → premium_unlocked`.
The drop between the last two is the only number that decides anything.

## What changed in the offer, and why

- **Monday is free and visible.** The locked section used to *describe* the pack in
  bullet points. It now renders the customer's real Monday — their region, their
  calories, their protein — with Tuesday–Sunday blurred behind a lock. People buy a
  plan they have already seen work for them, not a description of one.
- **Removed the `₹499` strikethrough.** If ₹499 was never a real price, that is a
  fabricated anchor. It risks the Razorpay account and it is the kind of thing that
  costs more trust than it buys. Replaced with claims that are true and checkable:
  ₹99 one-time, not a subscription, 28 meals, one shopping list.
  *(India's CCPA dark-pattern guidance likely covers fake discounts — **ASSUMED**,
  not verified with a lawyer.)*
- **Price left at ₹99.** There is no evidence to move it, and there won't be until
  the funnel above has run for a while. Do not change it on a hunch.

## What changed in the product

- **The grocery list was broken.** It split meal text on `+` and stripped quantities
  with a loose regex, producing `-egg curry`, `paneer paratha, 1 cup curd`, and —
  because the unit list matched the `g` in `guava` — an item called `uava`. That was
  the main thing people were paying for. Replaced with a real ingredient map: actual
  weights in g/kg, grouped by aisle, scaled to the customer's own portions.
- **The pack did not hit its protein claim.** Portions were scaled to calories only.
  A South-Indian veg day delivered ~57g against a 133g target while the page said
  "every day hitting your calories and protein". Added a protein top-up per day from
  cheap Indian sources, capped at amounts a person will actually eat, and it says so
  honestly when the target still can't be reached. Verified across 7 region/diet/sex
  combinations: every day now lands within a few grams of target.
- **Protein target uses adjusted body weight** above BMI 25 instead of scale weight,
  capped at 35% of calories. 1.8 g/kg of a 120 kg body asked for 216 g/day.
- **`premium.js` retired.** It was a pre-v2 module re-enabled by a commit that
  believed the ₹99 button was missing; it wasn't. It injected a second, light-themed
  ₹99 card whose 7-day pack ignored the customer's region entirely — contradicting
  the one thing the product sells. Left as a no-op stub, not deleted, because the
  Pages CDN has served stale HTML twice.
- **Privacy copy corrected.** The site claimed "nothing is uploaded" while beaconing
  page views to a Worker. Now states plainly what is and isn't collected.
- **Restore link.** "Yours forever on this device" was a promise the site couldn't
  keep — one cleared cache and a paying customer had no recourse. They can now copy
  a restore link. Note this is not DRM: `?premium=unlocked` already unlocked for
  anyone who typed it, so this adds no new leak. The paywall is honour-based by
  design, which is a reasonable trade at ₹99 with no backend.

## Verified vs not

**Verified** — ran headless Chromium against the built files: purchase event fires,
CTA click fires, plan/preview/week/grocery all render, 7 region×diet×sex cases all
hit protein target, no page errors, no malformed grocery rows. Analytics requests
were intercepted so the test could not pollute real funnel data. No payment was
attempted.

**Not verified** — this environment's network policy blocked `dietai.in` and
`pages.razorpay.com`, so I could not confirm the live site matches this repo, nor
that the payment link is live. Per the standing rule about the Pages CDN: fetch the
live files with a cache-buster after deploying and check before judging.

## Second pass — quality, print, discoverability

**The paid pack was unprintable.** It is sold on "Print / save as PDF — fridge,
family, or your cook", and the page had no print stylesheet at all: printing gave
you the nav, the hero, the pricing block, the FAQ and the footer, with the plan
itself in near-white text on white paper because the generated rows use the dark
theme's `var(--ink)` inline. There is now a real print stylesheet that redefines
the tokens for paper, hides every marketing element, keeps days from splitting
across pages, and stamps a header with the customer's region, targets and date.
`printPack()` also forces all seven days open before printing and restores them
after — collapsed `<details>` print collapsed, so six of the seven days were
missing from the printout.

**Accessibility.** Not one input on the page had an associated label — every
`<label>` was a bare tag next to its field, so a screen reader announced nothing.
Fixed with `for`/`id` throughout, plus `aria-label` on the two fields that had no
label element. Also added: real tablist semantics with arrow-key navigation,
`aria-pressed` on all the goal/diet/sex/region toggles, named water glasses,
a live region on the toast, and a visible keyboard focus ring — there was none.

**Discoverability.** Added `robots.txt`, `sitemap.xml`, and JSON-LD
(`WebApplication` + `FAQPage`). The FAQ markup is generated *from* the page's own
FAQ text by the build step, so it cannot drift from what visitors actually read —
mismatched FAQ markup is a manual action risk, not just a wasted opportunity.
`lang` corrected to `en-IN`.

**Data cost.** The decorative hero orb pulls ~600 KB of Three.js. It now also
skips on Data Saver, on 2G/3G, and on sub-4-core devices. On an Indian mobile
plan that is somebody's actual money being spent on a background animation.

## Third pass — more doors from search, and a trust bug

**Seven regional guide pages** (`/south-indian-diet-plan/`, `/west-indian-diet-plan/`
for Gujarati & Maharashtrian, etc., plus a pan-India one). Each has two sample days
(1,500 kcal veg and 2,000 kcal higher-protein), cuisine-specific tips, every meal the
planner uses with calories and protein, and a FAQ mirrored in JSON-LD. Every number
is read from the app's own meal data by `tools/build-guides.js`, so a guide can never
contradict the planner. Each CTA opens the planner already set to that region. The
homepage footer links to all of them; `sitemap.xml` lists them. This is distribution,
not features: search is the only channel with evidence behind it.

**Returning visitors could get the wrong diet.** Rebuilding a saved plan (the free
preview, the paid week, the share text) wrote the saved plan's region and diet into
the live selection without updating the buttons. A non-veg plan saved on a phone,
then a vegetarian opens the site: "Veg" highlighted, chicken in the plan. The paid
week always had this; the preview made it hit every returning visitor. Now region and
diet are passed into the meal builder, never written back. The share text had an
older version of the same bug (named the saved region, built from the current one).
`tools/check.js` covers it for both free and paying visitors, and was proven to fail
when the bug is put back on either path.

**Service worker cached every page as `/index.html`.** Harmless with one page, wrong
the moment guides existed: visiting one would have overwritten the installed app's
offline copy, and a 404 would have been cached as the app. Each page is now cached
under its own URL, only on success.

**Guide tables fit a 360 px phone** — no sideways scroll to see calories and protein.

## Fourth pass — critic review before merge (attacked in a browser)

| | finding | fix |
|---|---|---|
| P0 | Typos became confident wrong plans: weight "2" → plan for a 25 kg adult, "BMI 8.7"; height "17" → "BMI 72". Inputs were clamped, not rejected. | Out-of-range values are rejected with a message naming the field; impossible height/weight combinations (BMI < 12 or > 80) too. Only the field at fault is flagged. |
| P0 | A 12-year-old got a 1,500 kcal weight-loss plan (field said min 14, code accepted 10+). | Minimum age **18** — the formulas are adult formulas and the disclaimer already says so. One constant, `MIN_AGE`, if you decide otherwise. |
| P1 | The "7-day" pack rotated only two dishes for lunch, dinner and snack for anyone with a protein target ≥ 100 g (most adults) — in all 21 region×diet combinations. | Rotate through every allowed dish, highest-protein first; the daily top-up covers the gap. Monday is unchanged, so the free preview still matches. |
| P1 | After paying in the Razorpay tab, the tab the customer started in still showed the ₹99 offer and a live pay button. | That tab now unlocks itself when the purchase is recorded (storage event, plus a re-check on focus). |
| P1 | "Odia" and "Chhattisgarh" in guide titles with no dish from either on the page. | Titles now name only what's there: Bengali & Bihari; Madhya Pradesh. |
| P2 | Screen readers read the blurred locked days aloud. | Hidden from assistive tech; the lock caption still reads. |
| P2 | "Free AI Diet Plan" title vs "No fake AI magic" on the same page. | **Not changed** — that title is what Google ranks right now. Decide with Search Console data. |

**Protein, honestly.** Checked every day of every week (735 plan-days across 7 regions,
3 diets, 5 body types): before the variety fix 32 days ended > 8 g short of target even
with the maximum top-up; after it, 38 (5%) — mostly heavy vegetarians, worst 28 g. Those
days already say so on the page. The offer copy no longer claims protein is always hit;
it promises the calorie target with a daily protein top-up, which is true on every day.

Every fix has a check in `tools/check.js`, and the new checks were run against the
previous commit to prove they fail there (10 failures) and pass here.

## Tools (not part of the site)

- `tools/check.js` — end-to-end checks in headless Chromium: funnel events, protein
  targets across regions, grocery list, the saved-plan bug (free + paid), accessibility,
  print output, guides, sitemap. Intercepts the Worker and blocks Razorpay, so it can't
  pollute data or take money. `npx http-server -p 8099 -s . & node tools/check.js`
- `tools/build-guides.js` — regenerates the guides and sitemap from the meal data.
- `tools/build-preview.py <dir>` — builds the Claude-artifact preview (analytics
  stubbed, payments off, links made relative).

## Preview

A working preview of this build is published as a Claude artifact — homepage plus all
seven guides, with analytics stubbed out and the Razorpay link neutralised. It has a
toggle for the visitor view and the paying-customer view.

## Open decisions (not mine to make)

1. **Protein target.** Now 1.6 g/kg, the top of the ISSN general-population range (it was
   1.8). A qualified nutritionist should still sign off on it and on the "BMI 18.5–25"
   wording before either is stated as advice.
2. **The grocery list is the wedge to real money.** It is now a clean, quantified
   list of Indian staples — one step from a Blinkit/Zepto basket. That is a
   commission on something the customer was going to buy anyway, and it recurs,
   unlike a ₹99 one-off. Needs an affiliate account, so it is a decision, not a build.
3. **Distribution, not features.** The standing rule is that features before the
   first payment are the wrong work. Everything above is a bug fix, a measurement
   fix, or an honesty fix — not new surface area. The next thing is traffic.
