// Phone notifications (web push), install-as-app and the other browser permissions the app uses.
import { rpc } from './api';

const VAPID_PUBLIC = 'BKUkGdBfn-J9Wkv_KOY3H8FtDxXbTKZY3NeFocd0zb2pbMDzSDqcL669YUgcG9wfzZfdsta-j6nMeN3g6UYAZuk';
const b64 = (s: string) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const notifState = (): NotificationPermission | 'unsupported' => (pushSupported() ? Notification.permission : 'unsupported');
export const isInstalled = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

/** Asks for notification permission (must be called from a tap) and registers this phone for push. */
export async function enablePush(): Promise<string> {
  if (!pushSupported()) return isIOS() && !isInstalled()
    ? 'On iPhone, first add the app to your Home Screen (Share → Add to Home Screen), open it from there, then turn notifications on.'
    : 'This browser does not support notifications. Use Chrome on Android or the installed app.';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'Notifications are blocked. Allow them in the browser / phone settings for this app, then try again.';
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID_PUBLIC) }));
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_user_agent: navigator.userAgent });
  try { await navigator.storage?.persist?.(); } catch { /* optional */ }
  return 'ok';
}
export async function disablePush() {
  const reg = await navigator.serviceWorker?.ready; const sub = await reg?.pushManager.getSubscription();
  if (sub) { await rpc('stop_push_subscription', { p_endpoint: sub.endpoint }); await sub.unsubscribe(); }
}
export async function pushActive() {
  // local test seam only: never reachable in production (served from a non-localhost origin)
  try { if (location.hostname === 'localhost' && localStorage.getItem('crux-e2e-notif') === '1') return true; } catch { /* ignore */ }
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration(); return !!(await reg?.pushManager.getSubscription());
}

// "Install app" prompt (Android / desktop Chrome). iPhone uses Share → Add to Home Screen.
let deferred: any = null;
const listeners = new Set<() => void>();
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; listeners.forEach((f) => f()); });
window.addEventListener('appinstalled', () => { deferred = null; listeners.forEach((f) => f()); });
export const canPromptInstall = () => !!deferred;
export const onInstallChange = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false; deferred.prompt(); const r = await deferred.userChoice; deferred = null; listeners.forEach((f) => f()); return r?.outcome === 'accepted';
}
