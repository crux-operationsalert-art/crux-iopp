import { FormEvent, useState } from 'react';
import { Me, rpc, sb, select } from '../lib/api';
import { time } from '../lib/format';
import { Card, ErrorBox, Loading, useLoad } from '../components/ui';
import { IdScan } from '../components/IdScan';
import { Documents } from '../components/Documents';
import { formatId } from '../lib/ocrParse';
import { SalaryCard } from '../components/SalaryDeclaration';

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
  ['firm_name', 'Firm / business name (partners)', 'text', true],
];

/** Personal details — every field is required. Aadhaar, PAN and bank come from scanning the documents (CompleteProfile). */
export function ProfileForm({ me, onDone, embedded, onSaved, onlyMissing }: { me: Me; onDone?: () => void; embedded?: boolean; onSaved?: () => void; onlyMissing?: boolean }) {
  const d = useLoad(async () => ({
    h: (await select('hr_profiles', '*', (b) => b.eq('person_id', me.person_id)))[0] ?? {},
    p: (await select('persons', 'personal_email', (b) => b.eq('id', me.person_id)))[0] ?? {},
    ag: await select('agreement_acceptances', 'version,accepted_at,typed_name', (b) => b.eq('person_id', me.person_id).order('accepted_at', { ascending: false })),
  }), [me.person_id]);
  const [f, setF] = useState<Record<string, string> | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  if (d.loading) return <Loading rows={6} />;
  if (d.error) return <ErrorBox error={d.error} retry={d.reload} />;
  const v: Record<string, string> = f ?? { ...Object.fromEntries(Object.entries(d.data!.h).map(([k, x]) => [k, x == null ? '' : String(x)])), email: d.data!.p.personal_email ?? '' };
  const saved0: Record<string, unknown> = { ...d.data!.h, email: d.data!.p.personal_email };
  const fields = F.filter(([k, , , partnerOnly]) => (!partnerOnly || me.resource_type === 'partner') && (!onlyMissing || !String(saved0[k] ?? '').trim()));
  if (onlyMissing && fields.length === 0) return null;
  const missing = fields.filter(([k]) => !String(v[k] ?? '').trim()).map(([, l]) => l);
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const r = await rpc('save_my_profile', { p: v }); setRes(r); setF(null); d.reload(); onSaved?.(); if (r.complete) onDone?.(); }
    catch (x) { setErr(x); } finally { setBusy(false); }
  }
  const set = (k: string, x: string) => setF({ ...v, [k]: x });
  return (
    <div className={embedded ? 'stack' : 'gate stack'}>
      {!embedded && <Logo me={me} />}
      <Card title={onlyMissing ? 'Personal details still needed' : 'Personal details'}>
        <form className="stack" onSubmit={save}>
          <p className="small muted">All fields are required. Visible to you, HR, Admin and your managers. Aadhaar, PAN and bank details are read from your documents above.</p>
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
          {res && !res.complete && <div className="banner info">Saved.{missing.length === 0 ? ' Your details are complete; finish the documents above.' : ''}</div>}
          <ErrorBox error={err} />
          <div className="row"><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : missing.length ? 'Save' : 'Save profile'}</button>
            {!embedded && <button type="button" className="btn" onClick={() => sb.auth.signOut()}>Sign out</button>}</div>
        </form>
      </Card>
      {embedded && !onlyMissing && d.data!.ag.length > 0 && <p className="small muted">{d.data!.ag.map((a: any) => `Agreement ${a.version} signed as "${a.typed_name}" on ${time(a.accepted_at)}`).join(' · ')}</p>}
    </div>
  );
}

type Progress = { pct: number; done: number; total: number; missing: string[]; due_at: string; blocking: boolean };
/** Profile completion (D-88): scan Aadhaar, PAN and bank proof (read on the phone), upload the qualification certificate,
 *  fill the personal details. Shows % complete; within the deadline the person may skip for now, after it they cannot. */
export function CompleteProfile({ me, onDone, onSkip, gate }: { me: Me; onDone: () => void; onSkip?: () => void; gate?: boolean }) {
  const prof = useLoad(() => rpc<any>('person_profile', { p_person: me.person_id }), [me.person_id]);
  const docs = useLoad(() => rpc<any[]>('scannable_documents', { p_person: me.person_id }), [me.person_id]);
  const [pg, setPg] = useState<Progress | null>(null);
  const p: Progress | undefined = pg ?? prof.data?.progress ?? me.profile;
  const id = prof.data?.identity ?? {};
  const ex = (types: string[]) => ((docs.data ?? []) as any[]).find((d) => types.includes(d.doc_type)) ?? null;
  const firstAuto = (['aadhaar', 'pan', 'bank'] as const).find((k) => !(k === 'aadhaar' ? id.aadhaar : k === 'pan' ? id.pan : id.bank_account) && ex(k === 'bank' ? ['bank', 'cancelled_cheque'] : [k]));
  const saved = (r?: any) => { if (r?.pct != null) setPg(r); prof.reload(); docs.reload(); if (r?.pct === 100) onDone(); };
  const daysLeft = p ? Math.max(0, Math.ceil((new Date(p.due_at).getTime() - Date.now()) / 86400000)) : 0;
  return (
    <div className={gate ? 'gate stack' : 'stack'}>
      {gate && <Logo me={me} />}
      <Card title={gate ? 'Complete your profile' : 'My profile'}>
        {prof.loading ? <Loading rows={2} /> : <ErrorBox error={prof.error} retry={prof.reload} />}
        {p && <div className="stack">
          <div className="row"><b style={{ fontSize: '1.4rem' }}>{p.pct}%</b><span className="muted">complete ({p.done} of {p.total})</span><span className="spacer" />
            {p.pct < 100 && (p.blocking ? <span className="pill bad">Required now — the app opens when this is complete</span>
              : <span className="pill warn">Complete by {new Date(p.due_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {daysLeft} day{daysLeft === 1 ? '' : 's'} left</span>)}</div>
          <div style={{ height: 10, background: 'var(--border)', borderRadius: 5 }} role="progressbar" aria-valuenow={p.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Profile complete">
            <div style={{ width: `${p.pct}%`, height: '100%', borderRadius: 5, background: p.pct === 100 ? 'var(--ok, #1a7f37)' : 'var(--accent, #1f6feb)' }} /></div>
          {p.missing.length > 0 && <div className="small">Still needed: {p.missing.join(' · ')}</div>}
          <p className="small muted">Upload a photo or PDF of each document. It is read on this phone — you do not type the numbers. You see what was read and confirm it. Full numbers are visible only to you, HR and Admin.</p>
          {gate && !p.blocking && p.pct < 100 && onSkip && <div><button className="btn" onClick={onSkip}>Skip for now ({daysLeft} day{daysLeft === 1 ? '' : 's'} left)</button></div>}
        </div>}
      </Card>
      {prof.data && docs.data && p && <>
        {!id.aadhaar && <IdScan personId={me.person_id} kind="aadhaar" existing={ex(['aadhaar'])} autoStart={firstAuto === 'aadhaar'} onSaved={saved} />}
        {!id.pan && <IdScan personId={me.person_id} kind="pan" existing={ex(['pan'])} autoStart={firstAuto === 'pan'} onSaved={saved} />}
        {!(id.bank_account && id.bank_ifsc) && <IdScan personId={me.person_id} kind="bank" existing={ex(['bank', 'cancelled_cheque'])} autoStart={firstAuto === 'bank'} onSaved={saved} />}
        {p.missing.includes('qualification certificate (upload)') && <Documents me={me} personId={me.person_id} title="Qualification certificate (highest)" types={['qualification']} onUploaded={saved} />}
        <ProfileForm key={`pending-${p.done}`} me={me} embedded onSaved={saved} onlyMissing />
        {p.pct === 100 && <div className="banner ok">Your profile is complete.</div>}
      </>}
      {!gate && <SalaryCard me={me} />}
      {!gate && prof.data && <Card title="Done — view or change">
        <details><summary style={{ cursor: 'pointer' }}>Completed details ({p?.done ?? 0} of {p?.total ?? 0})</summary>
          <div className="stack" style={{ marginTop: 10 }}>
            {id.aadhaar && <IdScan personId={me.person_id} kind="aadhaar" done={formatId('aadhaar', id.aadhaar)} onSaved={saved} />}
            {id.pan && <IdScan personId={me.person_id} kind="pan" done={id.pan} onSaved={saved} />}
            {id.bank_account && id.bank_ifsc && <IdScan personId={me.person_id} kind="bank" done={`${id.bank_account} · ${id.bank_ifsc}`} onSaved={saved} />}
            <ProfileForm me={me} embedded onSaved={saved} />
            <Documents me={me} personId={me.person_id} title="All my documents" />
          </div></details></Card>}
      {gate && <div className="row"><button type="button" className="btn" onClick={() => sb.auth.signOut()}>Sign out</button></div>}
    </div>
  );
}
