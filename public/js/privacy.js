// Privacy page: a classic script in <head>, like boot.js, so it also works from
// file://. It applies the theme chosen in the app before the first paint, shows
// the note in the app's language, and saves a language switch back to the same
// key, so both pages stay in step.

(function () {
  var THEME_KEY = 'darts301.theme';
  var LANG_KEY = 'darts301.lang';
  var TITLE = { en: 'Data and privacy · Oche', pl: 'Dane i prywatność · Oche' };
  var root = document.documentElement;
  var systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  function read(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch (error) {
      return null;
    }
  }

  var preference = read(THEME_KEY);
  var language = read(LANG_KEY) === 'pl' ? 'pl' : 'en';

  function applyTheme() {
    var theme = preference === 'light' || preference === 'dark'
      ? preference
      : (systemDark.matches ? 'dark' : 'light');
    root.dataset.theme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    var background = getComputedStyle(root).getPropertyValue('--bg').trim();
    if (meta && background) meta.content = background;
  }

  function applyLanguage() {
    root.lang = language;
    document.title = TITLE[language];
    document.querySelectorAll('[data-locale]').forEach(function (node) {
      node.hidden = node.dataset.locale !== language;
    });
    document.querySelectorAll('[data-lang-btn]').forEach(function (button) {
      var on = button.dataset.langBtn === language;
      button.setAttribute('aria-checked', String(on));
      button.tabIndex = on ? 0 : -1;
    });
  }

  function setLanguage(code) {
    language = code;
    try {
      localStorage.setItem(LANG_KEY, JSON.stringify(code));
    } catch (error) {
      /* private browsing: the switch lasts until the page closes */
    }
    applyLanguage();
  }

  systemDark.addEventListener('change', applyTheme);
  applyTheme();

  document.addEventListener('DOMContentLoaded', function () {
    applyLanguage();

    document.addEventListener('click', function (event) {
      var button = event.target.closest('[data-lang-btn]');
      if (button) setLanguage(button.dataset.langBtn);
    });

    // Arrow keys move between the two options, as in any radio group.
    document.addEventListener('keydown', function (event) {
      var target = event.target;
      if (!target.matches || !target.matches('[data-lang-btn]')) return;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(event.key) === -1) return;
      var next = target.dataset.langBtn === 'en' ? 'pl' : 'en';
      setLanguage(next);
      document.querySelector('[data-lang-btn="' + next + '"]').focus();
      event.preventDefault();
    });
  });
})();
