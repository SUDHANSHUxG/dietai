// dietai-events — Cloudflare Worker for dietai.in
//   1. funnel events   POST /e            (unchanged contract, wider allow-list)
//   2. ₹99 payments    POST /pay/order    create a Razorpay order (price fixed here, never by the page)
//                      POST /pay/verify   check Razorpay's signature + the payment, issue an unlock token
//                      POST /pay/status   "did this order get paid?" — for when the UPI app killed the tab
//                      POST /pay/restore  unlock again from a payment ID (pay_...) on a new phone
//                      POST /pay/check    is this unlock token one we issued?
//   3. health          GET  /api/health   never shows a secret, only whether payments are switched on
//   4. owner funnel    GET  /funnel?key=  (ADMIN_KEY)
//
// Source of truth: github.com/SUDHANSHUxG/dietai — worker/index.js. The live copy is pasted
// into Cloudflare → Workers & Pages → dietai-events → Edit code.
//
// Bindings / secrets (Worker → Settings → Variables and Secrets):
//   EVENTS               D1 database (already bound)
//   ADMIN_KEY            secret (already set) — for /funnel
//   RAZORPAY_KEY_ID      secret — rzp_test_... first, rzp_live_... when going live
//   RAZORPAY_KEY_SECRET  secret — shown once by Razorpay when the key is generated
// Same names as the ClaimFight worker, so one Razorpay key pair can serve both.
//
// Why this exists: the ₹99 pack used to unlock from a URL (?premium=unlocked). Anyone who
// typed it got the pack, and the funnel counted a "sale" whenever the URL was opened. Now
// the page only unlocks with a token this Worker issues after Razorpay confirms the money.

const SITE_ORIGINS = ['https://dietai.in', 'https://www.dietai.in'];
const ALLOWED_EVENTS = [
  'page_view', 'plan_generated', 'premium_click', 'premium_unlocked', 'pack_opened',
  'share_plan', 'share_week', 'pack_printed', 'restore_copied',
  'checkout_opened', 'checkout_error', 'checkout_closed', 'payment_failed',
  'restore_used', 'legacy_unlock_link', 'premium_seen', 'week_cta_click', 'js_error',
];
const PRICE_PAISE = 9900; // ₹99 — the only place the price is decided
const CURRENCY = 'INR';
const RZP_API = 'https://api.razorpay.com/v1';
const ID_RE = { order: /^order_[A-Za-z0-9]{6,40}$/, pay: /^pay_[A-Za-z0-9]{6,40}$/, sig: /^[a-f0-9]{64}$/ };
const TOKEN_RE = /^v1\.(pay_[A-Za-z0-9]{6,40})\.(\d{9,11})\.([a-f0-9]{64})$/;

// ---------------------------------------------------------------- helpers
const enc = new TextEncoder();
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function randId(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map((b) => (b % 36).toString(36)).join('');
}
const keyMode = (env) => {
  const k = env.RAZORPAY_KEY_ID || '';
  return k.startsWith('rzp_live_') ? 'live' : k.startsWith('rzp_test_') ? 'test' : k ? 'unknown' : 'off';
};
const paymentsReady = (env) => Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);

// Live keys only answer the real site. Test keys move no money, so any page may use
// them — that is what lets a Vercel preview or a local check run a full test payment.
// With no keys at all every pay endpoint answers 503, and any page may read that.
function allowedOrigin(origin, env) {
  if (SITE_ORIGINS.includes(origin)) return origin;
  const mode = keyMode(env);
  if ((mode === 'test' || mode === 'off') && /^https?:\/\/[^/]+$/.test(origin || '')) return origin;
  return null;
}
function corsFor(origin, env) {
  return {
    'Access-Control-Allow-Origin': allowedOrigin(origin, env) || SITE_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });

// Best-effort limiter (per isolate), same idea as ClaimFight's: stops casual abuse.
const hits = new Map();
function limited(ip, bucket, max, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const key = bucket + ':' + ip;
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return true; }
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  return false;
}

// ---------------------------------------------------------------- Razorpay
class RzpError extends Error {
  constructor(status, data) {
    super((data && data.error && data.error.description) || 'razorpay ' + status);
    this.status = status;
    this.data = data;
  }
}
async function rzp(env, method, path, body) {
  const res = await fetch(RZP_API + path, {
    method,
    headers: {
      Authorization: 'Basic ' + btoa(env.RAZORPAY_KEY_ID + ':' + env.RAZORPAY_KEY_SECRET),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-JSON error page */ }
  if (!res.ok) throw new RzpError(res.status, data);
  return data;
}

// A payment counts for Diet AI only if it is exactly ₹99 and is not tagged for another
// product. Untagged covers the old Razorpay payment page (its notes hold the buyer's email
// and phone, no product). The amount rule always applies: payment notes are set by the
// browser, so a 'dietai' tag on a cheaper payment proves nothing.
function isDietPayment(p) {
  if (!p || p.currency !== CURRENCY || p.amount !== PRICE_PAISE) return false;
  const product = p.notes && p.notes.product;
  return !product || product === 'dietai';
}
const isRefunded = (p) => p.refund_status === 'full' || (p.amount_refunded || 0) >= p.amount;

// captured → paid. authorized → the money is held for us: capture it so Razorpay does not
// auto-refund it. If the capture call itself fails, the customer still paid, so they still
// get the pack; the failure is logged so the owner can capture it from the dashboard.
async function settle(env, p) {
  if (p.status === 'captured') return { ok: true, p };
  if (p.status !== 'authorized') return { ok: false, p };
  try {
    const c = await rzp(env, 'POST', '/payments/' + p.id + '/capture', { amount: p.amount, currency: p.currency });
    return { ok: true, p: c };
  } catch (e) {
    try {
      const again = await rzp(env, 'GET', '/payments/' + p.id);
      if (again.status === 'captured') return { ok: true, p: again };
    } catch (e2) { /* fall through */ }
    await logServer(env, 'capture_failed', { payment_id: p.id, error: String(e.message).slice(0, 120) });
    return { ok: true, p, captureFailed: true };
  }
}

// ---------------------------------------------------------------- unlock tokens
// v1.<payment_id>.<issued unix seconds>.<hmac> — no expiry: the pack is bought once.
// Signed with the Razorpay secret, so rotating that key invalidates every token; the page
// then re-issues one from the payment ID inside it (/pay/restore re-checks with Razorpay).
async function issueToken(env, paymentId) {
  const ts = Math.floor(Date.now() / 1000);
  const sig = await hmacHex(env.RAZORPAY_KEY_SECRET, 'dietai-unlock|v1|' + paymentId + '|' + ts);
  return 'v1.' + paymentId + '.' + ts + '.' + sig;
}
async function readToken(env, token) {
  const m = TOKEN_RE.exec(String(token || ''));
  if (!m) return null;
  const want = await hmacHex(env.RAZORPAY_KEY_SECRET, 'dietai-unlock|v1|' + m[1] + '|' + m[2]);
  return safeEqual(want, m[3]) ? { paymentId: m[1], issued: Number(m[2]) } : null;
}

// ---------------------------------------------------------------- D1
async function logServer(env, event, meta) {
  if (!env.EVENTS) return;
  try {
    await env.EVENTS.prepare('INSERT INTO events (product, event, source, meta) VALUES (?1, ?2, ?3, ?4)')
      .bind('dietai', event, 'server', JSON.stringify(meta).slice(0, 500)).run();
  } catch (e) { /* logging must never block an unlock */ }
}
// The authoritative sale count: one 'payment_verified' row per Razorpay payment, written
// by the server after Razorpay confirms it — unlike 'premium_unlocked', which the browser sends.
// Payments made with test keys move no money, so they are logged as 'payment_verified_test'
// and can never be counted as a sale, in /funnel or in a hand-written query.
const saleEvent = (env) => (keyMode(env) === 'test' ? 'payment_verified_test' : 'payment_verified');
async function recordSale(env, p, via) {
  if (!env.EVENTS) return;
  const event = saleEvent(env);
  try {
    const seen = await env.EVENTS.prepare('SELECT 1 FROM events WHERE event = ?2 AND meta LIKE ?1 LIMIT 1')
      .bind('%"' + p.id + '"%', event).first();
    if (seen) return;
  } catch (e) { /* if the lookup fails, record anyway */ }
  await logServer(env, event, {
    payment_id: p.id, order_id: p.order_id || null, amount: p.amount, method: p.method || null, via, mode: keyMode(env),
  });
}

// ---------------------------------------------------------------- /pay/*
async function readBody(request) {
  try { const b = await request.json(); return b && typeof b === 'object' ? b : {}; } catch (e) { return {}; }
}

async function payOrder(request, env) {
  const b = await readBody(request);
  const tag = (s) => String(s || '').replace(/[^a-z-]/gi, '').slice(0, 20);
  const order = await rzp(env, 'POST', '/orders', {
    amount: PRICE_PAISE,
    currency: CURRENCY,
    receipt: 'dai_' + Date.now().toString(36) + '_' + randId(6),
    notes: { product: 'dietai', pack: '7-day', region: tag(b.region), diet: tag(b.diet) },
  });
  return json({ order_id: order.id, key_id: env.RAZORPAY_KEY_ID, amount: order.amount, currency: order.currency, mode: keyMode(env) });
}

async function payVerify(request, env) {
  const b = await readBody(request);
  const orderId = String(b.order_id || ''), paymentId = String(b.payment_id || ''), sig = String(b.signature || '');
  if (!ID_RE.order.test(orderId) || !ID_RE.pay.test(paymentId) || !ID_RE.sig.test(sig)) return json({ error: 'bad_request' }, 400);
  // Razorpay signs order_id|payment_id with our secret only when the payment succeeded.
  const want = await hmacHex(env.RAZORPAY_KEY_SECRET, orderId + '|' + paymentId);
  if (!safeEqual(want, sig)) return json({ error: 'bad_signature' }, 400);
  let p = null;
  try { p = await rzp(env, 'GET', '/payments/' + paymentId); } catch (e) { /* Razorpay unreachable: the signature alone proves payment */ }
  if (p) {
    if (p.order_id !== orderId) return json({ error: 'order_mismatch' }, 400);
    if (!isDietPayment(p)) return json({ error: 'not_a_dietai_payment' }, 400);
    const s = await settle(env, p);
    if (!s.ok) return json({ error: 'not_paid', status: p.status }, 402);
    p = s.p;
  }
  await recordSale(env, p || { id: paymentId, order_id: orderId, amount: PRICE_PAISE }, 'checkout');
  return json({ ok: true, token: await issueToken(env, paymentId), payment_id: paymentId });
}

async function payStatus(request, env) {
  const b = await readBody(request);
  const orderId = String(b.order_id || '');
  if (!ID_RE.order.test(orderId)) return json({ error: 'bad_request' }, 400);
  const list = await rzp(env, 'GET', '/orders/' + orderId + '/payments');
  const items = ((list && list.items) || []).filter(isDietPayment);
  const good = items.find((p) => p.status === 'captured' || p.status === 'authorized');
  if (good && !isRefunded(good)) {
    const s = await settle(env, good);
    await recordSale(env, s.p, 'recovery');
    return json({ paid: true, token: await issueToken(env, good.id), payment_id: good.id });
  }
  const last = items.sort((x, y) => (y.created_at || 0) - (x.created_at || 0))[0];
  return json({
    paid: false,
    state: last ? last.status : 'no_attempt', // created = still waiting for the UPI app
    reason: (last && last.error_reason) || null,
    description: (last && last.error_description) || null,
  });
}

async function payRestore(request, env) {
  const b = await readBody(request);
  const paymentId = String(b.payment_id || '').trim();
  if (!ID_RE.pay.test(paymentId)) return json({ error: 'bad_request' }, 400);
  let p;
  try { p = await rzp(env, 'GET', '/payments/' + paymentId); } catch (e) {
    if (e instanceof RzpError && (e.status === 400 || e.status === 404)) return json({ error: 'not_found' }, 404);
    throw e;
  }
  if (!isDietPayment(p)) return json({ error: 'not_found' }, 404);
  if (isRefunded(p)) return json({ error: 'refunded' }, 410);
  const s = await settle(env, p);
  if (!s.ok) return json({ error: 'not_paid', status: p.status }, 402);
  await recordSale(env, s.p, 'restore'); // first time we hear of a payment-page sale, it counts once
  return json({ ok: true, token: await issueToken(env, paymentId), payment_id: paymentId });
}

async function payCheck(request, env) {
  const b = await readBody(request);
  const t = await readToken(env, b.token);
  return json({ ok: Boolean(t), payment_id: t ? t.paymentId : null });
}

const PAY_ROUTES = { '/pay/order': payOrder, '/pay/verify': payVerify, '/pay/status': payStatus, '/pay/restore': payRestore, '/pay/check': payCheck };
const PAY_LIMITS = { '/pay/order': 20, '/pay/verify': 30, '/pay/status': 120, '/pay/restore': 15, '/pay/check': 60 };

// ---------------------------------------------------------------- router
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsFor(origin, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (url.pathname === '/api/health') {
      let db = false;
      try { await env.EVENTS.prepare('SELECT 1').first(); db = true; } catch (e) {}
      return json({ status: db ? 'ok' : 'DEGRADED', d1Configured: db, payments: { configured: paymentsReady(env), mode: keyMode(env) } }, 200, cors);
    }

    if (url.pathname === '/e' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400, cors); }
      const product = String(body.product || '').slice(0, 40);
      const event = String(body.event || '').slice(0, 40);
      const source = String(body.source || '').slice(0, 120) || null;
      const meta = body.meta ? JSON.stringify(body.meta).slice(0, 500) : null;
      if (!product || !ALLOWED_EVENTS.includes(event)) return json({ error: 'bad event' }, 400, cors);
      try {
        await env.EVENTS.prepare('INSERT INTO events (product, event, source, meta) VALUES (?1, ?2, ?3, ?4)')
          .bind(product, event, source, meta).run();
      } catch (e) {
        return json({ error: 'db write failed: ' + e.message }, 500, cors);
      }
      return json({ ok: true }, 200, cors);
    }

    const route = PAY_ROUTES[url.pathname];
    if (route) {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);
      if (!paymentsReady(env)) return json({ error: 'payments_not_configured' }, 503, cors);
      if (!allowedOrigin(origin, env)) return json({ error: 'origin_not_allowed' }, 403, cors);
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      if (limited(ip, url.pathname, PAY_LIMITS[url.pathname])) return json({ error: 'too_many_requests' }, 429, cors);
      try {
        const res = await route(request, env);
        for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
        return res;
      } catch (e) {
        const status = e instanceof RzpError ? 502 : 500;
        return json({ error: e instanceof RzpError ? 'razorpay_error' : 'server_error', detail: String(e.message || '').slice(0, 160) }, status, cors);
      }
    }

    if (url.pathname === '/funnel') {
      const key = url.searchParams.get('key');
      if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return json({ error: 'unauthorized (set ADMIN_KEY secret)' }, 401);
      const days = Math.min(parseInt(url.searchParams.get('days') || '7', 10) || 7, 90);
      const { results } = await env.EVENTS.prepare(
        "SELECT product, event, COUNT(*) AS n, COUNT(DISTINCT source) AS sources FROM events WHERE ts >= datetime('now', ?1) GROUP BY product, event ORDER BY product, n DESC"
      ).bind('-' + days + ' days').all();
      return json({ days, funnel: results });
    }

    return json({ error: 'not found' }, 404);
  },
};
