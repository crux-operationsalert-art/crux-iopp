import { time } from '../lib/format';
import { onboardingMessage } from '../lib/messages';
import { CopyBox } from './ui';

export function ActivationBanner({ a, onClose, sender, role, place, email, reset }: { a: any; onClose: () => void; sender?: string;
  role?: string; place?: string; email?: string | null; reset?: boolean }) {
  return (
    <div className="banner info" role="status">
      <div className="stack">
        <b>{reset ? 'New activation code' : 'Added'} — {a.full_name}: <span style={{ fontSize: '1.2rem', letterSpacing: '.08em' }}>{a.code}</span></b>
        <div className="small">Login ID {a.login_id} · valid until {time(a.expires_at)} · works once. The code is shown only now. Send the message below to the person directly (WhatsApp opens their chat when the login ID is a mobile number).</div>
        <CopyBox text={onboardingMessage(a, { sender: sender ?? 'CRUX Admin', role, place, reset })}
          mobile={/^\d+$/.test(String(a.login_id).replace(/\D/g, '')) && !String(a.login_id).includes('@') ? a.login_id : null}
          email={email ?? (String(a.login_id).includes('@') ? a.login_id : null)} subject="Your CRUX Productivity app login" />
        <div><button className="btn sm" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}
