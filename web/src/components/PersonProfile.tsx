import { useState } from 'react';
import { Me, rpc } from '../lib/api';
import { label, time } from '../lib/format';
import { formatId } from '../lib/ocrParse';
import { DOC_TYPES, openDocument } from './Documents';
import { IdScan } from './IdScan';
import { Card, ErrorBox, Loading, useLoad } from './ui';
import { AppUsage, DataIssueList } from './DataIssues';

const DOC = Object.fromEntries(DOC_TYPES);
const SRC: Record<string, [string, string]> = { scan: ['ok', 'read from the document'], edited: ['warn', 'typed by the person after the scan'], hr: ['ok', 'checked by HR'] };

/** The full profile of a person (D-89): contact, personal details, addresses, emergency contact, ID and bank details,
 *  documents and completion. HR / Admin / the person see full ID numbers; managers see them masked. Salary is not here (D-90). */
export function PersonProfile({ personId, hr, onChange }: { me?: Me; personId: string; hr?: boolean; onChange?: () => void }) {
  const d = useLoad(() => rpc<any>('person_profile', { p_person: personId }), [personId]);
  const docs = useLoad(() => (hr ? rpc<any[]>('scannable_documents', { p_person: personId }) : Promise.resolve([])), [personId, hr]);
  const [scan, setScan] = useState<'aadhaar' | 'pan' | 'bank' | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const reload = () => { d.reload(); docs.reload(); onChange?.(); };
  if (d.loading) return <Loading rows={4} />;
  if (d.error) return <ErrorBox error={d.error} retry={d.reload} />;
  const x = d.data, p = x.person ?? {}, h = x.profile ?? {}, i = x.identity ?? {}, pr = x.progress ?? {};
  const F = (l: string, v: unknown) => <div><span className="muted small">{l}</span><div>{v == null || v === '' ? <span className="muted">—</span> : String(v)}</div></div>;
  const src = (s?: string) => s && SRC[s] ? <span className={`pill ${SRC[s][0]} small`}>{SRC[s][1]}</span> : null;
  const DOCOF: Record<string, string[]> = { aadhaar: ['aadhaar'], pan: ['pan'], bank: ['bank', 'cancelled_cheque'] };
  const latest = (k: string) => ((x?.documents ?? []) as any[]).find((z) => DOCOF[k].includes(z.doc_type) && !z.rejected) ?? null;
  /** HR: check the number against the document, then confirm it or correct it from the document (D-101). */
  const check = (k: 'aadhaar' | 'pan' | 'bank', s?: string, has?: boolean) => !hr || !has ? null : (
    <div className="verify-row">
      {latest(k)?.path && <button className="btn sm" onClick={() => openDocument(latest(k).path).catch(setErr)}>Open document</button>}
      {s !== 'hr' && <button className="btn sm primary" onClick={() => rpc('confirm_identity', { p_person: personId, p_kind: k }).then(reload, setErr)}>It matches</button>}
      <button className={`btn sm${scan === k ? ' gold' : ''}`} onClick={() => setScan(scan === k ? null : k)}>{scan === k ? 'Close' : 'Correct it'}</button>
    </div>);
  const ex = (t: string[]) => ((docs.data ?? []) as any[]).find((z) => t.includes(z.doc_type)) ?? null;
  return (
    <div className="stack">
      <Card title={`${p.full_name ?? ''} — profile ${pr.pct ?? 0}% complete`}>
        {pr.missing?.length > 0 && <div className="banner warn small">Still needed: {pr.missing.join(' · ')}{pr.blocking ? ' — the app is locked for them until done.' : ` — due ${new Date(pr.due_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}.`}</div>}
        <h3 className="small muted" style={{ margin: '8px 0 4px' }}>Work</h3>
        <div className="grid two">
          {F('Designation', p.designation)}{F('Type', p.resource_type === 'partner' ? 'Partner / BA' : 'CRUX employee')}{F('Status', label(p.status ?? ''))}
          {F('Reports to', (x.managers ?? []).map((m: any) => `${m.name} (${label(m.function)})`).join(', '))}{F('Joining / association date', h.joining_date ?? p.joined_on)}
          {p.resource_type === 'partner' && F('Firm name', h.firm_name)}
        </div>
        <h3 className="small muted" style={{ margin: '12px 0 4px' }}>Contact and personal</h3>
        <div className="grid two">
          {F('Mobile', p.mobile)}{F('Email', p.email)}{F('Date of birth', h.date_of_birth)}{F('Gender', h.gender ? label(h.gender) : null)}
          {F('Highest qualification', h.highest_qualification)}{F('City · state · PIN', [h.city, h.state, h.pincode].filter(Boolean).join(' · '))}
          <div style={{ gridColumn: '1 / -1' }}>{F('Current address', h.current_address)}</div>
          <div style={{ gridColumn: '1 / -1' }}>{F('Permanent address', h.permanent_address)}</div>
        </div>
        <h3 className="small muted" style={{ margin: '12px 0 4px' }}>Emergency contact</h3>
        <div className="grid two">{F('Name', h.emergency_name)}{F('Relation', h.emergency_relation)}{F('Mobile', h.emergency_phone)}</div>
        <h3 className="small muted" style={{ margin: '12px 0 4px' }}>ID and bank {x.full_ids ? '' : <span className="pill neutral small">masked — full numbers: HR / Admin only</span>}</h3>
        <div className="grid two">
          <div>{F('Aadhaar', i.aadhaar ? formatId('aadhaar', i.aadhaar) : null)}{i.aadhaar_name && <div className="small muted">name on card: {i.aadhaar_name}</div>}{src(i.aadhaar_source)}{check('aadhaar', i.aadhaar_source, !!i.aadhaar)}</div>
          <div>{F('PAN', i.pan)}{i.pan_name && <div className="small muted">name on card: {i.pan_name}</div>}{src(i.pan_source)}{check('pan', i.pan_source, !!i.pan)}</div>
          <div>{F('Bank account', i.bank_account)}{i.bank_holder && <div className="small muted">name: {i.bank_holder}</div>}{src(i.bank_source)}{check('bank', i.bank_source, !!i.bank_account)}</div>
          <div>{F('IFSC · bank', [i.bank_ifsc ?? h.bank_ifsc, i.bank_name ?? h.bank_name].filter(Boolean).join(' · '))}</div>
        </div>
        {hr && scan && <IdScan key={scan} personId={personId} kind={scan} existing={ex(scan === 'bank' ? ['bank', 'cancelled_cheque'] : [scan])} onSaved={() => { setScan(null); reload(); }} />}
        {hr && (!i.aadhaar || !i.pan || !i.bank_account) && <div className="row" style={{ marginTop: 8 }}>
          <span className="small muted">Not recorded yet — read it from the uploaded document:</span>
          {(['aadhaar', 'pan', 'bank'] as const).filter((k) => !(k === 'aadhaar' ? i.aadhaar : k === 'pan' ? i.pan : i.bank_account)).map((k) =>
            <button key={k} className={`btn sm${scan === k ? ' primary' : ''}`} onClick={() => setScan(scan === k ? null : k)}>{k === 'bank' ? 'Bank' : k === 'pan' ? 'PAN' : 'Aadhaar'}</button>)}</div>}
        <ErrorBox error={err} />
        <h3 className="small muted" style={{ margin: '12px 0 4px' }}>Documents</h3>
        {(x.documents ?? []).length === 0 ? <div className="muted small">Nothing uploaded.</div> : <DocList docs={x.documents} hr={!!hr} onChange={reload} onError={setErr} />}
      </Card>
      {hr && <Card title="Data check"><DataIssueList issues={(x.issues ?? []) as any} /></Card>}
      {hr && <Card title="App usage"><AppUsage personId={personId} /></Card>}
    </div>
  );
}

/** Documents grouped by type: the latest upload with its status and actions; earlier uploads folded away (D-101). */
function DocList({ docs, hr, onChange, onError }: { docs: any[]; hr: boolean; onChange: () => void; onError: (e: unknown) => void }) {
  const [more, setMore] = useState<string | null>(null);
  const [rej, setRej] = useState<{ id: string; note: string } | null>(null);
  const groups = docs.reduce((m: Record<string, any[]>, z) => { (m[z.doc_type] ??= []).push(z); return m; }, {});
  const order = Object.keys(groups).sort((a, b) => Number(groups[a][0].verified || groups[a][0].rejected) - Number(groups[b][0].verified || groups[b][0].rejected));
  const verify = (id: string, ok: boolean, note?: string) => rpc('verify_document', { p_id: id, p_ok: ok, p_note: note ?? null }).then(() => { setRej(null); onChange(); }, onError);
  const status = (z: any) => z.rejected ? <span className="pill bad small">not accepted{z.note ? ` — ${z.note}` : ''}</span> : z.verified ? <span className="pill ok small">verified</span> : <span className="pill warn small">waiting for HR</span>;
  const line = (z: any, top: boolean) => (
    <div className={`docline${top ? '' : ' older'}`} key={z.id ?? z.uploaded_at}>
      <div className="docmain"><b>{top ? (DOC[z.doc_type] ?? z.doc_type) : 'Earlier upload'}</b><span className="small muted"> · {z.file_name ? `${z.file_name} · ` : ''}{time(z.uploaded_at)}</span><div>{status(z)}</div></div>
      <div className="row" style={{ gap: 6 }}>
        {z.path && <button className="btn sm" onClick={() => openDocument(z.path).catch(onError)}>Open</button>}
        {hr && z.id && !z.verified && !z.rejected && <><button className="btn sm primary" onClick={() => verify(z.id, true)}>Verify</button>
          <button className="btn sm" onClick={() => setRej({ id: z.id, note: '' })}>Not accepted</button></>}
      </div>
      {rej && rej.id === z.id && <form className="row" style={{ flexBasis: '100%' }} onSubmit={(e) => { e.preventDefault(); if (rej.note.trim()) verify(z.id, false, rej.note.trim()); }}>
        <input autoFocus aria-label="What is wrong" placeholder="What is wrong? The person is told, e.g. photo is blurred" value={rej.note} onChange={(e) => setRej({ id: z.id, note: e.target.value })} style={{ flex: 1, minWidth: 200 }} />
        <button className="btn sm danger" disabled={!rej.note.trim()}>Send back</button><button type="button" className="btn sm" onClick={() => setRej(null)}>Cancel</button></form>}
    </div>);
  return (
    <div className="doclist">{order.map((k) => { const g = groups[k]; return (
      <div key={k}>
        {line(g[0], true)}
        {g.length > 1 && <button className="linklike small" aria-expanded={more === k} onClick={() => setMore(more === k ? null : k)}>{more === k ? 'Hide' : 'Show'} {g.length - 1} earlier upload{g.length > 2 ? 's' : ''}</button>}
        {more === k && g.slice(1).map((z) => line(z, false))}
      </div>); })}</div>
  );
}
