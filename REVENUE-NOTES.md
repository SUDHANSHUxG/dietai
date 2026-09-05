# Diet AI — revenue notes

Written 2026-09-05. Conclusions live here, not in a chat transcript.

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

| event | when |
|---|---|
| `page_view` | once per tab session |
| `plan_generated` | every plan build — meta: region, diet, goal, target |
| `premium_click` | the real ₹99 CTA — meta: whether a plan existed |
| `premium_unlocked` | **the sale.** Fired before the URL is stripped. Once per browser, ever. |
| `week_built` | a paying customer built their 7 days |
| `share_plan` / `share_week` | WhatsApp share — the only real distribution channel |
| `restore_copied` | customer saved their restore link |

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

## Open decisions (not mine to make)

1. **Is 1.8 g/kg the right target?** It is achievable now, but for a heavier veg
   customer it means ~800 g curd + 200 g paneer daily, which is expensive. 1.6 g/kg
   would be gentler and cheaper. This is a nutrition position, so it needs a human.
2. **The grocery list is the wedge to real money.** It is now a clean, quantified
   list of Indian staples — one step from a Blinkit/Zepto basket. That is a
   commission on something the customer was going to buy anyway, and it recurs,
   unlike a ₹99 one-off. Needs an affiliate account, so it is a decision, not a build.
3. **Distribution, not features.** The standing rule is that features before the
   first payment are the wrong work. Everything above is a bug fix, a measurement
   fix, or an honesty fix — not new surface area. The next thing is traffic.
