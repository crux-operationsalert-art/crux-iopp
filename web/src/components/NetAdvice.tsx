import { useEffect, useState } from 'react';
import { ADVICE, diagnose, Diagnosis } from '../lib/netcheck';

/** Checks this phone's connection (internet, server, name lookup) and says what to do. */
export function NetAdvice() {
  const [d, setD] = useState<Diagnosis | null>(null);
  useEffect(() => { diagnose().then(setD).catch(() => null); }, []);
  if (!d) return <p className="muted small">Checking this phone's connection…</p>;
  return (
    <div className={`banner ${d.verdict === 'ok' ? 'ok' : 'warn'} small`} role="status">
      <div>{ADVICE[d.verdict]}</div>
      <div className="muted" style={{ marginTop: 4 }}>Check: internet {d.internet ? 'yes' : 'no'} · CRUX server {d.server ? `yes (${d.ms} ms)` : 'no'}{d.network ? ` · ${d.network}` : ''}</div>
    </div>
  );
}
