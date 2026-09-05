/* Diet AI — premium.js is RETIRED. Deliberately a no-op.

   History: this file was the pre-v2 premium module. The v2 redesign moved the
   whole premium flow into index.html (#premium / buildWeek()), but a later commit
   re-added the <script src="premium.js"> tag on the belief that the ₹99 button
   "was never included". It already was. The result was two competing offers on
   one page: this file injected a second, light-themed ₹99 card into the results
   panel, and its 7-day pack ignored the user's region entirely — contradicting
   the one thing the product sells.

   The script tag is now removed from index.html. This file stays as a harmless
   stub rather than being deleted, because the GitHub Pages CDN has twice served
   a stale index.html: if an old copy of the page is still asking for premium.js,
   it gets this no-op instead of a 404 or the old duplicate card.

   Do not put logic back in here. The premium flow lives in index.html. */
(function () {
  try {
    if (window.console && console.info) {
      console.info('[Diet AI] premium.js is retired; the premium flow lives in index.html.');
    }
  } catch (e) {}
})();
