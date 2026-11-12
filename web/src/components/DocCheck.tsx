import { useEffect, useMemo, useRef, useState } from 'react';
import { rpc } from '../lib/api';
import { time } from '../lib/format';
import { formatId, Kind } from '../lib/ocrParse';
import { DOC_TYPES, fetchDocument, openDocument, uploadDocument } from './Documents';
import { Card, ErrorBox, Loading, useLoad } from './ui';

type Item = {
  person_id: string; full_name: string; designation: string | null; kind: string; state: 'no_details' | 'to_check' | 'done';
  doc: { id: string; path: string; mime: string | null; file_name: string; uploaded_at: string; verified: boolean; uploads: number } | null;
  number: string | null; name_on: string | null; source: string | null; ifsc: string | null; bank_name: string | null; dob: string | null; gender: string | null;
};
const DOC = Object.fromEntries(DOC_TYPES);
const ID = ['aadhaar', 'pan', 'bank'];
const STATE: Record<Item['state'], [string, string]> = { no_details: ['bad', 'Details not recorded'], to_check: ['warn', 'To compare'], done: ['ok', 'Checked'] };
const SRC: Record<string, string> = { scan: 'read from the document by the person\'s phone', edited: 'typed by the person', hr: 'checked by HR' };
const key = (x: Item) => `${x.person_id}:${x.kind}`;
const words = (s: string) => s.toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((w) => w.length > 1);
/** Same person? Every word of the shorter name appears in the longer one (order and initials ignored). */
const sameName = (a: string, b: string) => { const x = words(a), y = words(b); const [s, l] = x.length <= y.length ? [x, y] : [y, x]; return s.length > 0 && s.every((w) => l.includes(w)); };

/** HR document check (D-126): the uploaded document on one side, the details recorded from it on the other. */
export function DocCheck() {
  const d = useLoad(() => rpc<Item[]>('doc_check_queue'), []);
  const [tab, setTab] = useState<Item['state']>('no_details');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const all = d.data ?? [];
  const n = (s: Item['state']) => all.filter((x) => x.state === s).length;
  const rows = useMemo(() => all.filter((x) => x.state === tab && `${x.full_name} ${x.designation ?? ''} ${DOC[x.kind] ?? x.kind}`.toLowerCase().includes(q.toLowerCase())), [all, tab, q]);
  useEffect(() => { if (d.data && !n('no_details') && tab === 'no_details' && n('to_check')) setTab('to_check'); }, [d.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const cur = rows.find((x) => key(x) === sel) ?? null;

  // Read every waiting upload in one go (D-127). The reader runs in this browser; what it reads with certainty is saved as
  // "read from the document" and moves to "To compare" — a person in HR still confirms each one against the image.
  const [bulk, setBulk] = useState<{ i: number; n: number; label: string } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [sum, setSum] = useState<string | null>(null);
  const stop = useRef(false);
  const waiting = all.filter((x) => x.state === 'no_details' && x.doc && ID.includes(x.kind));
  async function readAll() {
    stop.current = false; setSum(null); setSel(null);
    const { scanDocument, NeedPassword, prepareImage, preparedFile } = await import('../lib/ocr');
    const nt: Record<string, string> = {}; let ok = 0, i = 0, fixed = 0;
    for (const x of waiting) {
      if (stop.current) break;
      i++; setBulk({ i, n: waiting.length, label: `${x.full_name} — ${DOC[x.kind] ?? x.kind}` });
      try {
        const b = await fetchDocument(x.doc!.path);
        let img: Blob = new Blob([b], { type: x.doc!.mime || b.type }); let docId = x.doc!.id;
        // first put the picture right (upright, straight, cropped to the document) and keep that as the current upload
        try { const pr = await prepareImage(img, { crop: true });
          if (pr.changed) { const file = preparedFile(pr, x.doc!.file_name, true); docId = await uploadDocument(x.person_id, x.kind, file); img = file; fixed++; } } catch { /* read it as it is */ }
        const r = await scanDocument(img, x.kind as Kind);
        const p = r.parsed;
        if (!r.check.ok || !p.number || (x.kind === 'bank' && !p.ifsc)) { nt[key(x)] = r.check.ok ? 'The number could not be read.' : r.check.message; continue; }
        await rpc('save_identity', { p_person: x.person_id, p: { kind: x.kind, doc_id: docId, number: p.number, name: p.name, dob: p.dob, gender: p.gender,
          address: p.address, pincode: p.pincode, ifsc: p.ifsc, bank_name: p.bank_name, auto: true } });
        ok++;
      } catch (e) { nt[key(x)] = e instanceof NeedPassword ? 'The PDF has a password. Open it and type the details.' : (e as Error).message || 'Could not be read.'; }
      setNotes({ ...nt });
    }
    setBulk(null); setNotes(nt);
    const left = Object.keys(nt).length;
    setSum(`${fixed ? `${fixed} picture${fixed === 1 ? '' : 's'} turned, straightened or cropped and saved. ` : ''}${ok} read and moved to “To compare”${left ? `; ${left} could not be read with certainty and ${left === 1 ? 'is' : 'are'} still here to type from the image` : ''}${stop.current ? ' (stopped early)' : ''}.`);
    d.reload();
  }
  const next = () => { const i = rows.findIndex((x) => key(x) === sel); const nx = rows[i + 1] ?? rows[i - 1]; setSel(nx ? key(nx) : null); d.reload(); };

  if (d.loading && !d.data) return <Loading rows={5} />;
  if (d.error) return <ErrorBox error={d.error} retry={d.reload} />;
  return (
    <div className="stack">
      <Card title="Document check" help="Every uploaded document next to the details recorded from it. Compare the two, correct anything that differs, then mark it checked. If the file is wrong or unreadable, send it back and the person is told why.">
        <div className="stack">
          <div className="segbtns" role="tablist" aria-label="Which documents">
            {(['no_details', 'to_check', 'done'] as const).map((s) => <button key={s} role="tab" aria-selected={tab === s} className={`btn sm${tab === s ? ' primary' : ''}`} onClick={() => { setTab(s); setSel(null); }}>{STATE[s][1]} <span className="small muted">{n(s)}</span></button>)}
            <span className="spacer" />
            <input placeholder="Search name or document…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" style={{ maxWidth: 240 }} />
          </div>
          <div className="small muted">{tab === 'no_details' ? 'The file was uploaded but no number was recorded with it. Open one, read the details off the image and type them in.'
            : tab === 'to_check' ? 'Details are recorded but nobody in HR has compared them with the document yet.' : 'Compared with the document and confirmed by HR.'}</div>
          {tab === 'no_details' && (bulk
            ? <div role="status" aria-live="polite" className="stack" style={{ gap: 6 }}>
                <div className="row"><span className="small">Reading {bulk.i} of {bulk.n}: <b>{bulk.label}</b></span><span className="spacer" /><button className="btn sm" onClick={() => { stop.current = true; }}>Stop</button></div>
                <div style={{ height: 8, background: 'var(--border)', borderRadius: 4 }}><div style={{ width: `${Math.round(((bulk.i - 1) / bulk.n) * 100)}%`, height: '100%', background: 'var(--accent, #1f6feb)', borderRadius: 4 }} /></div>
                <div className="small muted">Keep this page open. Reading happens on this computer; each document takes up to a minute.</div></div>
            : waiting.length > 0 && <div className="row">
                <button className="btn primary" onClick={readAll}>Read all {waiting.length} from their images</button>
                <span className="small muted">Each picture is first turned upright, straightened and cropped to the document, and saved that way. Then what the reader is certain of is filled in and waits under “To compare” for you to confirm against the image.</span></div>)}
          {sum && <div className="banner info small" role="status">{sum}</div>}
        </div>
      </Card>
      <div className="doccheck">
        <div className="doccheck-list" role="list" aria-label="Documents">
          {rows.length === 0 && <div className="muted small" style={{ padding: 12 }}>{q ? 'Nothing matches the search.' : tab === 'done' ? 'Nothing has been checked yet.' : 'Nothing waiting here.'}</div>}
          {rows.map((x) => <button key={key(x)} role="listitem" className={`doccheck-row${sel === key(x) ? ' on' : ''}`} aria-current={sel === key(x)} onClick={() => setSel(key(x))}>
            <b>{x.full_name}</b><span className="small muted">{x.designation ?? ''}</span>
            <span className="small">{DOC[x.kind] ?? x.kind}{x.doc && x.doc.uploads > 1 ? ` · ${x.doc.uploads} uploads` : ''}{!x.doc ? ' · no file' : ''}</span>
            {notes[key(x)] && x.state === 'no_details' && <span className="small" style={{ color: 'var(--warn)' }}>{notes[key(x)]}</span>}
          </button>)}
        </div>
        <div className="doccheck-main">
          {cur ? <Check key={key(cur)} x={cur} onDone={next} onReload={d.reload} /> : <div className="card muted" style={{ padding: 24 }}>{rows.length ? 'Pick a document from the list to compare it with its details.' : 'Nothing to show.'}</div>}
        </div>
      </div>
    </div>
  );
}

function Check({ x, onDone, onReload }: { x: Item; onDone: () => void; onReload: () => void }) {
  const isId = ID.includes(x.kind);
  const [f, setF] = useState({ number: x.number ? formatId(x.kind as Kind, x.number) : '', name: x.name_on ?? '', dob: x.kind === 'aadhaar' ? x.dob ?? '' : '', ifsc: x.ifsc ?? '', bank_name: x.bank_name ?? '' });
  const [url, setUrl] = useState<string | null>(null); const blob = useRef<Blob | null>(null);
  const [zoom, setZoom] = useState(1); const [rot, setRot] = useState(0);
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(''); const [note, setNote] = useState<string | null>(null);
  const [read, setRead] = useState<string | null>(null);
  const pdf = x.doc?.mime === 'application/pdf';

  useEffect(() => {
    let u: string | null = null, live = true;
    if (x.doc) fetchDocument(x.doc.path).then((b) => { if (!live) return; blob.current = new Blob([b], { type: x.doc!.mime || b.type }); u = URL.createObjectURL(blob.current); setUrl(u); }).catch((e) => live && setErr(e));
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [x.doc?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const digits = f.number.replace(/\s/g, '');
  const bad = !isId || !f.number ? null
    : x.kind === 'aadhaar' && !/^[2-9]\d{11}$/.test(digits) ? 'An Aadhaar number has 12 digits.'
    : x.kind === 'pan' && !/^[A-Z]{5}\d{4}[A-Z]$/i.test(digits) ? 'A PAN is 5 letters, 4 digits, 1 letter.'
    : x.kind === 'bank' && !/^\d{9,18}$/.test(digits) ? 'An account number has 9 to 18 digits.'
    : x.kind === 'bank' && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(f.ifsc.trim()) ? 'An IFSC is 11 characters: 4 letters, 0, then 6 more.' : null;
  const changed = isId && (digits.toUpperCase() !== (x.number ?? '') || f.name.trim() !== (x.name_on ?? '') || (x.kind === 'bank' && (f.ifsc.trim().toUpperCase() !== (x.ifsc ?? '') || f.bank_name.trim() !== (x.bank_name ?? ''))));
  const nameOff = isId && f.name.trim() && !sameName(f.name, x.full_name);

  async function readImage() {
    if (!blob.current) return;
    setBusy('read'); setErr(null); setRead('Reading the document…');
    try {
      const { scanDocument, prepareImage, preparedFile } = await import('../lib/ocr');
      let img = blob.current, turn = (pdf ? 0 : rot) as 0 | 90 | 180 | 270;       // unless corrected below, read it the way HR has turned it
      setRead('Straightening the picture…');
      try { const pr = await prepareImage(img, { crop: true });                  // the corrected picture becomes the current upload
        if (pr.changed) { const file = preparedFile(pr, x.doc!.file_name, true); await uploadDocument(x.person_id, x.kind, file); img = file; turn = 0; setRot(0); onReload(); } } catch { /* read it as it is */ }
      const r = await scanDocument(img, x.kind as Kind, (_p, l) => setRead(`${l}…`), undefined, turn);
      const p = r.parsed;
      if (!p.number && !p.name && !p.ifsc) { setRead('The reader could not make out the details. Type them from the image.'); return; }
      setF((o) => ({ number: p.number ? formatId(x.kind as Kind, p.number) : o.number, name: p.name ?? o.name, dob: x.kind === 'aadhaar' ? p.dob ?? o.dob : o.dob, ifsc: p.ifsc ?? o.ifsc, bank_name: p.bank_name ?? o.bank_name }));
      setRead(r.check.ok ? 'Filled in from the document. Compare it with the image before saving.' : `Filled in what could be read — check every character against the image. (${r.check.message})`);
    } catch (e) { setRead(null); setErr(e); } finally { setBusy(''); }
  }
  async function done() {
    setBusy('save'); setErr(null);
    try {
      await rpc('doc_check_done', { p_person: x.person_id, p_kind: x.kind, p_doc: x.doc?.id ?? null,
        p: isId ? { number: digits, name: f.name.trim() || null, dob: f.dob || null, ifsc: f.ifsc.trim() || null, bank_name: f.bank_name.trim() || null } : null });
      onDone();
    } catch (e) { setErr(e); } finally { setBusy(''); }
  }
  async function sendBack() {
    if (!x.doc || !note?.trim()) return;
    setBusy('back'); setErr(null);
    try { await rpc('verify_document', { p_id: x.doc.id, p_ok: false, p_note: note.trim() }); onDone(); } catch (e) { setErr(e); } finally { setBusy(''); }
  }

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 10 }}>
        <div><h2 style={{ margin: 0 }}>{x.full_name}</h2><div className="small muted">{DOC[x.kind] ?? x.kind}{x.doc ? ` · uploaded ${time(x.doc.uploaded_at)}` : ''}</div></div>
        <span className="spacer" /><span className={`pill ${STATE[x.state][0]} small`}>{STATE[x.state][1]}</span>
      </div>
      <div className="doccheck-pair">
        <div className="doccheck-view">
          {!x.doc ? <div className="banner warn">No file is on record for this. The details were entered without an upload — ask the person to upload the document.</div>
            : !url ? <Loading rows={3} />
            : pdf ? <iframe title={`${x.full_name} ${DOC[x.kind] ?? x.kind}`} src={url} className="doccheck-frame" />
            : <div className="doccheck-img" tabIndex={0} aria-label="Document image. Scroll to move around."><img src={url} alt={`${DOC[x.kind] ?? x.kind} uploaded by ${x.full_name}`} style={{ width: `${zoom * 100}%`, transform: `rotate(${rot}deg)` }} /></div>}
          {x.doc && <div className="row" style={{ marginTop: 6, gap: 6 }}>
            {!pdf && <><button className="btn sm" onClick={() => setZoom((z) => Math.max(0.5, z - 0.5))} aria-label="Zoom out">−</button>
              <button className="btn sm" onClick={() => setZoom((z) => Math.min(4, z + 0.5))} aria-label="Zoom in">+</button>
              <button className="btn sm" onClick={() => setRot((r) => (r + 90) % 360)}>Turn</button></>}
            <button className="btn sm" onClick={() => openDocument(x.doc!.path).catch(setErr)}>Open in a new tab</button>
            <span className="small muted">{x.doc.file_name}</span>
          </div>}
        </div>
        <div className="stack">
          {isId ? <>
            <div className="small muted">{x.number ? <>Recorded details — {SRC[x.source ?? 'scan'] ?? x.source}.</> : 'No details recorded yet. Type them exactly as on the document.'}</div>
            <label className="field">{x.kind === 'bank' ? 'Account number' : x.kind === 'pan' ? 'PAN' : 'Aadhaar number'}
              <input value={f.number} onChange={(e) => setF({ ...f, number: x.kind === 'pan' ? e.target.value.toUpperCase() : e.target.value })} inputMode={x.kind === 'pan' ? 'text' : 'numeric'} autoComplete="off" style={{ fontSize: '1.15rem', letterSpacing: '.05em' }} /></label>
            {x.kind === 'bank' && <div className="grid two">
              <label className="field">IFSC<input value={f.ifsc} maxLength={11} onChange={(e) => setF({ ...f, ifsc: e.target.value.toUpperCase() })} autoComplete="off" /></label>
              <label className="field">Bank<input value={f.bank_name} onChange={(e) => setF({ ...f, bank_name: e.target.value })} /></label></div>}
            <label className="field">{x.kind === 'bank' ? 'Account holder name' : 'Name on the document'}<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="off" /></label>
            {x.kind === 'aadhaar' && <label className="field">Date of birth on the card<input type="date" value={f.dob} onChange={(e) => setF({ ...f, dob: e.target.value })} />
              <span className="small muted">{x.dob ? `In the profile: ${new Date(x.dob).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Not in the profile yet; it is filled from here.'}</span></label>}
            <div className="small">Name in CRUX: <b>{x.full_name}</b>{nameOff ? <span className="pill warn small" style={{ marginLeft: 6 }}>differs from the document</span> : f.name.trim() ? <span className="pill ok small" style={{ marginLeft: 6 }}>matches</span> : null}</div>
            {bad && <div className="small" style={{ color: 'var(--bad)' }}>{bad}</div>}
            {read && <div className="banner info small" role="status">{read}</div>}
          </> : <div className="small muted">Open the file and confirm it is a clear, complete {(DOC[x.kind] ?? x.kind).toLowerCase()} for this person.</div>}
          <ErrorBox error={err} />
          {note === null ? <div className="row" style={{ gap: 6 }}>
            <button className="btn primary" disabled={!!busy || (isId && (!f.number || !!bad)) || (!isId && !x.doc)} onClick={done}>{busy === 'save' ? 'Saving…' : !isId ? 'Verify' : changed ? 'Save and mark checked' : 'It matches — mark checked'}</button>
            {isId && x.doc && <button className="btn" disabled={!!busy || !url} onClick={readImage}>{busy === 'read' ? 'Reading…' : 'Straighten and read the image'}</button>}
            {x.doc && <button className="btn" disabled={!!busy} onClick={() => setNote('')}>Send back</button>}
          </div> : <form className="stack" onSubmit={(e) => { e.preventDefault(); sendBack(); }}>
            <label className="field">What is wrong? The person is told and asked to upload again.
              <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. photo is blurred, number not visible" /></label>
            <div className="row" style={{ gap: 6 }}><button className="btn danger" disabled={!!busy || !note.trim()}>{busy === 'back' ? 'Sending…' : 'Send back'}</button><button type="button" className="btn" onClick={() => setNote(null)}>Cancel</button></div>
          </form>}
        </div>
      </div>
    </div>
  );
}
