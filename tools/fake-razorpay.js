/* Diet AI — a stand-in for Razorpay, used only by tools/check.js. Not part of the site.

   The checks run the REAL Worker code (worker/index.js) against this fake. Everything
   Razorpay would do that the Worker depends on is reproduced, including the part that
   matters for security: a successful payment's signature is HMAC-SHA256 of
   "order_id|payment_id" with the key secret, computed exactly as Razorpay documents it.
   The secret is generated fresh for every run and never leaves this process.

   Pieces:
     createFakeRazorpay({keyId, keySecret}) — the REST API (orders, payments, capture),
        with Basic-auth checking, plus helpers to "pay" an order the way a customer would.
     CHECKOUT_JS — a fake checkout.js for the browser. It honours window.__rzpScenario:
        success | fail | dismiss | killed (paid, then the phone dropped the tab) |
        pending (UPI request sent, not yet approved) | tampered (signature altered).
     createFakeD1() — the two queries the Worker runs against D1. */
'use strict';
const crypto = require('crypto');

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const rid = (prefix) => prefix + '_' + Array.from(crypto.randomBytes(14), (b) => ALNUM[b % 62]).join('');
const now = () => Math.floor(Date.now() / 1000);
const err = (description, code = 'BAD_REQUEST_ERROR') => ({ error: { code, description, source: 'business', step: 'payment_initiation', reason: 'input_validation_failed' } });

function createFakeRazorpay({ keyId, keySecret }) {
  const orders = new Map();
  const payments = new Map();
  const calls = [];
  let down = false;

  const sign = (orderId, paymentId) => crypto.createHmac('sha256', keySecret).update(orderId + '|' + paymentId).digest('hex');

  function api(method, path, body, authHeader) {
    calls.push({ method, path, body });
    if (down) return [503, err('Service unavailable', 'SERVER_ERROR')];
    if (authHeader !== 'Basic ' + Buffer.from(keyId + ':' + keySecret).toString('base64')) {
      return [401, err('The api key provided is invalid')];
    }
    let m;
    if (method === 'POST' && path === '/orders') {
      if (!Number.isInteger(body.amount) || body.amount < 100) return [400, err('The amount must be atleast INR 1.00')];
      if (body.receipt && body.receipt.length > 40) return [400, err('receipt: the length must not be greater than 40')];
      const o = { id: rid('order'), entity: 'order', amount: body.amount, amount_paid: 0, amount_due: body.amount, currency: body.currency,
        receipt: body.receipt || null, notes: body.notes || {}, status: 'created', attempts: 0, created_at: now() };
      orders.set(o.id, o);
      return [200, o];
    }
    if (method === 'GET' && (m = path.match(/^\/orders\/([^/]+)\/payments$/))) {
      if (!orders.has(m[1])) return [400, err('The id provided does not exist')];
      const items = [...payments.values()].filter((p) => p.order_id === m[1]);
      return [200, { entity: 'collection', count: items.length, items }];
    }
    if (method === 'GET' && (m = path.match(/^\/payments\/([^/]+)$/))) {
      const p = payments.get(m[1]);
      return p ? [200, p] : [400, err('The id provided does not exist')];
    }
    if (method === 'POST' && (m = path.match(/^\/payments\/([^/]+)\/capture$/))) {
      const p = payments.get(m[1]);
      if (!p) return [400, err('The id provided does not exist')];
      if (p.status !== 'authorized') return [400, err('This payment has already been captured')];
      if (body.amount !== p.amount || body.currency !== p.currency) return [400, err('Capture amount must be equal to the amount authorized')];
      p.status = 'captured'; p.captured = true;
      return [200, p];
    }
    return [404, err('The requested URL was not found on the server.')];
  }

  function addPayment(fields) {
    const p = Object.assign({ id: rid('pay'), entity: 'payment', amount: 9900, currency: 'INR', status: 'captured', order_id: null,
      method: 'upi', amount_refunded: 0, refund_status: null, captured: true, notes: {}, error_reason: null, error_description: null,
      created_at: now() }, fields);
    payments.set(p.id, p);
    return p;
  }

  /* What a customer's action does to Razorpay's state, per scenario. */
  function pay(orderId, scenario) {
    const o = orders.get(orderId);
    if (!o) return { error: err('The id provided does not exist').error };
    o.attempts++;
    if (scenario === 'fail') {
      addPayment({ order_id: orderId, amount: o.amount, notes: o.notes, status: 'failed', captured: false,
        error_reason: 'payment_timed_out', error_description: 'Payment was unsuccessful as you could not complete it in time.' });
      return { error: { code: 'BAD_REQUEST_ERROR', description: 'Payment was unsuccessful as you could not complete it in time.',
        source: 'customer', step: 'payment_authentication', reason: 'payment_timed_out', metadata: { order_id: orderId } } };
    }
    const status = scenario === 'pending' ? 'created' : scenario === 'authorized' ? 'authorized' : 'captured';
    const p = addPayment({ order_id: orderId, amount: o.amount, notes: o.notes, status, captured: status === 'captured' });
    if (status === 'captured') { o.status = 'paid'; o.amount_paid = o.amount; o.amount_due = 0; }
    return { payment_id: p.id, signature: sign(orderId, p.id) };
  }

  /* Node side: route the Worker's fetch() calls to api.razorpay.com into this fake. */
  function install() {
    const real = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      if (!url.startsWith('https://api.razorpay.com/v1/')) return real(input, init);
      const headers = new Headers(init.headers || (typeof input === 'string' ? {} : input.headers));
      const body = init.body ? JSON.parse(init.body) : null;
      const [status, data] = api((init.method || 'GET').toUpperCase(), url.slice('https://api.razorpay.com/v1'.length), body, headers.get('authorization'));
      return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    };
    return () => { globalThis.fetch = real; };
  }

  return { orders, payments, calls, sign, api, pay, addPayment, install, setDown: (v) => { down = v; } };
}

/* Browser side. Records how checkout was opened (window.__rzpOpened) so the checks can
   assert on the options, then acts out the scenario. */
const CHECKOUT_JS = `
window.__rzpOpened = window.__rzpOpened || [];
window.Razorpay = function (opts) { this.opts = opts; this.h = {}; };
window.Razorpay.prototype.on = function (ev, fn) { this.h[ev] = fn; };
window.Razorpay.prototype.open = function () {
  var self = this, o = this.opts, sc = window.__rzpScenario || 'success';
  window.__rzpOpened.push(JSON.parse(JSON.stringify(o, function (k, v) { return typeof v === 'function' ? '[fn]' : v; })));
  setTimeout(function () {
    if (sc === 'dismiss') { o.modal.ondismiss(); return; }
    fetch('https://fake-razorpay.test/__pay', { method: 'POST', body: JSON.stringify({ order_id: o.order_id, scenario: sc }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.error) { if (self.h['payment.failed']) self.h['payment.failed']({ error: d.error }); setTimeout(function () { o.modal.ondismiss(); }, 50); return; }
        if (sc === 'killed' || sc === 'pending') { location.reload(); return; }
        var sig = sc === 'tampered' ? (d.signature.charAt(0) === 'a' ? 'b' : 'a') + d.signature.slice(1) : d.signature;
        o.handler({ razorpay_payment_id: d.payment_id, razorpay_order_id: o.order_id, razorpay_signature: sig });
      });
  }, 60);
};`;

function createFakeD1() {
  const rows = [];
  return {
    rows,
    prepare(sql) {
      let args = [];
      return {
        bind(...a) { args = a; return this; },
        async run() {
          if (/^INSERT INTO events/.test(sql)) rows.push({ product: args[0], event: args[1], source: args[2], meta: args[3] });
          return { success: true };
        },
        async first() {
          if (sql === 'SELECT 1') return { 1: 1 };
          if (/event = \?2 AND meta LIKE \?1/.test(sql)) {
            const needle = String(args[0]).replace(/^%|%$/g, '');
            return rows.some((r) => r.event === args[1] && String(r.meta).includes(needle)) ? { 1: 1 } : null;
          }
          return null;
        },
        async all() { return { results: [] }; },
      };
    },
  };
}

module.exports = { createFakeRazorpay, createFakeD1, CHECKOUT_JS, rid };
