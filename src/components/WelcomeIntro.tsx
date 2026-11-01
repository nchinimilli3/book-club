import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * First-run intro: books spelling the reader's first name drop onto a shelf,
 * then a book rises, opens in 3D and its page zooms out into the app.
 * Plays once per account per device; add ?intro to the URL to replay it.
 */

const SEEN_KEY = (userId: string) => `bc:intro-seen:${userId}`;

export function shouldPlayIntro(userId: string | undefined) {
  if (!userId || typeof window === 'undefined') return false;
  if (new URLSearchParams(window.location.search).has('intro')) return true;
  try { return !window.localStorage.getItem(SEEN_KEY(userId)); } catch { return false; }
}

function markSeen(userId: string) {
  try { window.localStorage.setItem(SEEN_KEY(userId), String(Date.now())); } catch { /* private mode: just replay next time */ }
  const url = new URL(window.location.href);
  if (url.searchParams.has('intro')) { url.searchParams.delete('intro'); window.history.replaceState(window.history.state, '', url); }
}

/* ---------- springs ---------- */

/** Samples a damped spring into a CSS linear() easing so WAAPI gets real overshoot. */
function springEasing(stiffness = 170, damping = 14, samples = 48) {
  const supports = typeof CSS !== 'undefined' && CSS.supports?.('animation-timing-function', 'linear(0, 1)');
  if (!supports) return { easing: 'cubic-bezier(.2,1.35,.4,1)', duration: 700 };
  const dt = 1 / 600;
  let x = 0, v = 0, t = 0;
  const points: number[] = [];
  // simulate until settled
  const trace: Array<[number, number]> = [];
  while (t < 3) {
    const a = stiffness * (1 - x) - damping * v;
    v += a * dt; x += v * dt; t += dt;
    trace.push([t, x]);
    if (t > .3 && Math.abs(1 - x) < .001 && Math.abs(v) < .01) break;
  }
  const total = trace[trace.length - 1][0];
  for (let i = 0; i <= samples; i++) {
    const target = (i / samples) * total;
    const sample = trace.find(([time]) => time >= target) || trace[trace.length - 1];
    points.push(Math.round(sample[1] * 1000) / 1000);
  }
  points[points.length - 1] = 1;
  return { easing: `linear(${points.join(', ')})`, duration: Math.round(total * 1000) };
}

/* ---------- particles ---------- */

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; hue: number; kind: 'dust' | 'spark' };

function startParticles(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { burst: () => {}, puff: () => {}, stop: () => {} };
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = 0, h = 0;
  const resize = () => { w = canvas.clientWidth; h = canvas.clientHeight; canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
  resize();
  window.addEventListener('resize', resize);
  const particles: Particle[] = [];
  const rand = (a: number, b: number) => a + Math.random() * (b - a);
  // ambient motes drifting through the light
  for (let i = 0; i < 46; i++) particles.push({ x: rand(0, w), y: rand(0, h), vx: rand(-.08, .08), vy: rand(-.18, -.04), life: rand(0, 600), max: Infinity, size: rand(.6, 1.8), hue: rand(36, 46), kind: 'dust' });
  let raf = 0, last = performance.now();
  const frame = (now: number) => {
    const step = Math.min(2.5, (now - last) / 16.67); last = now;
    ctx.clearRect(0, 0, w, h);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += step;
      if (p.kind === 'spark') { p.vy += .09 * step; p.vx *= .985; p.vy *= .985; }
      p.x += p.vx * step; p.y += p.vy * step;
      if (p.kind === 'dust') {
        if (p.y < -10) { p.y = h + 10; p.x = rand(0, w); }
        const twinkle = .25 + .25 * Math.sin(p.life * .03 + p.x);
        const beam = Math.max(0, 1 - Math.abs(p.x - w / 2) / (w * .55));
        ctx.fillStyle = `hsla(${p.hue}, 70%, 75%, ${twinkle * beam})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      } else {
        const fade = 1 - p.life / p.max;
        if (fade <= 0) { particles.splice(i, 1); continue; }
        ctx.fillStyle = `hsla(${p.hue}, 90%, ${60 + 25 * fade}%, ${fade})`;
        ctx.shadowColor = `hsla(${p.hue}, 100%, 60%, ${fade})`;
        ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.6 + fade * .6), 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return {
    burst(x: number, y: number, count = 70) {
      for (let i = 0; i < count; i++) {
        const angle = rand(-Math.PI * .95, -Math.PI * .05), speed = rand(2, 7.5);
        particles.push({ x: x + rand(-6, 6), y: y + rand(-60, 60), vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 0, max: rand(45, 90), size: rand(1.2, 3), hue: rand(34, 48), kind: 'spark' });
      }
    },
    puff(x: number, y: number) {
      for (let i = 0; i < 5; i++) particles.push({ x: x + rand(-14, 14), y, vx: rand(-.9, .9), vy: rand(-1.2, -.3), life: 0, max: rand(25, 40), size: rand(.8, 1.6), hue: 38, kind: 'spark' });
    },
    stop() { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); },
  };
}

/* ---------- shelf ---------- */

const SPINE_COLORS = ['#6b2632', '#1f3b33', '#22324f', '#b8862f', '#4b2e4f', '#20504f', '#7a4a2a', '#3a3f2a', '#8c3b2a', '#2b2a45'];

type Spine = { letter: string; color: string; height: number; band: number; lean?: boolean };

function buildSpines(name: string): Spine[] {
  const letters = (name.normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase() || 'READ').slice(0, 8).split('');
  const deco = (i: number): Spine => ({ letter: '', color: SPINE_COLORS[(i * 3 + 1) % SPINE_COLORS.length], height: [0.82, 0.92, 0.76, 0.88][i % 4], band: i % 3 });
  const named = letters.map((letter, i) => ({ letter, color: SPINE_COLORS[i % SPINE_COLORS.length], height: [1, .93, .97, .9, 1, .95, .91, .98][i % 8], band: i % 3 }));
  return [deco(0), deco(1), ...named, deco(2), { ...deco(3), lean: true }];
}

/* ---------- component ---------- */

export function WelcomeIntro({ userId, name, onDone }: { userId: string; name: string; onDone: () => void }) {
  const firstName = (name || '').trim().split(/\s+/)[0] || 'reader';
  const spines = useMemo(() => buildSpines(firstName), [firstName]);
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [leaving, setLeaving] = useState(false);
  const finished = useRef(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const finish = (fast = false) => {
    if (finished.current) return;
    finished.current = true;
    markSeen(userId);
    const el = root.current;
    if (!el) return doneRef.current();
    setLeaving(true);
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: fast ? 260 : 520, easing: 'ease', fill: 'forwards' }).finished.then(() => doneRef.current(), () => doneRef.current());
  };

  useEffect(() => {
    const el = root.current, cv = canvas.current;
    if (!el || !cv) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    html.style.overflow = 'hidden';
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => { timers.push(window.setTimeout(fn, ms)); };

    if (reduce) {
      el.classList.add('wi-reduced');
      at(2200, () => finish());
      return () => { timers.forEach(clearTimeout); html.style.overflow = prevOverflow; };
    }

    const fx = startParticles(cv);
    const q = <T extends Element>(s: string) => el.querySelector<T>(s)!;
    const qa = (s: string) => Array.from(el.querySelectorAll<HTMLElement>(s));
    const rise = springEasing(120, 15);

    // 1. light + shelf
    q<HTMLElement>('.wi-light').animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 1400, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
    q<HTMLElement>('.wi-plank').animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 700, delay: 150, easing: 'cubic-bezier(.2,.9,.2,1)', fill: 'both' });

    // 2. books drop in, each with a little spin and a dust puff on landing
    const books = qa('.wi-spine');
    const order = books.map((_, i) => i).sort(() => Math.random() - .5);
    order.forEach((index, n) => {
      const book = books[index];
      const delay = 380 + n * 85;
      const spin = (Math.random() * 30 - 15).toFixed(1);
      const lean = book.dataset.lean ? 'rotate(9deg)' : 'rotate(0deg)';
      // gravity fall, then a small bounce *up* so nothing ever sinks through the plank
      book.animate([
        { transform: `translateY(-110vh) rotate(${spin}deg)`, opacity: 1, easing: 'cubic-bezier(.5,0,.9,.4)' },
        { transform: `translateY(0) ${lean} scaleY(.94)`, offset: .62, easing: 'cubic-bezier(.2,.7,.4,1)' },
        { transform: `translateY(-${(10 + Math.random() * 10).toFixed(0)}px) ${lean} scaleY(1.02)`, offset: .8, easing: 'cubic-bezier(.6,0,.8,.4)' },
        { transform: `translateY(0) ${lean} scaleY(1)`, opacity: 1 },
      ], { duration: 820, delay, fill: 'both' });
      at(delay + 820 * .62, () => {
        const r = book.getBoundingClientRect(), c = cv.getBoundingClientRect();
        fx.puff(r.left + r.width / 2 - c.left, r.bottom - c.top);
      });
    });
    const landed = 380 + books.length * 85 + 820;

    // 3. foil shimmer across the name
    at(landed, () => {
      qa('.wi-letter').forEach((letter, i) => letter.animate(
        [{ backgroundPosition: '160% 0' }, { backgroundPosition: '-60% 0' }],
        { duration: 900, delay: i * 60, easing: 'ease-in-out', fill: 'both' },
      ));
      q<HTMLElement>('.wi-plank').animate([{ transform: 'translateY(0)' }, { transform: 'translateY(2px)' }, { transform: 'translateY(0)' }], { duration: 300, easing: 'ease-out' });
    });

    // 4. shelf recedes, the book rises
    const raise = landed + 900;
    at(raise, () => {
      q<HTMLElement>('.wi-shelf').animate([
        { transform: 'translateY(0) scale(1)', filter: 'blur(0px) brightness(1)', opacity: 1 },
        { transform: 'translateY(-14vh) scale(.82)', filter: 'blur(3px) brightness(.55)', opacity: .7 },
      ], { duration: 900, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' });
      q<HTMLElement>('.wi-book').animate([
        { transform: 'translateY(70vh) rotateX(38deg) rotateZ(-6deg)', opacity: 1 },
        { transform: 'translateY(0) rotateX(8deg) rotateZ(0deg)', opacity: 1 },
      ], { duration: rise.duration, easing: rise.easing, fill: 'both' });
      q<HTMLElement>('.wi-book-shadow').animate([{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 800, delay: 200, easing: 'ease-out', fill: 'both' });
    });

    // 5. the cover swings open, sparks fly from the spine
    const openAt = raise + Math.min(rise.duration, 1100) + 120;
    at(openAt, () => {
      q<HTMLElement>('.wi-book').animate([{ transform: 'translate(0,0) rotateX(8deg)' }, { transform: 'translate(calc(var(--wi-book-w) / 2), 0) rotateX(0deg)' }], { duration: 1100, easing: 'cubic-bezier(.45,.05,.2,1)', fill: 'forwards' });
      q<HTMLElement>('.wi-cover').animate([
        { transform: 'rotateY(0deg)' },
        { transform: 'rotateY(-18deg)', offset: .18 },
        { transform: 'rotateY(-168deg)' },
      ], { duration: 1150, easing: 'cubic-bezier(.45,.05,.2,1)', fill: 'forwards' });
      at(380, () => {
        const page = q<HTMLElement>('.wi-pages').getBoundingClientRect(), c = cv.getBoundingClientRect();
        fx.burst(page.left - c.left, page.top + page.height / 2 - c.top, 90);
      });
      q<HTMLElement>('.wi-page-copy').animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 700, delay: 520, easing: 'ease-out', fill: 'both' });
      qa('.wi-name-char').forEach((ch, i) => ch.animate([{ opacity: 0, transform: 'translateY(.35em)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 520, delay: 720 + i * 55, easing: 'cubic-bezier(.2,.9,.3,1.25)', fill: 'both' }));
    });

    // 6. dive into the page, which becomes the app
    const diveAt = openAt + 2300;
    at(diveAt, () => {
      const book = q<HTMLElement>('.wi-book-stage');
      const page = q<HTMLElement>('.wi-pages').getBoundingClientRect();
      const scale = Math.max(window.innerWidth / page.width, window.innerHeight / page.height) * 1.25;
      const dx = window.innerWidth / 2 - (page.left + page.width / 2);
      const dy = window.innerHeight / 2 - (page.top + page.height / 2);
      q<HTMLElement>('.wi-page-copy').animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' });
      q<HTMLElement>('.wi-shelf').animate([{ opacity: .7 }, { opacity: 0 }], { duration: 400, fill: 'forwards' });
      book.animate([
        { transform: 'translate(0,0) scale(1)' },
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
      ], { duration: 900, delay: 120, easing: 'cubic-bezier(.7,0,.2,1)', fill: 'forwards' });
      q<HTMLElement>('.wi-backdrop').animate([{ background: '#120e0b' }, { background: '#fbf8f1' }], { duration: 700, delay: 380, easing: 'ease-in', fill: 'forwards' });
      at(1050, () => finish());
    });

    return () => { timers.forEach(clearTimeout); fx.stop(); html.style.overflow = prevOverflow; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') finish(true); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={root} className={`wi${leaving ? ' wi-leaving' : ''}`} style={{ ['--wi-count' as string]: spines.length }} onClick={() => finish(true)}>
      <div className="wi-backdrop" />
      <div className="wi-light" />
      <canvas ref={canvas} className="wi-canvas" aria-hidden="true" />
      <p className="sr-only" role="status">Welcome to Book Club, {firstName}.</p>

      <div className="wi-scene" aria-hidden="true">
        <div className="wi-shelf">
          <div className="wi-books">
            {spines.map((spine, i) => (
              <span key={i} className={`wi-spine wi-band-${spine.band}`} data-lean={spine.lean ? '1' : undefined} style={{ background: spine.color, height: `calc(var(--wi-spine-h) * ${spine.height})` }}>
                {spine.letter && <b className="wi-letter">{spine.letter}</b>}
              </span>
            ))}
          </div>
          <span className="wi-plank" />
        </div>

        <div className="wi-book-stage">
          <span className="wi-book-shadow" />
          <div className="wi-book">
            <div className="wi-pages">
              <div className="wi-page-copy">
                <span className="wi-chapter">Chapter one</span>
                <strong className="wi-name">
                  {`Welcome, ${firstName}`.split('').map((ch, i) => <span className="wi-name-char" key={i}>{ch === ' ' ? ' ' : ch}</span>)}
                </strong>
                <span className="wi-ornament">❦</span>
                <span className="wi-tagline">Your shelf is ready.</span>
              </div>
            </div>
            <div className="wi-cover">
              <div className="wi-cover-front"><span className="wi-emblem">BC</span><span className="wi-cover-title">Book Club</span></div>
              <div className="wi-cover-back" />
            </div>
          </div>
        </div>
      </div>

      <button type="button" className="wi-skip" onClick={event => { event.stopPropagation(); finish(true); }}>Skip</button>
    </div>
  );
}
