(() => {
'use strict';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ============================================================
   Spring: interruptible, velocity aware.
   Always animates from the PRESENTATION value, so grabbing a
   moving element mid flight never jumps.
   Params follow Apple: damping ratio + response (seconds).
   ============================================================ */
class Spring {
  constructor(value, onUpdate, { damping = 1.0, response = 0.4 } = {}) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.damping = damping;
    this.response = response;
    this.onUpdate = onUpdate;
    this.raf = null;
    this.last = 0;
  }
  set(damping, response) { this.damping = damping; this.response = response; }
  /* Re-target without killing velocity: no brick wall on reversal. */
  to(target, velocity) {
    this.target = target;
    if (velocity !== undefined) this.velocity = velocity;
    this.start();
  }
  /* Direct set during a gesture: 1:1 tracking, no physics. */
  track(value, velocity = 0) {
    this.stop();
    this.value = value;
    this.velocity = velocity;
    this.onUpdate(this.value);
  }
  start() {
    if (reduceMotion.matches) { this.value = this.target; this.velocity = 0; this.onUpdate(this.value); return; }
    if (this.raf) return;
    this.last = performance.now();
    const tick = (now) => {
      const dt = Math.min((now - this.last) / 1000, 1 / 30);
      this.last = now;
      const w = 2 * Math.PI / this.response;      // natural frequency
      const z = this.damping;                     // damping ratio
      const x = this.value - this.target;
      const accel = -(w * w) * x - (2 * z * w) * this.velocity;
      this.velocity += accel * dt;
      this.value += this.velocity * dt;
      this.onUpdate(this.value);
      if (Math.abs(x) < 0.4 && Math.abs(this.velocity) < 0.4) {
        this.value = this.target; this.velocity = 0; this.onUpdate(this.value);
        this.raf = null; return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  stop() { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; } }
}

/* Apple's momentum projection (exponential decay, not v^2/2a). */
const project = (velocity, decelerationRate = 0.998) =>
  (velocity / 1000) * decelerationRate / (1 - decelerationRate);

/* Progressive resistance past a boundary. */
const rubberband = (overshoot, dimension, c = 0.55) =>
  (overshoot * dimension * c) / (dimension + c * Math.abs(overshoot));

/* ============================================================
   Reveal on scroll
   ============================================================ */
const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  });
}, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
$$('.reveal').forEach((el) => io.observe(el));

/* ============================================================
   Nav scroll edge effect
   ============================================================ */
const nav = $('#nav');
if (nav) {
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      nav.classList.toggle('is-scrolled', window.scrollY > 8);
      ticking = false;
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* ============================================================
   Mobile sheet: enters and exits along the same path (right),
   drag to dismiss with velocity handoff.
   ============================================================ */
(() => {
  const sheet = $('#sheet'), scrim = $('#scrim'), burger = $('#burger');
  if (!sheet || !scrim || !burger) return;
  const sheetW = () => sheet.getBoundingClientRect().width;
  let open = false;

  const spring = new Spring(1, (v) => {
    sheet.style.transform = `translate3d(${v * 100}%,0,0)`;
  }, { damping: 1.0, response: 0.34 });

  const openSheet = () => {
    open = true;
    scrim.hidden = false;
    sheet.setAttribute('aria-hidden', 'false');
    burger.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => scrim.classList.add('is-open'));
    spring.to(0);
    document.body.style.overflow = 'hidden';
  };
  const closeSheet = (velocity) => {
    open = false;
    sheet.setAttribute('aria-hidden', 'true');
    burger.setAttribute('aria-expanded', 'false');
    scrim.classList.remove('is-open');
    spring.to(1, velocity);
    document.body.style.overflow = '';
    setTimeout(() => { if (!open) scrim.hidden = true; }, 420);
  };
  burger.addEventListener('click', () => (open ? closeSheet() : openSheet()));
  scrim.addEventListener('click', () => closeSheet());
  $$('a', sheet).forEach((a) => a.addEventListener('click', () => closeSheet()));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) closeSheet(); });

  /* Drag the sheet to dismiss. Grab offset respected, velocity handed off. */
  let dragging = false, startX = 0, startV = 0, hist = [];
  sheet.addEventListener('pointerdown', (e) => {
    if (!open || e.pointerType === 'mouse') return;
    dragging = true;
    sheet.setPointerCapture(e.pointerId);
    spring.stop();
    startX = e.clientX;
    startV = spring.value;
    hist = [{ x: e.clientX, t: performance.now() }];
  });
  sheet.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const w = sheetW();
    let next = startV + (e.clientX - startX) / w;
    if (next < 0) next = rubberband(next * w, w) / w;
    spring.track(Math.min(next, 1));
    hist.push({ x: e.clientX, t: performance.now() });
    if (hist.length > 6) hist.shift();
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    const last = hist[hist.length - 1], first = hist[0];
    const dt = Math.max(last.t - first.t, 1);
    const vx = (last.x - first.x) / dt * 1000;
    const w = sheetW();
    const projected = spring.value * w + project(vx);
    if (projected > w * 0.4) closeSheet(vx / w);
    else { open = true; spring.to(0, vx / w); }
  };
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);
})();

/* ============================================================
   Sticky CTA on mobile: arrives once the hero CTA has scrolled away,
   leaves the same way it came.
   ============================================================ */
(() => {
  const bar = $('#stickyCta');
  const sentinel = $('#heroCta');
  if (!bar || !sentinel) return;
  const spring = new Spring(1.1, (v) => { bar.style.transform = `translate3d(0,${v * 100}%,0)`; }, { damping: 1.0, response: 0.4 });
  const obs = new IntersectionObserver((entries) => {
    const heroVisible = entries[0].isIntersecting;
    const formVisible = bar.dataset.formVisible === '1';
    spring.to(heroVisible || formVisible ? 1.1 : 0);
  }, { threshold: 0 });
  obs.observe(sentinel);
  const form = $('#dotaznik');
  if (form) {
    const obs2 = new IntersectionObserver((entries) => {
      bar.dataset.formVisible = entries[0].isIntersecting ? '1' : '0';
      const heroVisible = sentinel.getBoundingClientRect().bottom > 0;
      spring.to(heroVisible || entries[0].isIntersecting ? 1.1 : 0);
    }, { threshold: 0.05 });
    obs2.observe(form);
  }
})();

/* ============================================================
   Reviews rail: 1:1 drag, momentum projection, snap, rubberband
   ============================================================ */
(() => {
  const rail = $('#rail');
  if (!rail) return;
  const prev = $('#railPrev'), next = $('#railNext');
  const cards = [...rail.children];

  let x = 0;
  const spring = new Spring(0, () => {}, { damping: 1.0, response: 0.4 });

  const step = () => {
    const a = cards[0].getBoundingClientRect();
    const b = cards[1] ? cards[1].getBoundingClientRect() : null;
    return b ? b.left - a.left : a.width + 20;
  };
  const maxScroll = () => Math.max(0, rail.scrollWidth - rail.parentElement.clientWidth);
  const clampTarget = (v) => Math.max(-maxScroll(), Math.min(0, v));
  const snapPoints = () => {
    const s = step(), n = Math.ceil(maxScroll() / s);
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(clampTarget(-i * s));
    return pts;
  };
  const nearest = (v) => snapPoints().reduce((best, p) => Math.abs(p - v) < Math.abs(best - v) ? p : best, 0);
  const syncButtons = () => {
    if (!prev || !next) return;
    prev.disabled = x >= -1;
    next.disabled = x <= -maxScroll() + 1;
  };
  spring.onUpdate = (v) => { rail.style.transform = `translate3d(${v}px,0,0)`; x = v; syncButtons(); };

  const goto = (v, velocity) => spring.to(clampTarget(v), velocity);
  prev && prev.addEventListener('click', () => goto(nearest(x + step() + 1)));
  next && next.addEventListener('click', () => goto(nearest(x - step() - 1)));

  let dragging = false, moved = false, startX = 0, startVal = 0, hist = [];
  const HYSTERESIS = 8;

  rail.addEventListener('pointerdown', (e) => {
    dragging = true; moved = false;
    rail.setPointerCapture(e.pointerId);
    spring.stop();                       // interrupt: continue from the live value
    startX = e.clientX; startVal = x;
    hist = [{ x: e.clientX, t: performance.now() }];
  });
  rail.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    if (!moved && Math.abs(dx) < HYSTERESIS) return;
    if (!moved) { moved = true; rail.classList.add('is-grabbing'); }
    const w = rail.parentElement.clientWidth;
    let v = startVal + dx;
    const max = maxScroll();
    if (v > 0) v = rubberband(v, w);
    else if (v < -max) v = -max + rubberband(v + max, w);
    spring.track(v);
    hist.push({ x: e.clientX, t: performance.now() });
    if (hist.length > 6) hist.shift();
  });
  const release = () => {
    if (!dragging) return;
    dragging = false;
    rail.classList.remove('is-grabbing');
    if (!moved) return;
    const last = hist[hist.length - 1], first = hist[0];
    const dt = Math.max(last.t - first.t, 1);
    const vx = (last.x - first.x) / dt * 1000;
    const projected = x + project(vx);
    spring.set(0.82, 0.4);               // a flick earns a touch of bounce
    spring.to(clampTarget(nearest(projected)), vx);
    setTimeout(() => spring.set(1.0, 0.4), 700);
  };
  rail.addEventListener('pointerup', release);
  rail.addEventListener('pointercancel', release);
  rail.addEventListener('click', (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); } }, true);
  window.addEventListener('resize', () => { spring.to(clampTarget(nearest(x))); syncButtons(); });
  syncButtons();

  /* Review modal */
  const modal = $('#modal');
  if (!modal) return;
  const open = (card) => {
    $('#mPhoto').src = card.dataset.photo;
    $('#mName').textContent = card.dataset.name;
    $('#mSince').textContent = card.dataset.since;
    $('#mQuote').textContent = card.dataset.quote;
    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add('is-open'));
    document.body.classList.add('modal-open');
  };
  const close = () => {
    modal.classList.remove('is-open');
    document.body.classList.remove('modal-open');
    setTimeout(() => { modal.hidden = true; }, 380);
  };
  cards.forEach((c) => {
    c.style.cursor = 'pointer';
    c.addEventListener('click', () => { if (!moved) open(c); });
  });
  $$('[data-close]', modal).forEach((el) => el.addEventListener('click', close));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) close(); });
})();

/* ============================================================
   FAQ: height animated with a spring, interruptible
   ============================================================ */
$$('.faq-item').forEach((item) => {
  const btn = $('.faq-q', item);
  const panel = $('.faq-a', item);
  const inner = panel.firstElementChild;
  const spring = new Spring(0, (v) => { panel.style.height = Math.max(v, 0) + 'px'; }, { damping: 1.0, response: 0.36 });
  btn.addEventListener('click', () => {
    const isOpen = item.classList.toggle('is-open');
    btn.setAttribute('aria-expanded', String(isOpen));
    spring.to(isOpen ? inner.offsetHeight : 0);
  });
});

/* ============================================================
   More reviews: height animated with a spring, settles to auto
   ============================================================ */
(() => {
  const panel = $('#proofMore'), btn = $('#proofToggle');
  if (!panel || !btn) return;
  const inner = panel.firstElementChild;
  let open = false;
  const spring = new Spring(0, (v) => {
    panel.style.height = (open && v === spring.target) ? 'auto' : Math.max(v, 0) + 'px';
  }, { damping: 1.0, response: 0.42 });
  btn.addEventListener('click', () => {
    open = !open;
    btn.setAttribute('aria-expanded', String(open));
    const n = btn.dataset.count;
    btn.textContent = open ? 'Skrýt další recenze' : `Zobrazit další recenze (${n})`;
    if (open) {
      spring.to(inner.offsetHeight);
    } else {
      /* leave 'auto' from the live value, never from a stale number */
      spring.track(panel.offsetHeight);
      spring.to(0);
    }
  });
})();

/* ============================================================
   Showreel: play/pause, never autoplays under reduced motion
   ============================================================ */
(() => {
  const reel = $('#reel');
  if (!reel) return;
  const video = $('video', reel), btn = $('.reel-toggle', reel);
  if (!video || !btn) return;
  const icoPlay = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>';
  const icoPause = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/></svg>';
  const sync = () => {
    const playing = !video.paused;
    btn.innerHTML = playing ? icoPause : icoPlay;
    btn.setAttribute('aria-label', playing ? 'Pozastavit video' : 'Přehrát video');
  };
  if (reduceMotion.matches) { video.removeAttribute('autoplay'); video.pause(); }
  btn.addEventListener('click', () => { video.paused ? video.play() : video.pause(); });
  video.addEventListener('play', sync); video.addEventListener('pause', sync);
  sync();
})();

/* ============================================================
   Questionnaire: preselect service from ?sluzba=, lock the button
   on submit so a double tap never sends twice.
   ============================================================ */
(() => {
  const form = $('#dotaznikForm');
  if (!form) return;
  const service = $('select[name="sluzba"]', form);
  const wanted = new URLSearchParams(location.search).get('sluzba');
  if (service && wanted) {
    const opt = [...service.options].find((o) => o.value === wanted);
    if (opt) service.value = wanted;
  }
  $$('[data-sluzba]').forEach((el) => el.addEventListener('click', () => {
    if (!service) return;
    const opt = [...service.options].find((o) => o.value === el.dataset.sluzba);
    if (opt) service.value = el.dataset.sluzba;
  }));
  form.addEventListener('submit', () => {
    const btn = $('button[type="submit"]', form);
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = 'Odesílám';
  });
})();

/* ============================================================
   Smooth anchor scroll that respects reduced motion
   ============================================================ */
$$('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href');
    if (id === '#' || id.length < 2) return;
    const el = document.querySelector(id);
    if (!el) return;
    e.preventDefault();
    const y = el.getBoundingClientRect().top + window.scrollY - (id === '#top' ? 0 : 52);
    window.scrollTo({ top: y, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  });
});

})();
