// Two-step sign-in (D-54): authenticator-app code (TOTP) through Supabase Auth.
import { useEffect, useState } from 'react';
import { rpc, sb } from '../lib/api';
import { Card, ErrorBox, Loading } from '../components/ui';

/** Shown after password sign-in when the account has an authenticator set up: asks for the 6-digit code. */
export function MfaPrompt({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true); setErr(null);
    try {
      const f = await sb.auth.mfa.listFactors(); const t = f.data?.totp?.find((x) => x.status === 'verified');
      if (!t) throw new Error('No authenticator is set up for this account.');
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: t.id, code: code.trim() });
      if (error) throw error;
      onDone();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <div className="login card stack">
      <h1>Enter your code</h1>
      <p className="muted">Open your authenticator app and type the 6-digit code for CRUX.</p>
      <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-label="6-digit code" />
      <ErrorBox error={err} />
      <button className="btn primary" disabled={busy || code.length !== 6} onClick={go}>{busy ? 'Checking…' : 'Continue'}</button>
      <button className="btn ghost" onClick={() => sb.auth.signOut()}>Sign out</button>
    </div>
  );
}

/** True when the session must still be verified with the code. */
export async function needsCode(): Promise<boolean> {
  try { const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel(); return data?.currentLevel === 'aal1' && data?.nextLevel === 'aal2'; }
  catch { return false; }
}

/** My profile → Two-step sign-in: set up or remove the authenticator code. */
export function TwoStepCard() {
  const [st, setSt] = useState<{ factor: any | null; status: any } | null>(null);
  const [enr, setEnr] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<unknown>(null);
  async function load() {
    const [f, s] = await Promise.all([sb.auth.mfa.listFactors(), rpc<any>('my_mfa_status')]);
    setSt({ factor: f.data?.totp?.find((x) => x.status === 'verified') ?? null, status: s });
  }
  useEffect(() => { load().catch(setErr); }, []);
  async function start() {
    setErr(null);
    try {
      const old = await sb.auth.mfa.listFactors();
      for (const x of old.data?.all ?? []) if (x.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: x.id });
      const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'CRUX ' + new Date().toISOString().slice(0, 10) });
      if (error) throw error;
      const t = (data as any).totp; setEnr({ id: data.id, qr: t.qr_code, secret: t.secret });
    } catch (e) { setErr(e); }
  }
  async function verify() {
    setErr(null);
    try { const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: enr!.id, code }); if (error) throw error; setEnr(null); setCode(''); await load(); }
    catch (e) { setErr(e); }
  }
  async function remove() {
    setErr(null);
    try { const { error } = await sb.auth.mfa.unenroll({ factorId: st!.factor.id }); if (error) throw error; await load(); } catch (e) { setErr(e); }
  }
  if (!st) return <Card title="Two-step sign-in"><Loading rows={1} /><ErrorBox error={err} /></Card>;
  return (
    <Card title="Two-step sign-in">
      <p className="small muted">Adds a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator…) at sign-in.
        {st.status?.privileged ? ' Your account has Admin / HR / Leadership powers' + (st.status.required ? ' — the code is required to use them.' : ' — recommended.') : ''}</p>
      {st.factor ? <div className="row"><span className="pill ok">On</span><span className="spacer" /><button className="btn sm" onClick={remove}>Turn off</button></div>
        : !enr ? <button className="btn primary" onClick={start}>Set up two-step sign-in</button>
        : <div className="stack">
            <p className="small">1. In your authenticator app, add an account and scan this code (or type the key below).</p>
            <img src={enr.qr} alt="QR code for the authenticator app" style={{ width: 180, height: 180, background: '#fff', padding: 8, borderRadius: 8 }} />
            <code className="small" style={{ wordBreak: 'break-all' }}>{enr.secret}</code>
            <label className="field">2. Type the 6-digit code it shows<input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></label>
            <button className="btn primary" disabled={code.length !== 6} onClick={verify}>Turn on</button>
          </div>}
      <ErrorBox error={err} />
    </Card>
  );
}
