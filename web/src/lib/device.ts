// What the app records each time it is opened (D-139): time, device, network address, and location only when the person
// has ALREADY allowed location for this app — it never asks for a new permission. A phone's IMEI cannot be read by any web app.
import { rpc } from './api';

function deviceId(): string {
  try { let v = localStorage.getItem('crux-device'); if (!v) { v = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`); localStorage.setItem('crux-device', v); } return v; } catch { return ''; }
}
function describe(ua: string): { device: string; platform: string } {
  const os = /Android ([\d.]+)/.exec(ua) ? `Android ${RegExp.$1}` : /iPhone OS ([\d_]+)/.exec(ua) ? `iOS ${RegExp.$1.replace(/_/g, '.')}` : /iPad/.test(ua) ? 'iPadOS' : /Windows NT/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
  const br = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const model = /Android [\d.]+; ([^;)]+?)(?: Build|\))/.exec(ua)?.[1]?.trim();
  return { device: [br, 'on', model && model !== 'K' ? model : os].join(' '), platform: os };
}
async function knownLocation(): Promise<{ lat?: string; lng?: string; accuracy?: string }> {
  try {
    const st = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    if (st?.state !== 'granted') return {};
    return await new Promise((res) => navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6), accuracy: String(Math.round(p.coords.accuracy)) }), () => res({}), { maximumAge: 600000, timeout: 6000 }));
  } catch { return {}; }
}
/** Call once after the person is known. Never throws; logging must not get in the way of work. */
export async function logAccess(): Promise<void> {
  try {
    let first = false; try { first = !sessionStorage.getItem('crux-logged'); sessionStorage.setItem('crux-logged', '1'); } catch { /* ignore */ }
    const d = describe(navigator.userAgent);
    await rpc('log_access', { p_kind: first ? 'sign_in' : 'open', p_info: { device_id: deviceId(), ...d, screen: `${screen.width}x${screen.height}`, tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      lang: navigator.language, app_mode: window.matchMedia('(display-mode: standalone)').matches ? 'installed app' : 'browser', ...(await knownLocation()) } });
  } catch { /* ignore */ }
}
