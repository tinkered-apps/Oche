// Runs in <head>, before the first paint. A classic script, not a module, so it
// also works for a page opened straight from disk (file://).
//
//  - applies the theme (saved choice, or the device's) so the page never
//    flashes the wrong colours,
//  - keeps Chrome's install prompt, which can fire before the app has loaded,
//  - loads the app: plain modules from a server; from file://, where the
//    browser blocks modules, the same code glued into js/oche.bundle.js.

(function () {
  var THEME_KEY = 'darts301.theme';
  var root = document.documentElement;
  var systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  var preference = 'system';

  try {
    var saved = JSON.parse(localStorage.getItem(THEME_KEY));
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch (error) {
    /* no storage: follow the device */
  }

  function applyTheme() {
    var theme = preference === 'system' ? (systemDark.matches ? 'dark' : 'light') : preference;
    root.dataset.theme = theme;
    // The browser bar takes the page background, read from the stylesheet.
    var meta = document.querySelector('meta[name="theme-color"]');
    var background = getComputedStyle(root).getPropertyValue('--bg').trim();
    if (meta && background) meta.content = background;
  }

  systemDark.addEventListener('change', applyTheme);
  applyTheme();

  // The header control in js/app.js reads and changes the theme through this.
  window.ocheTheme = {
    get: function () { return preference; },
    set: function (value) {
      preference = value === 'light' || value === 'dark' ? value : 'system';
      try {
        localStorage.setItem(THEME_KEY, JSON.stringify(preference));
      } catch (error) {
        /* private browsing: the choice lasts until the page closes */
      }
      applyTheme();
    }
  };

  window.addEventListener('beforeinstallprompt', function (event) { window.__installPrompt = event; });

  document.addEventListener('DOMContentLoaded', function () {
    var script = document.createElement('script');
    if (location.protocol === 'file:') script.src = 'js/oche.bundle.js';
    else { script.type = 'module'; script.src = 'js/app.js'; }
    document.body.appendChild(script);
  });
})();
