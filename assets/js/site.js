/* ---------------------------------------------------------
   Page furniture: footer year and the scroll reveal.
   --------------------------------------------------------- */
(function () {
  'use strict';

  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  if (!('IntersectionObserver' in window)) return;

  var targets = document.querySelectorAll('.section-head, .contact-link');
  if (!targets.length) return;

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in');
      io.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });

  targets.forEach(function (el, i) {
    el.classList.add('reveal');
    el.style.transitionDelay = (Math.min(i, 3) * 60) + 'ms';
    io.observe(el);
  });
})();
