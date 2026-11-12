import { useState } from 'react';
import { Me, rpc } from '../lib/api';
import { money, time } from '../lib/format';
import { Letterhead, LetterDoc, letterPdf, payslipPdf, saveBlob, Slip } from '../lib/pdf';
import { Card, Empty, ErrorBox, Loading, Tabs, useLoad } from '../components/ui';
import { SignaturePad } from '../components/SignaturePad';

export type LetterRow = { id: string; ref_no: string; person_id: string; person: string; designation: string | null; kind: string; title: string; status: 'issued' | 'signed' | 'declined' | 'withdrawn';
  needs_signature: boolean; issued_at: string; signed_at: string | null; closed_reason: string | null };
export const STATUS: Record<string, [string, string]> = { issued: ['warn', 'Waiting for signature'], signed: ['ok', 'Signed'], declined: ['bad', 'Not accepted'], withdrawn: ['neutral', 'Withdrawn'] };
export const statusPill = (l: { status: string; needs_signature: boolean }) => {
  const [c, t] = STATUS[l.status] ?? ['neutral', l.status];
  return <span className={`pill ${c}`}>{l.status === 'issued' && !l.needs_signature ? 'To acknowledge' : l.status === 'signed' && !l.needs_signature ? 'Acknowledged' : t}</span>;
};
const monthName = (m: string) => new Date(m + 'T12:00:00+05:30').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const fileSafe = (s: string) => s.replace(/[^\w.-]+/g, '_');

/** My letters and salary slips: read, sign on the phone, and download whenever needed (D-131, D-132). */
export default function Letters({ me }: { me: Me }) {
  const [tab, setTab] = useState<'letters' | 'slips'>('letters');
  const list = useLoad(() => rpc<LetterRow[]>('letters_list', { p_person: null }), []);
  const mine = (list.data ?? []).filter((l) => l.person_id === me.person_id);
  const waiting = mine.filter((l) => l.status === 'issued').length;
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="stack">
      <div><h1>My letters & salary slips</h1><p className="muted" style={{ margin: 0 }}>Letters from HR to read and sign, and your salary slips. Download any of them whenever you need.</p></div>
      <Tabs tabs={[['letters', `Letters${waiting ? ` (${waiting} to sign)` : ''}`], ['slips', 'Salary slips']]} value={tab} onChange={setTab} />
      {tab === 'letters' && (open
        ? <LetterView id={open} mine onBack={() => { setOpen(null); list.reload(); }} />
        : <Card title="Letters from HR">
            {list.loading && !list.data ? <Loading rows={3} /> : <ErrorBox error={list.error} retry={list.reload} />}
            {list.data && (mine.length === 0 ? <Empty>No letters yet. When HR sends you one, it appears here and you get a notification.</Empty> :
              <div className="stack" style={{ gap: 8 }}>{mine.map((l) => (
                <button key={l.id} className="rowbtn" onClick={() => setOpen(l.id)}>
                  <span style={{ flex: 1, minWidth: 0 }}><b>{l.title}</b><span className="small muted" style={{ display: 'block' }}>{l.ref_no} · sent {time(l.issued_at)}{l.signed_at ? ` · signed ${time(l.signed_at)}` : ''}</span></span>
                  {statusPill(l)}</button>))}</div>)}
          </Card>)}
      {tab === 'slips' && <Payslips personId={null} />}
    </div>
  );
}

/** One letter on the letterhead: read it, sign or decline it, download it. Also used by HR to look at any letter. */
export function LetterView({ id, mine, onBack }: { id: string; mine: boolean; onBack: () => void }) {
  const d = useLoad(async () => ({ l: await rpc<LetterDoc & { id: string; closed_reason?: string | null; intact: boolean; issued_by_name?: string | null }>('letter_get', { p_id: id }), lh: await rpc<Letterhead>('letterhead', {}) }), [id]);
  const [name, setName] = useState(''); const [sig, setSig] = useState<string | null>(null); const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(''); const [err, setErr] = useState<unknown>(null); const [why, setWhy] = useState<string | null>(null);
  if (d.loading && !d.data) return <Loading rows={5} />;
  if (d.error || !d.data) return <div className="stack"><button className="btn sm" onClick={onBack}>Back</button><ErrorBox error={d.error} retry={d.reload} /></div>;
  const { l, lh } = d.data; const canSign = mine && l.status === 'issued';
  const act = async (k: string, fn: () => Promise<unknown>) => { setBusy(k); setErr(null); try { await fn(); } catch (e) { setErr(e); } finally { setBusy(''); } };
  const download = () => act('pdf', async () => saveBlob(await letterPdf(l, lh), fileSafe(`${l.title}_${l.ref_no}.pdf`)));
  const sign = () => act('sign', async () => { await rpc('letter_sign', { p_id: id, p_typed_name: name.trim(), p_signature: l.needs_signature ? sig : null, p_user_agent: navigator.userAgent }); d.reload(); });
  const close = () => act('close', async () => { await rpc('letter_close', { p_id: id, p_reason: (why ?? '').trim() }); setWhy(null); d.reload(); });
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="btn sm" onClick={onBack}>Back to the list</button>
        <button className="btn sm" disabled={busy === 'pdf'} onClick={download}>{busy === 'pdf' ? 'Preparing…' : 'Download PDF'}</button>
      </div>
      <div className="letter">
        <div className="letter-head">{lh.letterhead ? <img src={lh.letterhead} alt={`${lh.name} letterhead`} /> :
          <div className="row" style={{ gap: 12 }}><img src={`${import.meta.env.BASE_URL}crux-logo.png`} alt="" style={{ height: 40 }} />
            <div><b style={{ fontSize: '1.05rem' }}>{lh.name}</b><div className="small muted">{[lh.address || lh.place, lh.website].filter(Boolean).join(' · ')}</div></div></div>}</div>
        <div className="row small" style={{ justifyContent: 'space-between' }}><span>Ref: {l.ref_no}</span><span>{new Date(l.issued_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' })}</span></div>
        <p style={{ margin: '10px 0 0' }}><b>{l.person}</b>{l.designation ? <><br />{l.designation}</> : null}</p>
        <h2 style={{ fontSize: '1.05rem', margin: '14px 0 8px' }}>{l.title}</h2>
        {l.body.split(/\n{2,}/).map((p, i) => <p key={i} style={{ whiteSpace: 'pre-wrap' }}>{p}</p>)}
        <div className="letter-sign">
          <div><div className="small muted">For {lh.name}</div>{lh.signature && <img src={lh.signature} alt="" style={{ height: 44 }} />}<div><b>{lh.signatory_name || 'Authorised Signatory'}</b></div>{lh.signatory_name && <div className="small muted">{lh.signatory_title}</div>}</div>
          {l.status === 'signed' && <div><div className="small muted">{l.needs_signature ? 'Read, understood and accepted' : 'Received and acknowledged'}</div>
            {l.signature && <img src={l.signature} alt={`Signature of ${l.signed_name}`} style={{ height: 54, maxWidth: 200 }} />}
            <div><b>{l.signed_name}</b></div><div className="small muted">Signed digitally on {time(l.signed_at!)}</div></div>}
        </div>
      </div>
      {!l.intact && <div className="banner bad">This letter's text no longer matches what was issued. Tell HR.</div>}
      {l.status === 'declined' && <div className="banner bad">Not accepted{l.closed_reason ? ` — ${l.closed_reason}` : ''}. HR has been told.</div>}
      {l.status === 'withdrawn' && <div className="banner neutral">HR withdrew this letter{l.closed_reason ? ` — ${l.closed_reason}` : ''}.</div>}
      {l.status === 'signed' && <div className="banner ok">{l.needs_signature ? 'Signed' : 'Acknowledged'} on {time(l.signed_at!)}. You can download the signed copy at any time.</div>}
      <ErrorBox error={err} />
      {canSign && why === null && (
        <Card title={l.needs_signature ? 'Accept and sign' : 'Acknowledge this letter'}>
          <div className="stack">
            <label className="row" style={{ gap: 8, alignItems: 'flex-start' }}><input type="checkbox" style={{ width: 'auto', minHeight: 0, marginTop: 4 }} checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>I have read this letter fully{l.needs_signature ? ' and I accept it' : ''}.</span></label>
            <label className="field">Type your full name<input value={name} onChange={(e) => setName(e.target.value)} placeholder={l.person} autoComplete="name" /></label>
            {l.needs_signature && <div className="field">Your signature<SignaturePad onChange={setSig} /></div>}
            <div className="row">
              <button className="btn primary" disabled={!agree || name.trim().length < 3 || (l.needs_signature && !sig) || busy === 'sign'} onClick={sign}>{busy === 'sign' ? 'Saving…' : l.needs_signature ? 'Sign and accept' : 'Acknowledge'}</button>
              <button className="btn" onClick={() => setWhy('')}>I do not accept</button>
            </div>
            <p className="small muted" style={{ margin: 0 }}>Your name, signature, the date and time and this device are recorded with the letter. After signing, the letter cannot be changed.</p>
          </div>
        </Card>)}
      {canSign && why !== null && (
        <Card title="Tell HR why you do not accept">
          <div className="stack">
            <label className="field">Reason<textarea rows={3} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="For example: my joining date is wrong" /></label>
            <div className="row"><button className="btn primary" disabled={why.trim().length < 3 || busy === 'close'} onClick={close}>Send to HR</button><button className="btn" onClick={() => setWhy(null)}>Go back</button></div>
          </div>
        </Card>)}
    </div>
  );
}

/** Salary slips of one person (own when personId is null): list by month, download as PDF. */
export function Payslips({ personId }: { personId: string | null }) {
  const d = useLoad(() => rpc<{ month: string; net: number; source: string }[]>('payslips', { p_person: personId }), [personId]);
  const [busy, setBusy] = useState(''); const [err, setErr] = useState<unknown>(null);
  async function get(m: string) {
    setBusy(m); setErr(null);
    try { const [s, lh] = await Promise.all([rpc<Slip>('payslip', { p_person: personId, p_month: m }), rpc<Letterhead>('letterhead', {})]);
      saveBlob(await payslipPdf(s, lh), fileSafe(`Salary_slip_${m.slice(0, 7)}_${s.person}.pdf`)); } catch (e) { setErr(e); } finally { setBusy(''); }
  }
  return (
    <Card title="Salary slips" help="A slip appears once HR has approved that month's payroll. Slips for earlier months appear when HR uploads them.">
      {d.loading && !d.data ? <Loading rows={3} /> : <ErrorBox error={d.error} retry={d.reload} />}
      <ErrorBox error={err} />
      {d.data && (d.data.length === 0 ? <Empty>No salary slips yet.</Empty> :
        <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Month</th><th className="num">Net pay</th><th /></tr></thead>
          <tbody>{d.data.map((s) => <tr key={s.month}><td><b>{monthName(s.month)}</b></td><td className="num">{money(s.net)}</td>
            <td><button className="btn sm" disabled={busy === s.month} onClick={() => get(s.month)}>{busy === s.month ? 'Preparing…' : 'Download PDF'}</button></td></tr>)}</tbody></table></div>)}
    </Card>
  );
}
