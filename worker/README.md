# dietai-events Worker — how to put it live

`worker/index.js` is the full source of the Cloudflare Worker `dietai-events`
(funnel events + ₹99 payments). It is not built or bundled: the file is pasted as-is.

Order matters: **Worker first, test on the preview, live keys, then the site.** The site's
pay button needs the Worker's `/pay/*` routes, and those need the Razorpay keys. Test
payments run on the Vercel preview, never on dietai.in — with test keys a visitor could
"pay" with Razorpay's fake Success button and get the pack free.

**Chosen path (owner, 15 Nov 2026): live keys directly, no test payment — skip steps 2–3.**
After step 4, check the live keys without spending anything, from a tab on `https://dietai.in`
(the only origin a Worker with live keys accepts): POST `/pay/restore` with the owner's 21 Oct
₹99 payment ID should answer `{"ok":true,"token":…}`, and POST `/pay/order` should create a ₹99
order (nobody pays; it just stays unpaid). After the merge, open the real checkout on dietai.in
and close it without paying. The first real purchase exercises the signature check; if that ever
failed, the status check and restore-by-payment-ID still unlock the buyer.

| # | Step | Who | Check |
|---|------|-----|-------|
| 1 | Cloudflare → Workers & Pages → `dietai-events` → **Edit code** → replace everything with `worker/index.js` → **Deploy** | Claude (with your yes) or you | `https://dietai-events.sudhanshuxg.workers.dev/api/health` shows `"payments":{"configured":false,"mode":"off"}` |
| 2 | Razorpay → **Test mode** → Account & Settings → API Keys → **Generate key**; Cloudflare → `dietai-events` → Settings → **Variables and Secrets** → add Secrets `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` | you (Claude never types keys) | health shows `"configured":true,"mode":"test"` |
| 3 | Test payment on the **Vercel preview** of the branch: Unlock → Netbanking → any bank → **Success** (no card numbers needed); also try **Failure** | Claude or you | pack unlocks after Success, stays locked after Failure; `/funnel` shows `payment_verified_test` (test runs never count as sales) |
| 4 | Replace both secrets with the **live** key pair (`rzp_live_…`) | you | health shows `"mode":"live"` |
| 5 | Merge the PR — GitHub Pages deploys `main` to dietai.in | Claude, on "yes, deploy DietAI" | `https://dietai.in/sw.js?x=1` says `dietai-v6`; `https://dietai.in/REVENUE-NOTES` is gone (404) |
| 6 | Live check without spending: on dietai.in, "Already paid?" → your own earlier ₹99 payment ID from Razorpay → Restore | Claude or you | pack unlocks |
| 7 | Deactivate the old payment page `pages.razorpay.com/dietai-premium` | you | nobody can pay outside the verified flow |
| 8 | Tell search engines about the new pages: Search Console → verify (file `googlea16ee8de3adc33ae.html` is in the repo) → Sitemaps → `sitemap.xml`; Bing and others: submit the sitemap's URLs to IndexNow with key `2cae93f145dcf1d71723273726fad40a` (key file in the repo root) | Claude | Search Console shows the sitemap as Success |
| 9 | GitHub → repo **Settings → Pages → Enforce HTTPS** (tick it; the certificate is ready and the DNS check passes) | Claude (with your yes) or you | `http://dietai.in` answers with a redirect to `https://`. Until then the page script does the same move, so no one pays or saves a plan on `http://` |

Key reuse: ClaimFight's Worker uses the same secret names, so one Razorpay key pair can
serve both. Razorpay shows a Key Secret only once — if you regenerate the key, put the new
secret into **both** Workers, or ClaimFight's checkout stops working.

`ADMIN_KEY` is not set (checked 15 Nov): `/funnel` answers 401 until it is added as a Secret.
Claude reads the D1 table directly, so nothing depends on it.

What the secrets do: the Key ID is public (Razorpay checkout shows it). The Key Secret
creates orders, checks Razorpay's payment signatures and signs unlock tokens. Rotating it
invalidates every unlock token; customers' pages re-issue theirs from the payment ID inside.

What is published: `_config.yml` keeps the revenue notes, this README, the Worker source and
`tools/` out of the GitHub Pages build. They stay in the repo, and the repo is public, so
anything secret still never goes in a file here — keys live only in Cloudflare.

Rollback: Cloudflare keeps previous Worker versions (Deployments → roll back). The new code
keeps `/e`, `/api/health` and `/funnel` working exactly as before.
