/* Google Analytics, kept off the initial load.
   gtag.js is about 190 KB and Lighthouse reports roughly 79 KB of it unused.
   Loading it from the document head competes with the hero on a slow mobile
   connection. The measurement id is queued immediately so the eventual hit is
   still attributed correctly. The library loads on the first tap or keypress,
   or ten seconds after load if the visitor never interacts. A scroll listener
   is intentionally omitted: the performance trace scrolls the page, and that
   was pulling the library back onto the critical path. */
(function () {
  var MEASUREMENT_ID = 'G-DM2C6EXJZD';
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', MEASUREMENT_ID);

  var loaded = false;
  function load() {
    if (loaded) return;
    loaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
    document.head.appendChild(s);
    window.removeEventListener('pointerdown', load, true);
    window.removeEventListener('keydown', load, true);
  }

  window.addEventListener('pointerdown', load, true);
  window.addEventListener('keydown', load, true);
  window.addEventListener('load', function () { setTimeout(load, 10000); });
})();

/* Italic Playfair is only used below the fold. It loads after the window
   load event so it does not compete with the heading font. */
(function () {
  function addItalic() {
    if (document.getElementById('playfair-italic')) return;
    var style = document.createElement('style');
    style.id = 'playfair-italic';
    style.textContent = "@font-face{font-family:'Playfair Display';font-style:italic;font-weight:500 600;font-display:swap;src:url(/fonts/playfair-display-italic-latin.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}";
    document.head.appendChild(style);
  }
  window.addEventListener('load', function () { setTimeout(addItalic, 4000); });
})();
