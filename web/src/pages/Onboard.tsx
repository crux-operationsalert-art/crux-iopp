import { FormEvent, useState } from 'react';
import { Me, rpc, sb, select } from '../lib/api';
import { time } from '../lib/format';
import { Card, ErrorBox, Loading, useLoad } from '../components/ui';

export function Logo({ me, compact }: { me?: Me | null; compact?: boolean }) {
  return (
    <div className="logo-plate" style={compact ? { padding: '6px 8px' } : undefined}>
      <img src="./crux-logo.png" alt="CRUX — You can bank on us" style={{ width: compact ? 120 : 200, height: 'auto', display: 'block' }} />
      {!compact && me?.company && <div className="small" style={{ color: '#012277', marginTop: 6 }}>{me.company.name} · {me.company.place}{me.company.website ? ` · ${me.company.website}` : ''}</div>}
    </div>
  );
}

/** Step 1: the user agreement, signed by typing the full name. Recorded with time, version, network address and device. */
export function AgreementGate({ me, onDone }: { me: Me; onDone: () => void }) {
  const a = useLoad(() => select('agreement_versions', 'version,title,body', (b) => b.eq('version', me.agreement_version)), [me.agreement_version]);
  const [name, setName] = useState('');
  const [tick, setTick] = useState({ conf: false, true_: false, integrity: false });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const ok = tick.conf && tick.true_ && tick.integrity && name.trim().length >= 3;
  async function sign(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await rpc('accept_agreement', { p_version: me.agreement_version, p_typed_name: name.trim(), p_user_agent: navigator.userAgent }); onDone(); }
    catch (x) { setErr(x); } finally { setBusy(false); }
  }
  const v = a.data?.[0];
  return (
    <div className="gate stack">
      <Logo me={me} />
      <Card title={v ? v.title : 'User agreement'}>
        {a.loading ? <Loading rows={4} /> : <ErrorBox error={a.error} />}
        {v && <div className="agreement" tabIndex={0} aria-label="Agreement text">{v.body.split('\n\n').map((p: string, i: number) => <p key={i}>{p}</p>)}</div>}
        <form className="stack" onSubmit={sign} style={{ marginTop: 12 }}>
          {([['conf', 'I will keep all CRUX, client, customer and colleague information confidential.'],
            ['true_', 'Every figure and detail I enter or certify will be true, complete and on time.'],
            ['integrity', 'I will not alter, hide or bypass records, and I understand all changes are audited.']] as const).map(([k, t]) => (
            <label key={k} className="row small" style={{ gap: 8, alignItems: 'flex-start' }}>
              <input type="checkbox" style={{ width: 20, height: 20, margin: 0, flex: 'none' }} checked={(tick as any)[k]} onChange={(e) => setTick({ ...tick, [k]: e.target.checked })} />{t}</label>))}
          <label className="field">Type your full name to sign ({me.full_name})<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
          <ErrorBox error={err} />
          <div className="row"><button className="btn primary" disabled={!ok || busy}>{busy ? 'Signing…' : 'I agree and sign'}</button>
            <button type="button" className="btn" onClick={() => sb.auth.signOut()}>Sign out</button></div>
          <p className="small muted">Version {me.agreement_version}. Your acceptance (date, time, network address and device) is recorded and visible to Admin.</p>
        </form>
      </Card>
    </div>
  );
}

const F: [string, string, string, boolean?][] = [
  ['date_of_birth', 'Date of birth', 'date'], ['joining_date', 'Joining / association date', 'date'],
  ['email', 'Email', 'email'], ['highest_qualification', 'Highest qualification', 'text'],
  ['current_address', 'Current address', 'textarea'], ['permanent_address', 'Permanent address', 'textarea'],
  ['city', 'City', 'text'], ['state', 'State', 'text'], ['pincode', 'PIN code (6 digits)', 'pin'],
  ['emergency_name', 'Emergency contact name', 'text'], ['emergency_relation', 'Relation', 'text'], ['emergency_phone', 'Emergency contact mobile', 'tel'],
  ['pan_last4', 'PAN — last 4 characters only', 'last4a'], ['aadhaar_last4', 'Aadhaar — last 4 digits only', 'last4'],
  ['bank_name', 'Bank name', 'text'], ['bank_ifsc', 'IFSC code', 'ifsc'], ['bank_account_last4', 'Bank account — last 4 digits only', 'last4'],
  ['firm_name', 'Firm / business name (partners)', 'text', true],
];

/** HR profile — every field is required. Only the last 4 characters of PAN / Aadhaar / bank account are kept. */
export function ProfileForm({ me, onDone, embedded }: { me: Me; onDone?: () => void; embedded?: boolean }) {
  const d = useLoad(async () => ({
    h: (await select('hr_profiles', '*', (b) => b.eq('person_id', me.person_id)))[0] ?? {},
    p: (await select('persons', 'personal_email', (b) => b.eq('id', me.person_id)))[0] ?? {},
    sal: await select('hr_compensation', 'monthly_gross,effective_from,created_at', (b) => b.eq('person_id', me.person_id).order('effective_from', { ascending: false }).limit(1)),
    ag: await select('agreement_acceptances', 'version,accepted_at,typed_name', (b) => b.eq('person_id', me.person_id).order('accepted_at', { ascending: false })),
  }), [me.person_id]);
  const [f, setF] = useState<Record<string, string> | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  if (d.loading) return <Loading rows={6} />;
  if (d.error) return <ErrorBox error={d.error} retry={d.reload} />;
  const v: Record<string, string> = f ?? { ...Object.fromEntries(Object.entries(d.data!.h).map(([k, x]) => [k, x == null ? '' : String(x)])), email: d.data!.p.personal_email ?? '' };
  const fields = F.filter(([, , , partnerOnly]) => !partnerOnly || me.resource_type === 'partner');
  const missing = fields.filter(([k]) => !String(v[k] ?? '').trim()).map(([, l]) => l);
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const r = await rpc('save_my_profile', { p: v }); setRes(r); if (r.complete) { setF(null); d.reload(); onDone?.(); } }
    catch (x) { setErr(x); } finally { setBusy(false); }
  }
  const set = (k: string, x: string) => setF({ ...v, [k]: x });
  return (
    <div className={embedded ? 'stack' : 'gate stack'}>
      {!embedded && <Logo me={me} />}
      <Card title={embedded ? 'My profile' : 'Complete your profile to start'}>
        <form className="stack" onSubmit={save}>
          <p className="small muted">All fields are required. For your safety only the <b>last 4</b> characters of PAN, Aadhaar and bank account are stored. Visible only to you, HR and Admin.</p>
          <div className="grid two">{fields.map(([k, l, t]) => (
            <label key={k} className="field">{l}
              {t === 'textarea' ? <textarea rows={2} value={v[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
                : <input value={v[k] ?? ''} onChange={(e) => set(k, t === 'ifsc' || t === 'last4a' ? e.target.value.toUpperCase() : e.target.value)}
                    type={t === 'date' ? 'date' : t === 'email' ? 'email' : 'text'}
                    inputMode={t === 'pin' || t === 'tel' || t === 'last4' ? 'numeric' : undefined}
                    maxLength={t === 'last4' || t === 'last4a' ? 4 : t === 'pin' ? 6 : t === 'ifsc' ? 11 : undefined}
                    pattern={t === 'pin' ? '\\d{6}' : t === 'tel' ? '\\d{10}' : t === 'last4' ? '\\d{4}' : t === 'last4a' ? '[A-Z0-9]{4}' : t === 'ifsc' ? '[A-Z]{4}0[A-Z0-9]{6}' : undefined} />}
              {k === 'permanent_address' && <button type="button" className="btn sm" style={{ marginTop: 4 }} onClick={() => set('permanent_address', v.current_address ?? '')}>Same as current</button>}
            </label>))}</div>
          {missing.length > 0 && <div className="banner warn">Still needed: {missing.join(', ')}.</div>}
          {res && !res.complete && <div className="banner warn">Saved. Still needed: {res.missing.join(', ')}.</div>}
          <ErrorBox error={err} />
          <div className="row"><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : missing.length ? 'Save' : 'Save profile'}</button>
            {!embedded && <button type="button" className="btn" onClick={() => sb.auth.signOut()}>Sign out</button>}</div>
        </form>
      </Card>
      {embedded && <Card title="Salary and agreement">
        <p>Monthly gross salary: <b>{d.data!.sal[0] ? `₹${Number(d.data!.sal[0].monthly_gross).toLocaleString('en-IN')} from ${d.data!.sal[0].effective_from}` : me.resource_type === 'partner' ? 'Not applicable (partner)' : 'Not entered yet — your manager enters it'}</b></p>
        <p className="small muted">{d.data!.ag.map((a: any) => `Agreement ${a.version} signed as "${a.typed_name}" on ${time(a.accepted_at)}`).join(' · ')}</p>
      </Card>}
    </div>
  );
}
