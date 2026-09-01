/* ---------------------------------------------------------
   The guy at the desk.

   He is a small skeleton: pelvis -> torso -> (head, two arms),
   plus two legs, each limb a two-segment chain. With all the
   angles at 0 he is a straight standing figure, so every state
   is just a set of joint angles that we blend between.

     sit      typing, with a looping hand movement
     drag     ragdoll, dangling from the pointer, limbs lagging
     fall     dropped, under gravity until he hits the floor
     sprawl   flat on his back for a beat
     getup    blend from sprawl to standing
     walk     procedural gait (sine waves on the hips and knees),
              forwards or backwards depending on which side of
              the chair he landed on
     sitdown  blend from standing back into the typing pose

   Everything is in SVG viewBox units (0 60 528 310), so it
   stays correct at any screen size.
   --------------------------------------------------------- */
(function () {
  'use strict';

  var svg = document.getElementById('scene');
  var guy = document.getElementById('guy');
  var stage = document.getElementById('stage');
  var hint = document.getElementById('hint');
  var hintText = document.getElementById('hintText');
  if (!svg || !guy || !stage) return;

  // ---- world (viewBox units) ----
  var FLOOR = 348;
  var CHAIR_X = 296;
  var SIT_Y = 303;        // pelvis height when sitting (the chair decides this one)
  var STAND_Y, SPRAWL_Y, DRAG_FLOOR;   // derived from the poses, see below
  var MIN_X = 62;
  var MAX_X = 458;        // his sprawled limbs reach ~70 units past the pelvis
  var CEILING = 160;      // keeps his head inside the panel (he is ~94 tall above the pelvis)
  var THIGH = 32, SHIN = 32, SHOE = 4.5;   // SHOE = half the limb stroke width
  var GRAVITY = 1750;
  var WALK_SPEED = 132;   // units per second
  var STRIDE = 42;        // units covered per half step
  var STAND_OFF = 24;     // he stops this far in front of the seat, then backs into it

  /* prefers-reduced-motion is about continuous, unprompted movement, not
     about the direct result of something you just did. So under that setting
     we drop the idle typing loop and the spinning tumble, but he still walks
     back: that walk only ever happens because you picked him up, it is brief,
     and replacing it with a teleport just makes the page look broken. */
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- the rig: each joint and its fixed offset from its parent ----
  var JOINTS = {
    legBack:    { sel: '.leg-back',     x: -3, y: 2 },
    kneeBack:   { sel: '.knee-back',    x: 0, y: 32 },
    legFront:   { sel: '.leg-front',    x: 3, y: 2 },
    kneeFront:  { sel: '.knee-front',   x: 0, y: 32 },
    torso:      { sel: '.torso',        x: 0, y: 0 },
    armBack:    { sel: '.arm-back',     x: 1, y: -38 },
    elbowBack:  { sel: '.elbow-back',   x: 0, y: 20 },
    armFront:   { sel: '.arm-front',    x: 7, y: -38 },
    elbowFront: { sel: '.elbow-front',  x: 0, y: 20 },
    head:       { sel: '.head',         x: 0, y: -46 }
  };
  var KEYS = Object.keys(JOINTS);
  KEYS.forEach(function (k) { JOINTS[k].el = guy.querySelector(JOINTS[k].sel); });

  function pose(o) {
    var p = {};
    KEYS.forEach(function (k) { p[k] = o[k] || 0; });
    return p;
  }

  // ---- the poses ----
  var STAND = pose({
    legBack: 4, kneeBack: 3, legFront: -3, kneeFront: 4,
    armBack: 8, elbowBack: 10, armFront: -7, elbowFront: 12, head: 2
  });

  // hunched over the keyboard, hands on the desk
  var SIT = pose({
    legBack: -78, kneeBack: 80, legFront: -84, kneeFront: 86,
    torso: 6, armBack: -58, elbowBack: -12,
    armFront: -64, elbowFront: -8, head: 8
  });

  // dangling from the scruff of the neck
  var DANGLE = pose({
    legBack: 12, kneeBack: 34, legFront: -10, kneeFront: 44,
    torso: -6, armBack: 18, elbowBack: 24, armFront: -15, elbowFront: 30, head: -20
  });

  // landed on his backside, legs flat out in front, propped on his hands
  var SPRAWL = pose({
    legBack: -92, kneeBack: 8, legFront: -94, kneeFront: 6,
    torso: 20, armBack: 46, elbowBack: 26,
    armFront: -34, elbowFront: 34, head: -20
  });

  /* How far the lowest foot hangs below the pelvis in a given pose. Driving
     his height off this instead of a fixed number is what keeps his feet on
     the floor while the legs swing - a straight lerp between two poses
     straightens the legs out somewhere in the middle, and that mid-blend leg
     is longer than either end. */
  function footDrop(p) {
    function leg(hipA, kneeA) {
      var t = (hipA + kneeA) * Math.PI / 180;
      var knee = 2 + THIGH * Math.cos(hipA * Math.PI / 180);
      var ankle = knee + SHIN * Math.cos(t);
      // the shoe is drawn from the ankle to (13, 2) in the shin frame
      var toe = ankle + 13 * Math.sin(t) + 2 * Math.cos(t);
      return Math.max(ankle, toe) + SHOE;
    }
    return Math.max(leg(p.legBack, p.kneeBack), leg(p.legFront, p.kneeFront));
  }

  /* footDrop only knows about legs. For the three resting heights it is worth
     measuring the real thing once, so a propping hand or a leaned-back torso
     counts too. Falls back to the leg maths if getBBox is unavailable. */
  var hitRect = guy.querySelector('.guy-hit');
  function restingDrop(p) {
    try {
      if (hitRect) hitRect.style.display = 'none';
      applyPose(p);
      var bb = guy.getBBox();
      if (hitRect) hitRect.style.display = '';
      if (bb && bb.height) return bb.y + bb.height;
    } catch (e) {
      if (hitRect) hitRect.style.display = '';
    }
    return footDrop(p);
  }

  STAND_Y = FLOOR - restingDrop(STAND);
  SPRAWL_Y = FLOOR - restingDrop(SPRAWL);
  DRAG_FLOOR = FLOOR - restingDrop(DANGLE);   // held up, his toes just brush the floor

  function lerp(a, b, t) { return a + (b - a) * t; }

  function lerpPose(a, b, t) {
    var p = {};
    KEYS.forEach(function (k) { p[k] = lerp(a[k], b[k], t); });
    return p;
  }

  function applyPose(p) {
    KEYS.forEach(function (k) {
      var j = JOINTS[k];
      if (!j.el) return;
      j.el.style.transform =
        'translate(' + j.x + 'px,' + j.y + 'px) rotate(' + p[k].toFixed(2) + 'deg)';
    });
  }

  // ---- state ----
  var s = {
    mode: 'sit',
    x: CHAIR_X, y: SIT_Y, a: 0,   // pelvis position + whole-body angle
    vx: 0, vy: 0, va: 0,
    phase: 0,                     // walk / typing cycle
    t: 0,                         // transition progress
    from: SIT, fromX: CHAIR_X, goal: CHAIR_X, dir: 1
  };
  var current = SIT;
  var grab = { dx: 0, dy: 0, id: null };
  var last = { x: 0, y: 0, t: 0 };
  var lagA = 0, lagB = 0;         // limb lag while being dragged
  var raf = null, prevTime = 0, visible = true;
  var interacted = false;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  function toScene(clientX, clientY) {
    var ctm = svg.getScreenCTM();
    if (!ctm) return { x: s.x, y: s.y };
    var p = svg.createSVGPoint();
    p.x = clientX; p.y = clientY;
    return p.matrixTransform(ctm.inverse());
  }

  function render() {
    guy.setAttribute('transform',
      'translate(' + s.x.toFixed(2) + ' ' + s.y.toFixed(2) + ') rotate(' + s.a.toFixed(2) + ')');
    applyPose(current);
  }

  function setMode(mode) {
    s.mode = mode;
    var rattled = (mode === 'drag' || mode === 'fall' || mode === 'sprawl');
    guy.classList.toggle('is-dizzy', rattled);
    guy.classList.toggle('is-hurt', mode === 'sprawl');
    guy.classList.toggle('is-dragging', mode === 'drag');
    guy.setAttribute('aria-label', mode === 'sit'
      ? 'Jason, typing. Activate to tip him out of his chair.'
      : 'Jason is away from his desk. Activate to send him back.');
  }

  function showHint(text) {
    if (!hint || !hintText) return;
    hintText.textContent = text;
    hint.classList.add('show');
  }
  function hideHint() { if (hint) hint.classList.remove('show'); }

  function startTransition(mode, from) {
    s.t = 0;
    s.from = from;
    s.fromX = s.x;
    setMode(mode);
  }

  // shove him out of the chair, for keyboard users
  function yeet() {
    if (s.mode !== 'sit') return;
    interacted = true;
    hideHint();
    s.vx = 120 + Math.random() * 90;
    s.vy = -150;
    s.va = reduceMotion ? 0 : -180 - Math.random() * 120;
    current = SPRAWL;
    setMode('fall');
    startLoop();
  }

  function land() {
    s.y = SPRAWL_Y;
    s.vx = s.vy = s.va = 0;
    s.t = 0;
    s.a = s.a % 360;
    setMode('sprawl');
    showHint('ow.');
  }

  // ---- the walk: sine waves on the hips, knees that only fold one way ----
  function walkPose(phase, dir) {
    var swing = 34;
    var lift = 30;
    var pf = phase;
    var pb = phase + Math.PI;   // the legs are half a cycle apart
    return pose({
      legFront: -swing * Math.sin(pf),
      legBack: -swing * Math.sin(pb),
      // a knee only ever folds backwards, so clamp the negative half away
      kneeFront: 6 + lift * Math.max(0, Math.sin(pf - 1.1)),
      kneeBack: 6 + lift * Math.max(0, Math.sin(pb - 1.1)),
      // arms counter-swing against the legs
      armFront: 22 * Math.sin(pb) - 4,
      armBack: 22 * Math.sin(pf) - 4,
      elbowFront: 16,
      elbowBack: 16,
      torso: dir > 0 ? -5 : 4,      // he leans into the direction of travel
      head: dir > 0 ? 3 : -6        // walking backwards, he looks worried
    });
  }

  function step(dt) {
    var m = s.mode;

    if (m === 'sit') {
      if (reduceMotion) { current = SIT; return; }
      // looping typing motion, mostly in the forearms
      s.phase += dt * 13;
      var tap = Math.sin(s.phase);
      var tap2 = Math.sin(s.phase * 1.37 + 1.1);
      var p = {};
      KEYS.forEach(function (k) { p[k] = SIT[k]; });
      p.elbowFront = SIT.elbowFront + 5 * tap;
      p.elbowBack = SIT.elbowBack + 5 * tap2;
      p.armFront = SIT.armFront + 1.2 * tap;
      p.armBack = SIT.armBack + 1.2 * tap2;
      p.head = SIT.head + 1.6 * Math.sin(s.phase * 0.18);
      p.torso = SIT.torso + 0.5 * Math.sin(s.phase * 0.16);
      current = p;
      return;
    }

    if (m === 'drag') {
      // loose ragdoll: limbs lag behind wherever you fling him
      var target = clamp(-s.vx * 0.055, -46, 46);
      lagA += (target - lagA) * Math.min(1, dt * 7);
      lagB += (lagA - lagB) * Math.min(1, dt * 4);
      var tilt = clamp(s.vx * 0.035, -26, 26);
      s.a += (tilt - s.a) * Math.min(1, dt * 6);

      var d = {};
      KEYS.forEach(function (k) { d[k] = DANGLE[k]; });
      d.armFront = DANGLE.armFront + lagA;
      d.armBack = DANGLE.armBack + lagA * 0.8;
      d.elbowFront = DANGLE.elbowFront + lagB * 0.5;
      d.elbowBack = DANGLE.elbowBack + lagB * 0.4;
      d.legFront = DANGLE.legFront + lagB * 0.7;
      d.legBack = DANGLE.legBack + lagB * 0.55;
      d.kneeFront = DANGLE.kneeFront - lagB * 0.3;
      d.kneeBack = DANGLE.kneeBack - lagB * 0.25;
      d.head = DANGLE.head + lagB * 0.3;
      current = d;
      return;
    }

    if (m === 'fall') {
      s.vy += GRAVITY * dt;
      s.x = clamp(s.x + s.vx * dt, MIN_X, MAX_X);
      s.y += s.vy * dt;
      s.a += s.va * dt;
      if (s.x <= MIN_X || s.x >= MAX_X) s.vx *= -0.4;
      if (s.y < CEILING) { s.y = CEILING; s.vy = Math.abs(s.vy) * 0.4; }
      // the closer to the floor, the more he folds into the landing pose
      // range is generous on purpose: blending two poses straightens the legs
      // out somewhere in the middle, and that mid-blend leg is what would
      // otherwise swing through the floor
      var tuck = clamp((SPRAWL_Y - s.y) / 150, 0, 1);
      current = lerpPose(SPRAWL, DANGLE, tuck);
      if (s.y >= SPRAWL_Y) land();
      return;
    }

    if (m === 'sprawl') {
      // lie there a beat, settling flat onto his back
      s.t += dt;
      var flat = s.a > 90 ? 180 : (s.a < -90 ? -180 : 0);
      s.a += (flat - s.a) * Math.min(1, dt * 6);
      current = SPRAWL;
      if (s.t > (reduceMotion ? 0.15 : 0.45)) {
        s.dir = (CHAIR_X >= s.x) ? 1 : -1;
        startTransition('getup', SPRAWL);
      }
      return;
    }

    if (m === 'getup') {
      s.t += dt / 0.5;
      var k = easeOut(Math.min(1, s.t));
      s.a = lerp(s.a, 0, Math.min(1, dt * 9));
      current = lerpPose(s.from, STAND, k);
      // rise on the pose, but never further than his legs actually reach
      s.y = Math.min(lerp(SPRAWL_Y, STAND_Y, k), FLOOR - footDrop(current));
      if (s.t >= 1) {
        s.y = STAND_Y;
        s.a = 0;
        s.phase = 0;
        // stop just short of the chair on whichever side he landed,
        // so he never walks straight through it
        s.goal = CHAIR_X + STAND_OFF * (s.x > CHAIR_X ? 1 : -1);
        setMode('walk');
        showHint(s.dir > 0 ? 'brb' : 'walking back. don’t look.');
      }
      return;
    }

    if (m === 'walk') {
      var dx = s.goal - s.x;
      var dist = Math.abs(dx);
      var dirNow = dx > 0 ? 1 : -1;
      // ease down over the last stretch so he does not slam into the chair
      var speed = WALK_SPEED * (dist < 34 ? Math.max(0.35, dist / 34) : 1);
      var move = Math.min(dist, speed * dt);
      s.x += move * dirNow;
      // the phase runs backwards when he does, so his feet still grip the floor
      s.phase += (move / STRIDE) * Math.PI * dirNow;
      current = walkPose(s.phase, dirNow);
      s.y = FLOOR - footDrop(current);   // planted feet, and the bob comes free
      s.a = 0;
      if (dist <= 0.6) {
        s.x = s.goal;
        startTransition('sitdown', current);
      }
      return;
    }

    if (m === 'sitdown') {
      s.t += dt / 0.42;
      var e = easeInOut(Math.min(1, s.t));
      s.x = lerp(s.fromX, CHAIR_X, e);
      current = lerpPose(s.from, SIT, e);
      // same floor constraint as getting up, or his legs scissor through it
      s.y = Math.min(lerp(STAND_Y, SIT_Y, e), FLOOR - footDrop(current));
      s.a = 0;
      if (s.t >= 1) {
        s.x = CHAIR_X;
        s.y = SIT_Y;
        current = SIT;
        s.phase = 0;
        setMode('sit');
        showHint('back to work. thanks.');
        window.setTimeout(hideHint, 2000);
      }
      return;
    }
  }

  // ---- loop ----
  function tick(now) {
    var dt = Math.min(0.034, (now - prevTime) / 1000) || 0.016;
    prevTime = now;
    step(dt);
    render();
    var idle = reduceMotion && s.mode === 'sit';
    raf = (visible && !idle) ? window.requestAnimationFrame(tick) : null;
  }

  function startLoop() {
    if (raf !== null || !visible) return;
    if (reduceMotion && s.mode === 'sit') return;   // nothing to animate
    prevTime = window.performance.now();
    raf = window.requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (raf !== null) { window.cancelAnimationFrame(raf); raf = null; }
  }

  // ---- pointer: one code path for mouse, pen and touch ----
  function onDown(e) {
    if (s.mode === 'sitdown') return;
    e.preventDefault();
    interacted = true;
    hideHint();

    if (guy.setPointerCapture) {
      try { guy.setPointerCapture(e.pointerId); } catch (err) { }
    }
    grab.id = e.pointerId;
    var p = toScene(e.clientX, e.clientY);
    grab.dx = s.x - p.x;
    grab.dy = s.y - p.y;
    last.x = p.x; last.y = p.y; last.t = window.performance.now();
    s.vx = s.vy = s.va = 0;
    lagA = lagB = 0;
    current = DANGLE;
    setMode('drag');
    startLoop();
  }

  function onMove(e) {
    if (s.mode !== 'drag') return;
    if (grab.id !== null && e.pointerId !== grab.id) return;
    e.preventDefault();

    var p = toScene(e.clientX, e.clientY);
    var now = window.performance.now();
    var dt = Math.max(8, now - last.t) / 1000;

    var nx = clamp(p.x + grab.dx, MIN_X, MAX_X);
    var ny = clamp(p.y + grab.dy, CEILING, DRAG_FLOOR);

    // smooth the pointer velocity so one jittery sample cannot launch him
    s.vx = s.vx * 0.55 + ((nx - s.x) / dt) * 0.45;
    s.vy = s.vy * 0.55 + ((ny - s.y) / dt) * 0.45;
    s.x = nx;
    s.y = ny;

    last.x = p.x; last.y = p.y; last.t = now;

    // the loop normally does the drawing, but paint straight away if it is
    // not running so the drag can never feel detached from the pointer
    if (raf === null) { step(0); render(); }
  }

  function onUp(e) {
    if (s.mode !== 'drag') return;
    if (guy.releasePointerCapture && e && e.pointerId != null) {
      try { guy.releasePointerCapture(e.pointerId); } catch (err) { }
    }
    grab.id = null;

    s.vx = clamp(s.vx, -420, 420);
    s.vy = clamp(s.vy, -380, 700);
    s.va = reduceMotion ? 0 : clamp(s.vx * 0.5, -260, 260);
    setMode('fall');
    startLoop();
  }

  guy.addEventListener('pointerdown', onDown);
  // bound to the window, so a fast drag that outruns the element still tracks
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  guy.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    e.preventDefault();
    interacted = true;
    if (s.mode === 'sit') yeet();
    else if (s.mode === 'drag') onUp({ pointerId: grab.id });
  });

  // ---- only animate while he is actually on screen ----
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible) startLoop(); else stopLoop();
    }, { threshold: 0 }).observe(stage);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopLoop();
    else if (visible) startLoop();
  });

  // ---- boot ----
  setMode('sit');
  current = SIT;
  render();
  if (!reduceMotion) startLoop();
  window.setTimeout(function () {
    if (!interacted) showHint('psst — drag me off my chair');
  }, 1800);
})();
