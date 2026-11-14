# dietai-events Worker — how to put it live

`worker/index.js` is the full source of the Cloudflare Worker `dietai-events`
(funnel events + ₹99 payments). It is not built or bundled: the file is pasted as-is.

Order matters: **Worker first, test on the preview, live keys, then the site.** The site's
pay button needs the Worker's `/pay/*` routes, and those need the Razorpay keys. Test
payments run on the Vercel preview, never on dietai.in — with test keys a visitor could
"pay" with Razorpay's fake Success button and get the pack free.

| # | Step | Who | Check |
|---|------|-----|-------|
| 1 | Cloudflare → Workers & Pages → `dietai-events` → **Edit code** → replace everything with `worker/index.js` → **Deploy** | Claude (with your yes) or you | `https://dietai-events.sudhanshuxg.workers.dev/api/health` shows `"payments":{"configured":false,"mode":"off"}` |
| 2 | Razorpay → **Test mode** → Account & Settings → API Keys → **Generate key**; Cloudflare → `dietai-events` → Settings → **Variables and Secrets** → add Secrets `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` | you (Claude never types keys) | health shows `"configured":true,"mode":"test"` |
| 3 | Test payment on the **Vercel preview** of the branch: Unlock → Netbanking → any bank → **Success** (no card numbers needed); also try **Failure** | Claude or you | pack unlocks after Success, stays locked after Failure; `/funnel` shows `payment_verified` |
| 4 | Replace both secrets with the **live** key pair (`rzp_live_…`) | you | health shows `"mode":"live"` |
| 5 | Merge the PR — GitHub Pages deploys `main` to dietai.in | Claude, on "yes, deploy DietAI" | `https://dietai.in/sw.js?x=1` says `dietai-v6` |
| 6 | Live check without spending: on dietai.in, "Already paid?" → your own earlier ₹99 payment ID from Razorpay → Restore | Claude or you | pack unlocks |
| 7 | Deactivate the old payment page `pages.razorpay.com/dietai-premium` | you | nobody can pay outside the verified flow |

Key reuse: ClaimFight's Worker uses the same secret names, so one Razorpay key pair can
serve both. Razorpay shows a Key Secret only once — if you regenerate the key, put the new
secret into **both** Workers, or ClaimFight's checkout stops working.

What the secrets do: the Key ID is public (Razorpay checkout shows it). The Key Secret
creates orders, checks Razorpay's payment signatures and signs unlock tokens. Rotating it
invalidates every unlock token; customers' pages re-issue theirs from the payment ID inside.

Rollback: Cloudflare keeps previous Worker versions (Deployments → roll back). The new code
keeps `/e`, `/api/health` and `/funnel` working exactly as before.
