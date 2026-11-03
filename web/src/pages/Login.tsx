import { FormEvent, useState } from 'react';
import { errText, sb } from '../lib/api';

/** Email one-time code sign-in (D-13). No passwords are stored or shown anywhere. */
export default function Login() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function send(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const { error } = await sb.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: true, emailRedirectTo: location.href.split('#')[0] } });
    setBusy(false);
    if (error) setMsg(errText(error)); else setSent(true);
  }
  async function verify(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const { error } = await sb.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) setMsg('That code is not valid or has expired. Request a new one.');
  }

  return (
    <div className="login card stack">
      <div className="row"><img src="./icon.svg" width={32} height={32} alt="" /><h1 style={{ margin: 0 }}>CRUX Productivity</h1></div>
      {!sent ? (
        <form onSubmit={send} className="stack">
          <label className="field">Work or personal email used by HR
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Send sign-in code'}</button>
        </form>
      ) : (
        <form onSubmit={verify} className="stack">
          <p>We sent a code and a sign-in link to <b>{email}</b>. Enter the code, or open the link on this device.</p>
          <label className="field">Sign-in code
            <input inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <button className="btn primary" disabled={busy}>{busy ? 'Checking…' : 'Sign in'}</button>
          <button type="button" className="btn" onClick={() => setSent(false)}>Use a different email</button>
        </form>
      )}
      {msg && <div className="banner bad" role="alert">{msg}</div>}
    </div>
  );
}
