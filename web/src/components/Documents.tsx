import { useState } from 'react';
import { Me, rpc, sb, select } from '../lib/api';
import { time } from '../lib/format';
import { Card, Empty, ErrorBox, Loading, useLoad } from './ui';

export const DOC_TYPES: [string, string][] = [
  ['aadhaar', 'Aadhaar'], ['pan', 'PAN'], ['address_proof', 'Address proof'], ['qualification', 'Qualification'], ['bank', 'Bank proof (cancelled cheque / passbook)'],
  ['photo', 'Photo'], ['police_verification', 'Police verification certificate'], ['agreement', 'Signed agreement / offer'], ['kyc_other', 'Other KYC'], ['other', 'Other'],
];
const NAME = Object.fromEntries(DOC_TYPES);
const BUCKET = 'hr-docs';
const MAX = 10 * 1024 * 1024;

type Doc = { id: string; doc_type: string; file_name: string; storage_path: string; uploaded_at: string; verified_at: string | null; rejected: boolean; note: string | null };

/** Upload and open private HR documents. Files go to a private bucket; links are signed for one minute. */
export function Documents({ me, personId, title = 'Documents', types, hr }: { me: Me; personId: string; title?: string; types?: string[]; hr?: boolean }) {
  const allowed = types ?? DOC_TYPES.map(([k]) => k);
  const d = useLoad(() => select<Doc>('person_documents', 'id,doc_type,file_name,storage_path,uploaded_at,verified_at,rejected,note',
    (b) => b.eq('person_id', personId).in('doc_type', allowed).order('uploaded_at', { ascending: false })), [personId, allowed.join()]);
  const [type, setType] = useState(allowed[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [ok, setOk] = useState('');
  async function upload(f: File | undefined) {
    if (!f) return;
    setErr(null); setOk('');
    if (f.size > MAX) { setErr(new Error('The file is larger than 10 MB. Take a smaller photo or scan.')); return; }
    if (!/^(application\/pdf|image\/(jpeg|png|webp|heic))$/.test(f.type)) { setErr(new Error('Upload a PDF or a photo (JPG, PNG, WEBP, HEIC).')); return; }
    setBusy(true);
    try {
      const safe = f.name.replace(/[^\w.\-]+/g, '_').slice(-80);
      const path = `${personId}/${type}/${crypto.randomUUID()}-${safe}`;
      const { error } = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type, upsert: false });
      if (error) throw error;
      await rpc('register_document', { p_person: personId, p_type: type, p_path: path, p_file_name: f.name, p_mime: f.type, p_size: f.size });
      setOk(`${NAME[type]} uploaded${personId === me.person_id ? '. HR will verify it.' : '.'}`); d.reload();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  async function open(doc: Doc) {
    setErr(null);
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(doc.storage_path, 60);
    if (error || !data) { setErr(error ?? new Error('Could not open the file.')); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  }
  async function verify(doc: Doc, good: boolean) {
    const note = good ? null : window.prompt('What is wrong? (the person is told)');
    if (!good && !note) return;
    try { await rpc('verify_document', { p_id: doc.id, p_ok: good, p_note: note }); d.reload(); } catch (e) { setErr(e); }
  }
  return (
    <Card title={title}>
      <div className="stack">
        <div className="row" style={{ alignItems: 'end' }}>
          {allowed.length > 1 && <label className="field">Document<select value={type} onChange={(e) => setType(e.target.value)}>{allowed.map((k) => <option key={k} value={k}>{NAME[k]}</option>)}</select></label>}
          <label className="btn primary" style={{ cursor: busy ? 'wait' : 'pointer' }}>{busy ? 'Uploading…' : `Upload ${allowed.length > 1 ? '' : NAME[allowed[0]]}`}
            <input type="file" accept="application/pdf,image/*" hidden disabled={busy} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} /></label>
        </div>
        <ErrorBox error={err} />{ok && <div className="banner ok" role="status">{ok}</div>}
        {d.loading ? <Loading rows={2} /> : <ErrorBox error={d.error} retry={d.reload} />}
        {d.data && (d.data.length === 0 ? <Empty>Nothing uploaded yet.</Empty> :
          <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Document</th><th>File</th><th>Uploaded</th><th>Status</th><th /></tr></thead>
            <tbody>{d.data.map((x) => <tr key={x.id}><td>{NAME[x.doc_type] ?? x.doc_type}</td><td className="small">{x.file_name}</td><td className="small">{time(x.uploaded_at)}</td>
              <td>{x.rejected ? <span className="pill bad" title={x.note ?? ''}>Not accepted{x.note ? ` — ${x.note}` : ''}</span> : x.verified_at ? <span className="pill ok">Verified</span> : <span className="pill warn">Waiting for HR</span>}</td>
              <td className="row"><button className="btn sm" onClick={() => open(x)}>Open</button>
                {hr && !x.verified_at && <><button className="btn sm" onClick={() => verify(x, true)}>Verify</button><button className="btn sm" onClick={() => verify(x, false)}>Reject</button></>}</td></tr>)}</tbody></table></div>)}
        <p className="small muted">Private: only you, HR and Admin can open these{allowed.includes('police_verification') ? ' (your managers can open the police verification certificate)' : ''}. Do not type full Aadhaar, PAN or account numbers anywhere else.</p>
      </div>
    </Card>
  );
}

type PV = { person_id: string; full_name: string; designation: string | null; manager: string | null; status: string; applied_on: string | null; verified_on: string | null;
  reference: string | null; due: string; overdue_days: number; docs: number };
const PST: Record<string, [string, string]> = { not_started: ['bad', 'Not started'], applied: ['warn', 'Applied'], verified: ['ok', 'Verified'], failed: ['bad', 'Failed'], not_required: ['info', 'Not required'] };

/** Police verification for everyone under me (managers) or everyone (HR). Compulsory; overdue alarms climb up the line weekly. */
export function PoliceVerification({ me, all }: { me: Me; all?: boolean }) {
  const d = useLoad(() => rpc<PV[]>('police_status', { p_scope: all ? 'all' : 'team' }), [all]);
  const [ed, setEd] = useState<PV | null>(null);
  const rows = ((d.data ?? []) as PV[]).filter((r) => all || r.person_id !== me.person_id);
  const open = rows.filter((r) => !['verified', 'not_required'].includes(r.status));
  const hrUser = me.roles.includes('hr_admin') || me.roles.includes('admin');
  return (
    <div className="stack">
      <Card title={`Police verification — ${rows.length - open.length} of ${rows.length} done${open.some((r) => r.overdue_days > 0) ? ` · ${open.filter((r) => r.overdue_days > 0).length} overdue` : ''}`}>
        <p className="small muted">Compulsory for everyone. Record the status and upload the certificate. When it is overdue, alarms go one level higher every week until it reaches the top, and HR is told.</p>
        {d.loading ? <Loading rows={3} /> : <ErrorBox error={d.error} retry={d.reload} />}
        {d.data && (rows.length === 0 ? <Empty>Nobody under you.</Empty> :
          <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Person</th><th>Status</th><th>Due</th><th className="num">Papers</th><th /></tr></thead>
            <tbody>{rows.map((r) => { const [tone, txt] = PST[r.status] ?? ['neutral', r.status]; return (
              <tr key={r.person_id}><td><b>{r.full_name}</b><div className="small muted">{r.designation ?? ''}{r.manager ? ` · reports to ${r.manager}` : ''}</div></td>
                <td><span className={`pill ${tone}`}>{txt}</span>{r.applied_on && <div className="small muted">applied {r.applied_on}{r.reference ? ` · ${r.reference}` : ''}</div>}</td>
                <td>{['verified', 'not_required'].includes(r.status) ? (r.verified_on ?? '—') : r.overdue_days > 0 ? <span className="pill bad">{r.overdue_days} days overdue</span> : r.due}</td>
                <td className="num">{r.docs}</td>
                <td><button className="btn sm" onClick={() => setEd(ed?.person_id === r.person_id ? null : r)}>{ed?.person_id === r.person_id ? 'Close' : 'Update'}</button></td></tr>); })}</tbody></table></div>)}
      </Card>
      {ed && <PvEditor me={me} r={ed} hr={hrUser} onDone={() => { d.reload(); }} />}
    </div>
  );
}

function PvEditor({ me, r, hr, onDone }: { me: Me; r: PV; hr: boolean; onDone: () => void }) {
  const [f, setF] = useState({ status: r.status === 'not_started' ? 'applied' : r.status, applied: r.applied_on ?? '', verified: r.verified_on ?? me.today, ref: r.reference ?? '', note: '' });
  const [err, setErr] = useState<unknown>(null);
  const [ok, setOk] = useState('');
  return (
    <div className="stack">
      <Card title={`Police verification · ${r.full_name}`}>
        <div className="grid two">
          <label className="field">Status<select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="not_started">Not started</option><option value="applied">Applied</option><option value="verified">Verified (certificate uploaded)</option><option value="failed">Failed / adverse</option>
            {hr && <option value="not_required">Not required (HR)</option>}</select></label>
          <label className="field">Applied on<input type="date" max={me.today} value={f.applied} onChange={(e) => setF({ ...f, applied: e.target.value })} /></label>
          {f.status === 'verified' && <label className="field">Verified on<input type="date" max={me.today} value={f.verified} onChange={(e) => setF({ ...f, verified: e.target.value })} /></label>}
          <label className="field">Application / certificate number<input value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} /></label>
          <label className="field">Note{f.status === 'not_required' ? ' (reason — required)' : ''}<input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
        </div>
        <ErrorBox error={err} />{ok && <div className="banner ok" role="status">{ok}</div>}
        <button className="btn primary" onClick={async () => {
          setErr(null); setOk('');
          try { await rpc('set_police_verification', { p_person: r.person_id, p_status: f.status, p_applied_on: f.applied || null, p_verified_on: f.status === 'verified' ? f.verified : null,
            p_reference: f.ref || null, p_note: f.note || null }); setOk('Saved. HR has been told.'); onDone(); } catch (e) { setErr(e); }
        }}>Save</button>
      </Card>
      <Documents me={me} personId={r.person_id} title={`Certificate · ${r.full_name}`} types={['police_verification']} hr={hr} />
    </div>
  );
}
