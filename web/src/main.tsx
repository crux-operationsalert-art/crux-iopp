import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import '@fontsource-variable/instrument-sans';
import '@fontsource/instrument-serif/400.css';
import './styles.css';
import { net, TRAINING } from './lib/api';
// training mode loads its in-browser database only when asked for (it is large)
const TrainingRoot = React.lazy(() => import('./training/TrainingBar').then((m) => ({ default: m.TrainingRoot })));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><HashRouter>{TRAINING ? <React.Suspense fallback={<div className="login"><p className="muted">Loading training mode…</p></div>}><TrainingRoot>{(who: string) => <App key={who} />}</TrainingRoot></React.Suspense> : <App />}</HashRouter></React.StrictMode>,
);
if ('serviceWorker' in navigator && import.meta.env.PROD && !TRAINING) navigator.serviceWorker.register('./sw.js').catch(() => undefined);
// A tapped phone notification asks the open window to go to its screen (sw.js, D-101).
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => {
  const u = e.data && e.data.type === 'open' ? String(e.data.url || '') : '';
  const h = u.includes('#') ? u.slice(u.indexOf('#')) : '';
  if (h && h !== location.hash) location.hash = h;
});

// An app left open (or installed on a phone) keeps the version it loaded. When it comes back to the foreground,
// check whether a newer version was published and, if so, reload once so everyone sees the latest screens.
if (import.meta.env.PROD) {
  const mine = [...document.scripts].map((s) => s.src).find((s) => /assets\/index-.*\.js/.test(s));
  let busy = false, pending = false, lastTouch = 0;
  // Reload only when it cannot interrupt anything: no request running, nobody typing or tapping for 20 s, no form half filled.
  const quiet = () => net.inflight === 0 && Date.now() - lastTouch > 20000 && !document.querySelector('input:focus, textarea:focus')
    && ![...document.querySelectorAll<HTMLInputElement>('input:not([type=checkbox]):not([type=radio]):not([type=date]):not([type=month]), textarea')].some((i) => i.value && !i.disabled && !i.readOnly && i.closest('form'));
  const tryReload = () => { if (!pending) return; if (quiet()) location.reload(); else setTimeout(tryReload, 15000); };
  ['pointerdown', 'keydown', 'input'].forEach((ev) => document.addEventListener(ev, () => { lastTouch = Date.now(); }, { capture: true, passive: true }));
  const check = async () => {
    if (busy || document.visibilityState !== 'visible' || !mine) return; busy = true;
    try {
      const html = await (await fetch('./index.html', { cache: 'no-store' })).text();
      const latest = html.match(/assets\/index-[^"]+\.js/)?.[0];
      if (latest && !mine.endsWith(latest)) { pending = true; tryReload(); }
    } catch { /* offline: keep going */ } finally { busy = false; }
  };
  document.addEventListener('visibilitychange', check);
  setInterval(check, 10 * 60 * 1000);
}

// screen tests only: lets the test drive the on-device reader directly
try { if (localStorage.getItem('crux-e2e-ocr')) (window as unknown as { __ocr: unknown }).__ocr = () => import('./lib/ocr'); } catch { /* ignore */ }
