// When the app cannot reach the server: work out why (no internet / this network cannot find or reach the server),
// tell the person what to do, and keep a small record that is sent once the app is back online.
const KEY = 'crux-net-events';
const HOST = (() => { try { return new URL(import.meta.env.VITE_SUPABASE_URL as string).host; } catch { return ''; } })();
const URL0 = import.meta.env.VITE_SUPABASE_URL as string;
const APIKEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export type Diagnosis = { internet: boolean; dns_public: boolean; server: boolean; ms: number | null; verdict: 'offline' | 'blocked' | 'slow' | 'ok'; network: string };

const timed = async (u: string, init: RequestInit = {}, ms = 7000) => {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); const t0 = performance.now();
  try { const r = await fetch(u, { ...init, signal: c.signal, cache: 'no-store' }); return { ok: r.ok || r.type === 'opaque', ms: Math.round(performance.now() - t0) }; }
  catch { return { ok: false, ms: null as number | null }; } finally { clearTimeout(t); }
};
const netType = () => { const c = (navigator as any).connection; return c ? `${c.type ?? ''} ${c.effectiveType ?? ''}`.trim() : ''; };

export async function diagnose(): Promise<Diagnosis> {
  const [internet, dns, server] = await Promise.all([
    timed('https://www.gstatic.com/generate_204', { mode: 'no-cors' }),
    timed(`https://dns.google/resolve?name=${HOST}&type=A`),
    timed(`${URL0}/auth/v1/health`, { headers: { apikey: APIKEY } }, 9000),
  ]);
  const d: Diagnosis = { internet: internet.ok, dns_public: dns.ok, server: server.ok, ms: server.ms, network: netType(),
    verdict: !internet.ok ? 'offline' : !server.ok ? 'blocked' : (server.ms ?? 0) > 4000 ? 'slow' : 'ok' };
  record('diagnosis', d);
  return d;
}

export function record(kind: string, detail: Record<string, unknown>) {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    list.push({ at: new Date().toISOString(), kind, detail: { ...detail, ua: navigator.userAgent.slice(0, 160), network: netType(), online: navigator.onLine } });
    localStorage.setItem(KEY, JSON.stringify(list.slice(-40)));
  } catch { /* storage unavailable */ }
}

/** Send what was recorded while offline (called after the server answers again). */
export async function flush(send: (events: unknown[]) => Promise<unknown>) {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!list.length) return;
    await send(list); localStorage.removeItem(KEY);
  } catch { /* try next time */ }
}

export const ADVICE: Record<Diagnosis['verdict'], string> = {
  offline: 'This phone has no internet right now. Turn mobile data or Wi-Fi on, then tap Try again.',
  blocked: 'The internet works, but this network cannot reach the CRUX server. Fix: on Android go to Settings → Network & internet → Private DNS → "Private DNS provider hostname" → type dns.google → Save. On iPhone, switch to another network (Wi-Fi or the other SIM) or install the free "1.1.1.1" app and turn it on. Then tap Try again.',
  slow: 'The server is reachable but this connection is very slow. Move to a better signal or Wi-Fi, then tap Try again.',
  ok: 'The server is reachable now. Tap Try again.',
};
