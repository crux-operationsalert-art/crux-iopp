import { InstallGuide } from './Notifications';
import { FormEvent, useState } from 'react';
import { errText, isNetworkError, robustFetch, sb } from '../lib/api';

/** Login ID = mobile number (or email when no mobile is on record). No email is ever sent (D-13). */
export function loginEmail(id: string) {
  const v = id.trim().toLowerCase();
  if (v.includes('@')) return v;
  const d = v.replace(/\D/g, '');
  return `m${d.slice(-10)}@login.crux-iopp.app`;
}

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/iopp-auth`;

export default function Login() {
  const [mode, setMode] = useState<'signin' | 'activate'>(location.hash.includes('activate') ? 'activate' : 'signin');
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: 'bad' | 'ok'; m: string } | null>(null);

  async function signin(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const { error } = await sb.auth.signInWithPassword({ email: loginEmail(id), password: pw }).catch((e) => ({ error: e as Error }));
    setBusy(false);
    if (error) setMsg({ t: 'bad', m: /rate|too many/i.test(error.message) ? 'Too many attempts. Wait a few minutes and try again.'
      : isNetworkError(error) || /fetch|network/i.test(error.message) ? 'Could not reach the server — check your internet and try again.' : 'Mobile number / email or password is not correct.' });
  }
  async function activate(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    if (pw !== pw2) { setMsg({ t: 'bad', m: 'The two passwords do not match.' }); return; }
    setBusy(true);
    const send = () => robustFetch(FN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify({ action: 'activate', login: id, code, password: pw }) });
    try {
      let r: Response;
      try { r = await send(); }
      catch (e) {
        // The connection dropped. The code may already have been used on the server, so first try the new password; else send once more.
        if (!isNetworkError(e)) throw e;
        await new Promise((ok) => setTimeout(ok, 1500));
        const first = await sb.auth.signInWithPassword({ email: loginEmail(id), password: pw });
        if (!first.error) return;
        r = await send();
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ t: 'bad', m: j.error ?? 'Activation failed.' }); return; }
      const { error } = await sb.auth.signInWithPassword({ email: j.login_email, password: pw });
      if (error) setMsg({ t: 'ok', m: 'Your password is set. Sign in now.' });
    } catch (e) {
      setMsg({ t: 'bad', m: isNetworkError(e) ? 'Could not reach the server — the connection dropped. Check your internet and tap the button again (your code still works if it was not used).' : errText(e) });
    } finally { setBusy(false); }
  }

  return (
    <div className="login card stack">
      <div className="logo-plate" style={{ alignSelf: 'flex-start' }}><img src="./crux-logo.png" alt="CRUX — You can bank on us" style={{ width: 200, height: 'auto', display: 'block' }} /></div>
      <div><h1 style={{ margin: 0 }}>CRUX Productivity</h1><div className="small muted">Crux Risk Management Pvt. Ltd. · Pune · cruxindia.co.in</div></div>
      <div className="chips" role="tablist">
        <button role="tab" aria-selected={mode === 'signin'} className={`chip ${mode === 'signin' ? 'on' : ''}`} onClick={() => { setMode('signin'); setMsg(null); }}>Sign in</button>
        <button role="tab" aria-selected={mode === 'activate'} className={`chip ${mode === 'activate' ? 'on' : ''}`} onClick={() => { setMode('activate'); setMsg(null); }}>First time / reset password</button>
      </div>
      <form className="stack" onSubmit={mode === 'signin' ? signin : activate}>
        <label className="field">Mobile number (or email if you have no mobile on record)
          <input autoComplete="username" inputMode="text" required value={id} onChange={(e) => setId(e.target.value)} /></label>
        {mode === 'activate' && <label className="field">Activation code from your manager or Admin
          <input autoComplete="one-time-code" required placeholder="XXXXX-XXXXX" value={code} onChange={(e) => setCode(e.target.value)} /></label>}
        <label className="field">{mode === 'signin' ? 'Password' : 'Choose a password (at least 10 characters)'}
          <input type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required minLength={mode === 'activate' ? 10 : undefined} value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        {mode === 'activate' && <label className="field">Type the password again
          <input type="password" autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>}
        <button className="btn primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Set password and sign in'}</button>
      </form>
      {msg && <div className={`banner ${msg.t}`} role="alert">{msg.m}</div>}
      <details open={window.location.hash.includes('install')} className="card" style={{ padding: 12 }}>
        <summary><b>Get the app on your phone</b></summary>
        <div style={{ marginTop: 8 }}><InstallGuide /></div>
      </details>
      <p className="small muted">Forgot your password? Ask your manager or Admin for a new activation code, then use "First time / reset password". Codes work once and expire after 48 working hours.</p>
      <p className="small muted">For authorised CRUX employees and Business Associates only. Use is recorded and audited.</p>
    </div>
  );
}
