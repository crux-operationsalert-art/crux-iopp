import { useEffect, useRef, useState } from 'react';
import { rpc } from '../lib/api';
import { formatId, Kind, KIND_NAME, Parsed } from '../lib/ocrParse';
import { NeedPassword, scanDocument } from '../lib/ocr';
import { fetchDocument, uploadDocument } from './Documents';
import { Card, ErrorBox } from './ui';

const TITLE: Record<Kind, string> = { aadhaar: 'Aadhaar card', pan: 'PAN card', bank: 'Bank proof — cancelled cheque or passbook' };
const TIP: Record<Kind, string> = {
  aadhaar: 'Photo of the front (with the 12-digit number), or the e-Aadhaar PDF. Not the masked one. Add the back too if your address is not on the front.',
  pan: 'Photo of the front of the PAN card, or the e-PAN PDF.',
  bank: 'A cancelled cheque or the first page of your passbook, showing the account number and IFSC. The account must be in your name.',
};
type Existing = { id: string; storage_path: string; mime: string | null; file_name: string };
type Stage = { s: 'idle' } | { s: 'reading'; p: number; label: string } | { s: 'password'; file: Blob; wrong: boolean; fromDoc?: string }
  | { s: 'found'; parsed: Parsed; file?: File; docId?: string } | { s: 'problem'; message: string; retake?: boolean } | { s: 'saved'; number: string };

/** Scan one ID document: read it on the phone, show what was read, save only after the person confirms.
 *  `existing` = a document already uploaded (read it instead of asking for a new one). HR mode records for someone else. */
export function IdScan({ personId, kind, existing, done, autoStart, onSaved }:
  { personId: string; kind: Kind; existing?: Existing | null; done?: string | null; autoStart?: boolean; onSaved: (progress?: any) => void }) {
  const [st, setSt] = useState<Stage>(done ? { s: 'saved', number: done } : { s: 'idle' });
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  const [pick, setPick] = useState<string>('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const progress = (p: number, label: string) => setSt({ s: 'reading', p, label });

  async function read(file: Blob, opts: { upload?: File; docId?: string; password?: string } = {}) {
    setErr(null); setEdit(null); setPick('');
    try {
      const r = await scanDocument(file, kind, progress, opts.password);
      if (r.check.ok) setSt({ s: 'found', parsed: r.parsed, file: opts.upload, docId: opts.docId });
      else setSt({ s: 'problem', message: (opts.docId ? 'The document uploaded earlier: ' : '') + r.check.message, retake: r.check.retake });
    } catch (e) {
      if (e instanceof NeedPassword) setSt({ s: 'password', file, wrong: e.wrong, fromDoc: opts.docId });
      else setSt({ s: 'problem', message: (e as Error).message });
    }
  }
  async function readExisting() {
    if (!existing) return;
    progress(0, 'Opening the document you uploaded');
    try { const b = await fetchDocument(existing.storage_path); await read(new Blob([b], { type: existing.mime || b.type }), { docId: existing.id }); }
    catch (e) { setSt({ s: 'problem', message: (e as Error).message }); }
  }
  useEffect(() => { if (autoStart && existing && !done && !started.current) { started.current = true; readExisting(); } }, [autoStart, existing?.id]);   // eslint-disable-line

  async function save(p: Parsed, file?: File, docId?: string) {
    setBusy(true); setErr(null);
    try {
      const v = edit ?? {};
      const number = (v.number ?? (pick || p.number) ?? '').trim();
      const id = docId ?? (file ? await uploadDocument(personId, kind, file) : undefined);
      const res = await rpc('save_identity', { p_person: personId, p: { kind, doc_id: id, number, name: v.name ?? p.name, dob: p.dob, gender: p.gender, address: p.address, pincode: p.pincode,
        ifsc: v.ifsc ?? p.ifsc, bank_name: v.bank_name ?? p.bank_name, edited: !!edit && (number !== (pick || p.number) || (v.ifsc ?? p.ifsc) !== p.ifsc) } });
      setSt({ s: 'saved', number: formatId(kind, number.replace(/\s/g, '').toUpperCase()) }); onSaved(res);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }

  const fileInput = <label className="btn primary" style={{ cursor: 'pointer' }}>{existing ? 'Upload a new one' : `Upload ${KIND_NAME[kind] === TITLE[kind] ? TITLE[kind] : 'photo or PDF'}`}
    <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) read(f, { upload: f }); }} /></label>;

  return (
    <Card title={<span>{TITLE[kind]} {st.s === 'saved' && <span className="pill ok small">Done</span>}</span> as any}>
      <div className="stack">
        {st.s === 'saved' && <div className="row"><span>Recorded: <b>{st.number}</b></span><span className="spacer" />
          <button className="btn sm" onClick={() => setSt({ s: 'idle' })}>Scan again</button></div>}
        {st.s === 'idle' && <>
          <p className="small muted">{TIP[kind]}</p>
          <div className="row">{fileInput}{existing && <button className="btn" onClick={readExisting}>Read the one already uploaded ({existing.file_name})</button>}</div>
        </>}
        {st.s === 'reading' && <div role="status" aria-live="polite"><div className="small">{st.label}…</div>
          <div className="bar" style={{ height: 8, background: 'var(--border)', borderRadius: 4, marginTop: 6 }}><div style={{ width: `${Math.round(st.p * 100)}%`, height: '100%', background: 'var(--accent, #1f6feb)', borderRadius: 4 }} /></div>
          <div className="small muted" style={{ marginTop: 4 }}>Reading happens on this phone. The first time it downloads the reader (about 7 MB).</div></div>}
        {st.s === 'password' && <form className="stack" onSubmit={(e) => { e.preventDefault(); read(st.file, { docId: st.fromDoc, upload: st.fromDoc ? undefined : st.file as File, password: pw }); }}>
          <div className={`banner ${st.wrong ? 'bad' : 'info'}`}>{st.wrong ? 'That password did not open the PDF.' : 'This PDF has a password.'} For e-Aadhaar it is the first 4 letters of your name in CAPITALS followed by your year of birth (e.g. RAVI1991).</div>
          <div className="row"><input value={pw} onChange={(e) => setPw(e.target.value)} placeholder="PDF password" aria-label="PDF password" style={{ maxWidth: 220 }} autoComplete="off" />
            <button className="btn primary">Open</button><button type="button" className="btn" onClick={() => setSt({ s: 'idle' })}>Cancel</button></div></form>}
        {st.s === 'problem' && <>
          <div className="banner bad" role="alert">{st.message}</div>
          <div className="row">{fileInput}{existing && st.retake && <button className="btn" onClick={readExisting}>Try reading it again</button>}</div>
        </>}
        {st.s === 'found' && (() => { const p = st.parsed; const cands = p.candidates ?? []; const num = edit?.number ?? (pick || p.number);
          return <>
            <div className="banner ok">We read this from your {KIND_NAME[kind]}. Check it and confirm.</div>
            <div className="grid two">
              {!edit ? <>
                <div><span className="muted small">{kind === 'bank' ? 'Account number' : `${KIND_NAME[kind]} number`}</span><div style={{ fontSize: '1.2rem', letterSpacing: '.04em' }}><b>{formatId(kind, num) || '—'}</b></div>
                  {kind === 'bank' && !p.number && cands.length > 1 && <div className="stack small" style={{ marginTop: 6 }}><span>More than one number is printed. Tap your account number:</span>
                    <div className="row">{cands.map((c) => <button key={c} type="button" className={`btn sm${pick === c ? ' primary' : ''}`} onClick={() => setPick(c)}>{c}</button>)}</div></div>}</div>
                {p.name && <div><span className="muted small">Name on it</span><div>{p.name}</div></div>}
                {kind === 'bank' && <div><span className="muted small">IFSC · bank</span><div>{p.ifsc} · {p.bank_name ?? 'bank not recognised'}</div></div>}
                {p.dob && <div><span className="muted small">Date of birth</span><div>{p.dob}</div></div>}
                {p.address && <div style={{ gridColumn: '1 / -1' }}><span className="muted small">Address (filled into your profile if empty)</span><div className="small">{p.address}</div></div>}
              </> : <>
                <label className="field">{kind === 'bank' ? 'Account number' : 'Number'}<input value={edit.number ?? ''} onChange={(e) => setEdit({ ...edit, number: e.target.value })} inputMode={kind === 'pan' ? 'text' : 'numeric'} /></label>
                {kind === 'bank' && <label className="field">IFSC<input value={edit.ifsc ?? ''} onChange={(e) => setEdit({ ...edit, ifsc: e.target.value.toUpperCase() })} maxLength={11} /></label>}
                <label className="field">Name on it<input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
                <p className="small muted" style={{ gridColumn: '1 / -1' }}>Corrections are checked by HR against the document.</p>
              </>}
            </div>
            <ErrorBox error={err} />
            <div className="row">
              <button className="btn primary" disabled={busy || !num} onClick={() => save(p, st.file, st.docId)}>{busy ? 'Saving…' : 'Correct — save'}</button>
              {!edit && <button className="btn" onClick={() => setEdit({ number: num ?? '', name: p.name ?? '', ifsc: p.ifsc ?? '' })}>Something is wrong</button>}
              <button className="btn" onClick={() => setSt({ s: 'idle' })}>Scan another</button>
            </div></>; })()}
      </div>
    </Card>
  );
}
