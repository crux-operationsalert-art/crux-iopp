import { useState } from 'react';
import { sb } from '../lib/api';

/** Sign out that never hangs: the server is told when it answers quickly; this phone is signed out regardless. */
export async function signOut() {
  const wipe = () => {
    try { for (const k of Object.keys(localStorage)) if (k.startsWith('sb-') && k.includes('auth-token')) localStorage.removeItem(k); } catch { /* private mode */ }
    try { sessionStorage.clear(); } catch { /* private mode */ }
  };
  // the normal path waits for any token refresh in progress and for the network; give it 2.5 s at most
  const ok = await Promise.race([
    sb.auth.signOut().then((r) => !r.error).catch(() => false),
    new Promise<boolean>((res) => window.setTimeout(() => res(false), 2500)),
  ]);
  wipe();
  if (!ok) { window.location.replace(window.location.pathname + '#/'); window.location.reload(); }
  else window.location.hash = '#/';
}

export function SignOutButton({ className = 'btn', style }: { className?: string; style?: React.CSSProperties }) {
  const [busy, setBusy] = useState(false);
  return <button type="button" className={className} style={style} disabled={busy} aria-busy={busy}
    onClick={() => { setBusy(true); void signOut(); }}>{busy ? 'Signing out…' : 'Sign out'}</button>;
}
