/* Diet AI - funnel event logging (safe: every call wrapped, can never break the site).
   Loaded by index.html before premium.js. Worker: dietai-events (Cloudflare). */
(function () {
  var WORKER = 'https://dietai-events.sudhanshuxg.workers.dev';
  var P = 'dietai';
  function src() {
    try { return (new URLSearchParams(location.search).get('utm_source')) || document.referrer.slice(0, 120) || 'direct'; }
    catch (e) { return 'direct'; }
  }
  function log(event, meta) {
    try {
      var payload = JSON.stringify({ product: P, event: event, source: src(), meta: meta || null });
      if (navigator.sendBeacon) navigator.sendBeacon(WORKER + '/e', new Blob([payload], { type: 'application/json' }));
      else fetch(WORKER + '/e', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true });
    } catch (e) {}
  }
  try {
    if (!sessionStorage.getItem('dietai_pv')) { sessionStorage.setItem('dietai_pv', '1'); log('page_view'); }
  } catch (e) { log('page_view'); }
  try { if (new URLSearchParams(location.search).get('premium') === 'unlocked') log('premium_unlocked'); } catch (e) {}
  document.addEventListener('DOMContentLoaded', function () {
    var orig = window.generatePlan;
    if (typeof orig === 'function') {
      window.generatePlan = function () { log('plan_generated'); return orig.apply(this, arguments); };
    }
  });
  document.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('#premiumBtn, [data-premium-btn]') : null;
    if (!b) return;
    try { log(localStorage.getItem('dietai_premium') === '1' ? 'pack_opened' : 'premium_click'); } catch (e) {}
  }, true);
})();
