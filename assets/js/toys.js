/* ---------------------------------------------------------
   Draggable things that live on the page rather than inside
   the canvas: the four sports stickers and the portrait.

   Every [data-drag] element is moved with a translate offset,
   so nothing is taken out of the layout and nothing reflows
   while you drag. Let go and it keeps its momentum, slides,
   and comes to a stop inside the page.

   Stickers additionally carry data-anchor / data-ax / data-ay:
   a section to sit in and where in it, worked out on load so
   they land somewhere sensible at any window size.
   --------------------------------------------------------- */
(function () {
  'use strict';

  var els = [].slice.call(document.querySelectorAll('[data-drag]'));
  if (!els.length) return;

  var FRICTION = 6.5;      // per second, exponential
  var EDGE = 6;            // keep this much of a gap from the page edges
  var STOP = 8;            // below this speed it is considered stopped

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var items = els.map(function (el) {
    return {
      el: el,
      tx: 0, ty: 0,         // current translate offset
      vx: 0, vy: 0,
      placed: false,        // has its anchor been applied yet
      moved: false,         // has the visitor dragged it
      resting: true
    };
  });

  var dragging = null;
  var pointerId = null;
  var last = { x: 0, y: 0, t: 0 };
  var raf = null, prevTime = 0;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function draw(it) {
    it.el.style.transform = 'translate(' + it.tx.toFixed(1) + 'px,' + it.ty.toFixed(1) + 'px)';
  }

  /* Measure where the element sits with NO offset, once. Everything is
     clamped against that.

     Doing it this way rather than reading getBoundingClientRect() during a
     drag matters twice over: the rect already includes the current
     transform, so mixing the two silently disagrees with itself, and
     measuring on every pointermove would force a layout each frame. */
  function measure(it) {
    var prev = it.el.style.transform;
    it.el.style.transform = 'none';
    var r = it.el.getBoundingClientRect();
    it.baseX = r.left + window.scrollX;
    it.baseY = r.top + window.scrollY;
    it.w = r.width;
    it.h = r.height;
    it.el.style.transform = prev;
  }

  /* The page box we clamp against.

     Deliberately NOT scrollWidth: a sticker parked near the right edge grows
     scrollWidth, which would widen the very bound meant to hold it in, and
     the page ends up scrolling sideways. clientWidth is the viewport's
     content width and can never be inflated that way. Height is measured
     with the sticker layer hidden for the same reason, and cached so a drag
     is not forcing a layout on every frame. */
  var layer = document.getElementById('stickers');
  var cachedPage = null;

  function pageSize() {
    if (cachedPage) return cachedPage;
    var prev = layer ? layer.style.display : null;
    if (layer) layer.style.display = 'none';
    var d = document.documentElement;
    cachedPage = {
      w: d.clientWidth,
      h: Math.max(d.scrollHeight, d.clientHeight)
    };
    if (layer) layer.style.display = prev;
    return cachedPage;
  }

  function invalidatePage() { cachedPage = null; }

  function applyClamp(it) {
    if (it.baseX === undefined) measure(it);
    var page = pageSize();
    var loX = EDGE - it.baseX;
    var hiX = page.w - EDGE - it.w - it.baseX;
    var loY = EDGE - it.baseY;
    var hiY = page.h - EDGE - it.h - it.baseY;
    var nx = clamp(it.tx, Math.min(loX, hiX), Math.max(loX, hiX));
    var ny = clamp(it.ty, Math.min(loY, hiY), Math.max(loY, hiY));
    if (nx !== it.tx) { it.tx = nx; it.vx *= -0.35; }
    if (ny !== it.ty) { it.ty = ny; it.vy *= -0.35; }
  }

  // ---- put the stickers where their anchor section says ----
  function place(it, force) {
    var name = it.el.getAttribute('data-anchor');
    if (!name || (it.moved && !force)) return;
    var host = document.getElementById(name) || document.querySelector('.' + name);
    if (!host) return;

    measure(it);
    var h = host.getBoundingClientRect();
    var narrow = window.innerWidth < 760;
    var ax = parseFloat(it.el.getAttribute(narrow && it.el.hasAttribute('data-ax-sm') ? 'data-ax-sm' : 'data-ax') || '0.5');
    var ay = parseFloat(it.el.getAttribute(narrow && it.el.hasAttribute('data-ay-sm') ? 'data-ay-sm' : 'data-ay') || '0.5');

    it.tx = (h.left + window.scrollX + h.width * ax - it.w / 2) - it.baseX;
    it.ty = (h.top + window.scrollY + h.height * ay - it.h / 2) - it.baseY;
    it.placed = true;
    applyClamp(it);
    draw(it);
  }

  // ---- the glide after you let go ----
  function tick(now) {
    var dt = Math.min(0.034, (now - prevTime) / 1000) || 0.016;
    prevTime = now;
    var busy = false;

    items.forEach(function (it) {
      if (it === dragging || it.resting) return;
      var decay = Math.exp(-FRICTION * dt);
      it.vx *= decay;
      it.vy *= decay;
      it.tx += it.vx * dt;
      it.ty += it.vy * dt;
      applyClamp(it);
      draw(it);
      if (Math.abs(it.vx) < STOP && Math.abs(it.vy) < STOP) {
        it.vx = it.vy = 0;
        it.resting = true;
      } else {
        busy = true;
      }
    });

    raf = busy ? window.requestAnimationFrame(tick) : null;
  }

  function startLoop() {
    if (raf !== null) return;
    prevTime = window.performance.now();
    raf = window.requestAnimationFrame(tick);
  }

  // ---- input ----
  items.forEach(function (it) {
    it.el.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      if (it.el.setPointerCapture) {
        try { it.el.setPointerCapture(e.pointerId); } catch (err) { }
      }
      dragging = it;
      pointerId = e.pointerId;
      it.grabX = e.clientX - it.tx;
      it.grabY = e.clientY - it.ty;
      it.vx = it.vy = 0;
      it.resting = true;
      it.moved = true;
      it.el.classList.add('is-held');
      last.x = e.clientX; last.y = e.clientY; last.t = window.performance.now();
    });

    it.el.addEventListener('keydown', function (e) {
      var by = e.shiftKey ? 40 : 12;
      if (e.key === 'ArrowLeft') it.tx -= by;
      else if (e.key === 'ArrowRight') it.tx += by;
      else if (e.key === 'ArrowUp') it.ty -= by;
      else if (e.key === 'ArrowDown') it.ty += by;
      else return;
      e.preventDefault();
      it.moved = true;
      applyClamp(it);
      draw(it);
    });

    // the browser's own image drag would fight with ours
    it.el.addEventListener('dragstart', function (e) { e.preventDefault(); });
  });

  window.addEventListener('pointermove', function (e) {
    if (!dragging || (pointerId !== null && e.pointerId !== pointerId)) return;
    e.preventDefault();
    var it = dragging;
    var now = window.performance.now();
    var dt = Math.max(8, now - last.t) / 1000;

    var nx = e.clientX - it.grabX;
    var ny = e.clientY - it.grabY;
    it.vx = it.vx * 0.5 + ((nx - it.tx) / dt) * 0.5;
    it.vy = it.vy * 0.5 + ((ny - it.ty) / dt) * 0.5;
    it.tx = nx;
    it.ty = ny;

    applyClamp(it);
    draw(it);
    last.x = e.clientX; last.y = e.clientY; last.t = now;
  }, { passive: false });

  function release(e) {
    if (!dragging) return;
    var it = dragging;
    if (it.el.releasePointerCapture && e && e.pointerId != null) {
      try { it.el.releasePointerCapture(e.pointerId); } catch (err) { }
    }
    it.el.classList.remove('is-held');
    dragging = null;
    pointerId = null;

    if (reduceMotion) { it.vx = it.vy = 0; it.resting = true; return; }
    it.vx = clamp(it.vx, -2600, 2600);
    it.vy = clamp(it.vy, -2600, 2600);
    it.resting = (Math.abs(it.vx) < STOP && Math.abs(it.vy) < STOP);
    if (!it.resting) startLoop();
  }

  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);

  // ---- initial placement, and again if the layout changes under them ----
  function placeAll(force) {
    items.forEach(function (it) { place(it, force); });
  }

  invalidatePage();
  items.forEach(measure);
  placeAll(false);
  // fonts and the portrait image both change the layout after first paint
  window.addEventListener('load', function () {
    invalidatePage();
    items.forEach(measure);
    placeAll(false);
  });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      invalidatePage();
      items.forEach(measure);
      placeAll(false);
    });
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      invalidatePage();
      items.forEach(function (it) {
        measure(it);
        if (!it.moved) place(it, true);
        else { applyClamp(it); draw(it); }
      });
    }, 150);
  });
})();
