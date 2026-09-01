/* ---------------------------------------------------------
   Sun / moon switch.
   The initial value is applied by the inline script in
   index.html (before paint); this only handles the toggle.
   --------------------------------------------------------- */
(function () {
  'use strict';

  var root = document.documentElement;
  var btn = document.getElementById('themeToggle');
  if (!btn) return;

  function sync() {
    var dark = root.getAttribute('data-theme') === 'dark';
    btn.setAttribute('aria-pressed', String(dark));
    btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.title = dark ? 'Light mode' : 'Dark mode';
  }

  function set(theme) {
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch (e) { /* private mode */ }
    sync();
  }

  btn.addEventListener('click', function () {
    set(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  // Follow the OS only while the visitor has not made a choice.
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  var onOsChange = function (e) {
    var saved = null;
    try { saved = localStorage.getItem('theme'); } catch (err) { }
    if (!saved) {
      root.setAttribute('data-theme', e.matches ? 'dark' : 'light');
      sync();
    }
  };
  if (mq.addEventListener) mq.addEventListener('change', onOsChange);
  else if (mq.addListener) mq.addListener(onOsChange);

  sync();
})();
