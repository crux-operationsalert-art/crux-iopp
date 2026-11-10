import { useEffect, useRef, useState } from 'react';
import { Me } from '../lib/api';
import { canPromptInstall, enablePush, isInstalled, isIOS, notifState, onInstallChange, promptInstall, pushActive, pushSupported } from '../lib/push';
import { InstallGuide } from '../pages/Notifications';
import { Icon } from './Icon';
import { Logo } from '../pages/Onboard';

/** D-106: notifications are compulsory. Until this phone has them on, the app does not go further. On iPhone the app must
 *  be installed to the Home Screen first (Safari cannot ask otherwise), so the gate walks them through install → allow. */
export function NotifyGate({ me, onReady }: { me: Me; onReady: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [, force] = useState(0);
  const ref = useRef(false);
  useEffect(() => onInstallChange(() => force((x) => x + 1)), []);
  useEffect(() => {
    const check = async () => { if (!ref.current && await pushActive()) { ref.current = true; onReady(); } };
    check();
    const onVis = () => check();
    document.addEventListener('visibilitychange', onVis);
    const t = window.setInterval(check, 4000);
    return () => { document.removeEventListener('visibilitychange', onVis); window.clearInterval(t); };
  }, [onReady]);

  const iosNeedsInstall = isIOS() && !isInstalled();
  const unsupported = !pushSupported() && !iosNeedsInstall;

  async function allow() {
    setBusy(true); setMsg('');
    try { const r = await enablePush(); if (r === 'ok') { onReady(); return; } setMsg(r); force((x) => x + 1); }
    catch (e) { setMsg(String((e as Error).message ?? e)); } finally { setBusy(false); }
  }

  return (
    <div className="gate notifygate">
      <div className="ng-card">
        <div className="ng-top"><Logo compact /></div>
        <div className="ng-bell" aria-hidden><Icon name="bell" size={40} /></div>
        <h1 className="display">Turn on notifications to continue</h1>
        <p className="muted">Hi {me.full_name.split(' ')[0]} — CRUX needs to reach you for your daily report, reminders, approvals and messages. Please turn notifications on for this phone; the app opens once they are on.</p>

        {iosNeedsInstall ? (
          <div className="ng-steps">
            <p><b>On iPhone, first add CRUX to your Home Screen</b>, then turn notifications on from there:</p>
            <InstallGuide />
          </div>
        ) : unsupported ? (
          <div className="banner warn">This browser can't show notifications. Open CRUX in <b>Chrome</b> on Android, or install the app, then try again.</div>
        ) : (
          <>
            <button className="btn primary ng-btn" disabled={busy} onClick={allow}>{busy ? 'Asking…' : 'Turn on notifications'}</button>
            {!isInstalled() && canPromptInstall() && <button className="btn" onClick={() => promptInstall()}>Install the app first (recommended)</button>}
            {notifState() === 'denied' && <div className="banner warn small" role="alert">Notifications are blocked for CRUX. Open your phone <b>Settings → Apps → Chrome (or CRUX) → Notifications → Allow</b>, come back and tap the button again.</div>}
            {msg && <div className="banner warn small" role="alert">{msg}</div>}
          </>
        )}
        <details className="ng-what"><summary>What CRUX uses and records</summary>
          <ul className="about-list" style={{ textAlign: 'left', marginTop: 8 }}>
            <li><b>Notifications</b> (required) — so reminders, tasks and messages reach you.</li>
            <li><b>Camera</b> — only when you scan a document; your phone asks then.</li>
            <li><b>App activity</b> — when you are active and whether you have installed CRUX, to run reminders and improve adoption.</li>
            <li>CRUX <b>cannot</b> see other apps, your gallery, files or location.</li>
          </ul></details>
        <p className="small muted" style={{ marginTop: 14 }}>This keeps the team in sync. If you turn them off later in your phone settings, CRUX will ask again.</p>
      </div>
    </div>
  );
}
