/* ═══════════════════════════════════════════════════════════════════
   THERMAL — boot.js
   Boot sequence: percentage counter animation + keypress handler.
   ═══════════════════════════════════════════════════════════════════ */

// ── Percentage counter ───────────────────────────────────────────────
const pct = document.getElementById('pct');
let start = null;
const duration = 3500;
const delay = 6100;

// Stagger values matching fillBar keyframes
const curve = [0, 18, 31, 52, 57, 74, 89, 100];
const times  = [0, 0.15, 0.30, 0.45, 0.55, 0.70, 0.85, 1.0];

function lerp(a, b, t) { return a + (b - a) * t; }

function getVal(progress) {
  for (let i = 1; i < times.length; i++) {
    if (progress <= times[i]) {
      const t = (progress - times[i-1]) / (times[i] - times[i-1]);
      return Math.round(lerp(curve[i-1], curve[i], t));
    }
  }
  return 100;
}

setTimeout(() => {
  function tick(ts) {
    if (!start) start = ts;
    const progress = Math.min((ts - start) / duration, 1);
    pct.textContent = getVal(progress) + '%';
    if (progress < 1) requestAnimationFrame(tick);
    else pct.textContent = '100%';
  }
  requestAnimationFrame(tick);
}, delay);

// ── Keypress handler — any key after boot completes → menu ──────────
let bootComplete = false;
setTimeout(() => { bootComplete = true; }, 9800);

function handleBootKey() {
  if (!bootComplete) return;
  document.removeEventListener('keydown', handleBootKey);
  const screen = document.querySelector('.screen');
  screen.style.animation = 'crtOff 0.65s cubic-bezier(0.4, 0, 1, 1) forwards';
  setTimeout(() => { window.location.href = 'menu.html'; }, 620);
}

document.addEventListener('keydown', handleBootKey);
