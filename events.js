/* Diet AI — funnel logging.
   Loaded EARLY (not deferred) in <head> so window.dietaiLog exists before the
   main script runs. Every call is wrapped: this file can never break the site.
   Worker: dietai-events (Cloudflare).

   Why not deferred any more: the main script strips ?premium=unlocked from the
   URL with history.replaceState during parsing. A deferred logger runs AFTER
   that and can never see the param, so the purchase event was never sent.
   The main script now calls dietaiLog('premium_unlocked') itself, before it
   strips the param. */
(function () {
  var WORKER = 'https://dietai-events.sudhanshuxg.workers.dev';
  var PRODUCT = 'dietai';

  /* Only the real site may write to the funnel. The repo also deploys to
     Vercel, and its deployment bots and preview URLs were landing in D1 as
     "direct" page views at the exact moment of every deploy. The Worker accepts
     any origin, so the guard has to live here. localhost stays allowed so the
     end-to-end checks (which intercept the Worker) can see events. */
  var host = location.hostname;
  if (!/^(www\.)?dietai\.in$|^localhost$|^127\.0\.0\.1$/.test(host)) {
    window.dietaiLog = window.dietaiLogOnce = function () {};
    return;
  }

  /* ---- first-touch attribution -------------------------------------------
     Razorpay bounces the user off-site and back, which destroys document.referrer.
     So we remember where they originally came from and attach it to every event,
     including the purchase. Without this, every sale looks like it came from
     "pages.razorpay.com". */
  function firstTouch() {
    try {
      var saved = localStorage.getItem('dietai_src');
      if (saved) return saved;
      var q = new URLSearchParams(location.search);
      var src = q.get('utm_source') || q.get('source') ||
                (document.referrer ? document.referrer.slice(0, 120) : '') || 'direct';
      // don't let the payment round-trip overwrite the real source
      if (src.indexOf('razorpay') < 0) localStorage.setItem('dietai_src', src);
      return src;
    } catch (e) { return 'direct'; }
  }

  function log(event, meta) {
    try {
      var payload = JSON.stringify({
        product: PRODUCT,
        event: String(event),
        source: firstTouch(),
        meta: meta || null,
        ts: Date.now()
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(WORKER + '/e', payload);
      } else {
        fetch(WORKER + '/e', { method: 'POST', body: payload, keepalive: true, mode: 'no-cors' });
      }
    } catch (e) { /* analytics must never break the app */ }
  }

  /* Fire an event at most once per browser, ever. Used for the purchase event so
     a refresh of /?premium=unlocked can't inflate the conversion count. */
  function logOnce(event, meta) {
    try {
      var k = 'dietai_ev_' + event;
      if (localStorage.getItem(k)) return;
      localStorage.setItem(k, '1');
    } catch (e) { /* private mode: fall through and log anyway */ }
    log(event, meta);
  }

  window.dietaiLog = log;
  window.dietaiLogOnce = logOnce;

  /* one page_view per tab session */
  try {
    if (!sessionStorage.getItem('dietai_pv')) {
      sessionStorage.setItem('dietai_pv', '1');
      log('page_view', { page: location.pathname, pwa: location.search.indexOf('source=pwa') >= 0 });
    }
  } catch (e) { log('page_view'); }

  /* Backstop: if this browser is premium but the purchase was never reported,
     report it now. Covers the case where the GitHub Pages CDN is still serving a
     stale index.html that doesn't call dietaiLog itself. Costs one visit of delay,
     but a sale gets counted instead of vanishing. */
  try {
    if (localStorage.getItem('dietai_premium') === '1') logOnce('premium_unlocked', { via: 'backstop' });
  } catch (e) {}
})();
