# Diet AI — AI backend

A small Cloudflare Worker that proxies Claude API calls for the two real AI
features on dietai.in:

- **AI food logger** — free-text meal description → itemised calories/protein
- **AI daily tip** — one short personalised tip from today's tracked numbers

The site is a static page with no server, so the Anthropic API key can't live
in the browser. This Worker holds the key and only exposes two narrow,
input-validated endpoints.

## Deploy

```bash
cd worker
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY   # paste your Anthropic API key
npx wrangler deploy
```

Wrangler prints the deployed URL, e.g. `https://dietai-ai.<your-subdomain>.workers.dev`.

Then open `index.html` at the top of the `<script>` block and set:

```js
const AI_ENDPOINT = "https://dietai-ai.<your-subdomain>.workers.dev";
```

## Config

- `ANTHROPIC_API_KEY` (secret, required) — your Anthropic API key.
- `ALLOWED_ORIGINS` (var, optional) — comma-separated list of origins allowed
  to call the Worker. Defaults to `https://dietai.in,https://www.dietai.in`.
  Add your local dev origin here while testing (e.g. `http://localhost:5500`).

## Notes

- Uses `claude-haiku-4-5` — fast and cheap, appropriate for short parsing/tip
  tasks. Input text is capped at 300 characters per request to bound cost.
- CORS is locked to `ALLOWED_ORIGINS`; requests from other origins get a 403.
- For abuse protection at scale, add a Cloudflare Rate Limiting rule on the
  route in the dashboard (this Worker doesn't implement its own rate limiter).
