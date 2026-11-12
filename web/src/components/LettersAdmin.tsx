import { useMemo, useState } from 'react';
import { read, utils, writeFile } from 'xlsx';
import { Me, rpc } from '../lib/api';
import { label, money, time } from '../lib/format';
import { Letterhead } from '../lib/pdf';
import { Card, Empty, ErrorBox, Loading, Tabs, useLoad } from './ui';
import { LetterRow, LetterView, Payslips, statusPill } from '../pages/Letters';

type Tpl = { id: string; kind: string; name: string; body: string; needs_signature: boolean; active: boolean };
type RoleP = { id: string; designation: string; department: string; responsibilities: string };
type Person = { id: string; name: string; designation: string | null; department: string | null; partner: boolean; own_text: boolean };
type Setup = { templates: Tpl[]; roles: RoleP[]; designations: string[]; departments: string[]; people: Person[] };
const KINDS: [string, string][] = [['offer', 'Offer'], ['appointment', 'Appointment'], ['confirmation', 'Confirmation'], ['increment', 'Salary revision'], ['appraisal', 'Appraisal'], ['promotion', 'Promotion'],
  ['transfer', 'Transfer'], ['warning', 'Warning'], ['resignation_acceptance', 'Exit · resignation accepted'], ['relieving', 'Exit · relieving'], ['experience', 'Exit · experience'], ['full_final', 'Exit · full and final'], ['other', 'Other']];
const KIND = Object.fromEntries(KINDS);
const AUTO = ['name', 'designation', 'department', 'joining_date', 'reporting_manager', 'monthly_salary', 'annual_salary', 'address', 'mobile', 'responsibilities', 'today', 'company_name', 'company_address'];
const fieldLabel = (k: string) => label(k);

/** HR: letter templates, roles & responsibilities, issuing and tracking letters, the letterhead, and past salary slips (D-131, D-132). */
export function LettersAdmin({ me }: { me: Me }) {
  const [tab, setTab] = useState<'issue' | 'sent' | 'templates' | 'roles' | 'head' | 'slips'>('issue');
  const s = useLoad(() => rpc<Setup>('letter_setup', {}), []);
  if (s.loading && !s.data) return <Loading rows={4} />;
  if (s.error || !s.data) return <ErrorBox error={s.error} retry={s.reload} />;
  return (
    <div className="stack">
      <Tabs tabs={[['issue', 'Send a letter'], ['sent', 'Letters sent'], ['templates', 'Letter templates'], ['roles', 'Roles & responsibilities'], ['head', 'Letterhead'], ['slips', 'Salary slips']]} value={tab} onChange={setTab} />
      {tab === 'issue' && <Issue setup={s.data} onDone={() => setTab('sent')} />}
      {tab === 'sent' && <Sent />}
      {tab === 'templates' && <Templates list={s.data.templates} reload={s.reload} />}
      {tab === 'roles' && <Roles setup={s.data} reload={s.reload} />}
      {tab === 'head' && <Head me={me} />}
      {tab === 'slips' && <SlipsAdmin people={s.data.people} />}
    </div>
  );
}

function Issue({ setup, onDone }: { setup: Setup; onDone: () => void }) {
  const tpls = setup.templates.filter((t) => t.active);
  const [tid, setTid] = useState(tpls[0]?.id ?? ''); const [q, setQ] = useState(''); const [picked, setPicked] = useState<string[]>([]);
  const [extra, setExtra] = useState<Record<string, string>>({}); const [pv, setPv] = useState<{ title: string; body: string; missing: string[]; kind: string; needs_signature: boolean } | null>(null);
  const [body, setBody] = useState(''); const [busy, setBusy] = useState(''); const [err, setErr] = useState<unknown>(null); const [msg, setMsg] = useState('');
  const t = tpls.find((x) => x.id === tid);
  // the blanks HR fills: every {{field}} in the template that the app cannot fill from the person's record
  const blanks = useMemo(() => [...new Set([...(t?.body.matchAll(/\{\{([a-z_0-9]+)\}\}/g) ?? [])].map((m) => m[1]))].filter((k) => !AUTO.includes(k)), [t]);
  const people = setup.people.filter((p) => !q.trim() || `${p.name} ${p.designation ?? ''} ${p.department ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const one = picked.length === 1 ? setup.people.find((p) => p.id === picked[0]) : null;
  const toggle = (id: string) => { setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id])); setPv(null); setMsg(''); };
  const run = async (k: string, fn: () => Promise<void>) => { setBusy(k); setErr(null); setMsg(''); try { await fn(); } catch (e) { setErr(e); } finally { setBusy(''); } };
  const preview = () => run('pv', async () => { const r = await rpc<any>('letter_preview', { p_person: picked[0], p_template: tid, p_extra: extra }); setPv(r); setBody(r.body); });
  const left = [...new Set([...body.matchAll(/\{\{([a-z_0-9]+)\}\}/g)].map((m) => m[1]))];
  const sendOne = () => run('send', async () => {
    const r = await rpc<{ ref_no: string }>('letter_issue', { p_person: picked[0], p_kind: pv!.kind, p_title: pv!.title, p_body: body, p_needs_signature: pv!.needs_signature });
    setMsg(`Sent to ${one?.name} (${r.ref_no}). They have been notified.`); setPv(null); setPicked([]);
  });
  const sendMany = () => run('send', async () => {
    const r = await rpc<{ issued: number; skipped: { name: string; missing: string[] }[] }>('letter_issue_bulk', { p_template: tid, p_people: picked, p_extra: extra });
    setMsg(`Sent to ${r.issued} ${r.issued === 1 ? 'person' : 'people'}.${r.skipped.length ? ` Not sent to ${r.skipped.map((x) => `${x.name} (blank: ${x.missing.map(fieldLabel).join(', ')})`).join('; ')}.` : ''}`);
    if (r.issued) setPicked([]);
  });
  if (!tpls.length) return <Card><Empty>There is no active letter template. Add one under Letter templates.</Empty></Card>;
  return (
    <div className="stack">
      <Card title="1 · Which letter" help="Offer, appointment, confirmation, salary revision, appraisal, promotion, transfer, warning and the exit letters. Change their wording under Letter templates.">
        <div className="grid two">
          <label className="field">Letter<select value={tid} onChange={(e) => { setTid(e.target.value); setPv(null); setExtra({}); }}>{tpls.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            <span className="small muted">{t ? `${KIND[t.kind] ?? t.kind} · ${t.needs_signature ? 'the person signs it on their phone' : 'no signature needed, the person only acknowledges it'}` : ''}</span></label>
        </div>
        {blanks.length > 0 && <><div className="small muted" style={{ margin: '10px 0 6px' }}>Fill these for this letter. Name, designation, department, joining date, manager, salary and the roles & responsibilities are filled from each person's record.</div>
          <div className="grid two">{blanks.map((k) => <label key={k} className="field">{fieldLabel(k)}
            <input value={extra[k] ?? ''} onChange={(e) => { setExtra({ ...extra, [k]: e.target.value }); setPv(null); }} placeholder={/date|_day$/.test(k) ? 'e.g. 1 Dec 2026' : /salary|amount/.test(k) ? 'e.g. Rs. 28,000' : ''} /></label>)}</div></>}
      </Card>
      <Card title={`2 · For whom${picked.length ? ` (${picked.length} chosen)` : ''}`} action={<input placeholder="Search name, designation, department" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} aria-label="Search people" />}>
        <div className="row small" style={{ marginBottom: 8 }}>
          <button className="btn sm" onClick={() => { setPicked([...new Set([...picked, ...people.map((p) => p.id)])]); setPv(null); }}>Choose all {people.length} shown</button>
          <button className="btn sm" disabled={!picked.length} onClick={() => { setPicked([]); setPv(null); }}>Clear</button>
          <span className="muted">Choose one person to read and adjust their letter before sending; choose several to send the same letter to all.</span></div>
        <div className="picklist" role="group" aria-label="People">{people.map((p) => (
          <label key={p.id} className={`pickrow${picked.includes(p.id) ? ' on' : ''}`}><input type="checkbox" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} />
            <span><b>{p.name}</b><span className="small muted"> · {p.designation ?? 'no designation'}{p.department ? ` · ${p.department}` : ''}{p.partner ? ' · Business Associate' : ''}{p.own_text ? ' · own responsibilities' : ''}</span></span></label>))}
          {people.length === 0 && <Empty>Nobody matches.</Empty>}</div>
      </Card>
      <ErrorBox error={err} />{msg && <div className="banner ok" role="status">{msg} <button className="linklike" onClick={onDone}>See letters sent</button></div>}
      {picked.length === 1 && !pv && <div><button className="btn primary" disabled={busy === 'pv'} onClick={preview}>{busy === 'pv' ? 'Preparing…' : `Prepare the letter for ${one?.name}`}</button></div>}
      {picked.length === 1 && pv && (
        <Card title={`3 · Check and send · ${pv.title} for ${one?.name}`} help="This is exactly what the person will read. Change anything that is specific to this person here; the template stays as it is.">
          <div className="stack">
            <textarea rows={18} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Letter text" style={{ fontFamily: 'inherit', lineHeight: 1.5 }} />
            {left.length > 0 && <div className="stack" style={{ gap: 8 }}>
              <div className="banner warn">Still blank for {one?.name}: {left.map(fieldLabel).join(', ')}. These are not in their record yet. Fill them here, or type the value in the text in place of the {'{{…}}'} marker.</div>
              <div className="grid two">{left.map((k) => <label key={k} className="field">{fieldLabel(k)}<input value={extra[k] ?? ''} onChange={(e) => setExtra({ ...extra, [k]: e.target.value })} /></label>)}</div>
              <div><button className="btn" disabled={busy === 'pv' || left.every((k) => !(extra[k] ?? '').trim())} onClick={preview}>Fill and prepare again</button></div>
            </div>}
            <div className="row"><button className="btn primary" disabled={left.length > 0 || busy === 'send'} onClick={sendOne}>{busy === 'send' ? 'Sending…' : `Send to ${one?.name}${pv.needs_signature ? ' to sign' : ''}`}</button>
              <button className="btn" onClick={() => setPv(null)}>Start again</button></div>
          </div>
        </Card>)}
      {picked.length > 1 && <div className="stack"><div className="banner neutral">The same letter goes to all {picked.length} people, each filled from their own record. Anyone with a blank field is skipped and listed, so nothing is sent half-filled.</div>
        <div><button className="btn primary" disabled={busy === 'send'} onClick={() => window.confirm(`Send "${t?.name}" to ${picked.length} people?`) && sendMany()}>{busy === 'send' ? 'Sending…' : `Send to ${picked.length} people`}</button></div></div>}
    </div>
  );
}

function Sent() {
  const d = useLoad(() => rpc<LetterRow[]>('letters_list', { p_person: null }), []);
  const [f, setF] = useState<'all' | 'issued' | 'signed' | 'declined' | 'withdrawn'>('all'); const [q, setQ] = useState(''); const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  if (open) return <LetterView id={open} mine={false} onBack={() => { setOpen(null); d.reload(); }} />;
  const all = d.data ?? []; const n = (s: string) => all.filter((l) => l.status === s).length;
  const rows = all.filter((l) => (f === 'all' || l.status === f) && (!q.trim() || `${l.person} ${l.title} ${l.ref_no}`.toLowerCase().includes(q.trim().toLowerCase())));
  const withdraw = async (l: LetterRow) => { const why = window.prompt(`Withdraw "${l.title}" sent to ${l.person}? Give the reason.`); if (!why?.trim()) return;
    try { setErr(null); await rpc('letter_close', { p_id: l.id, p_reason: why.trim() }); d.reload(); } catch (e) { setErr(e); } };
  return (
    <Card title="Letters sent" action={<input placeholder="Search person, letter, ref" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} aria-label="Search letters" />}>
      <Tabs tabs={[['all', `All (${all.length})`], ['issued', `Waiting (${n('issued')})`], ['signed', `Signed (${n('signed')})`], ['declined', `Not accepted (${n('declined')})`], ['withdrawn', `Withdrawn (${n('withdrawn')})`]]} value={f} onChange={setF} />
      {d.loading && !d.data ? <Loading rows={3} /> : <ErrorBox error={d.error} retry={d.reload} />}<ErrorBox error={err} />
      {d.data && (rows.length === 0 ? <Empty>No letters here.</Empty> :
        <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Person</th><th>Letter</th><th>Sent</th><th>Status</th><th /></tr></thead>
          <tbody>{rows.map((l) => <tr key={l.id}><td><b>{l.person}</b><div className="small muted">{l.designation ?? ''}</div></td><td>{l.title}<div className="small muted">{l.ref_no}</div></td>
            <td className="small">{time(l.issued_at)}</td><td>{statusPill(l)}{l.signed_at && <div className="small muted">{time(l.signed_at)}</div>}{l.closed_reason && <div className="small muted">{l.closed_reason}</div>}</td>
            <td className="row"><button className="btn sm" onClick={() => setOpen(l.id)}>Open</button>{l.status === 'issued' && <button className="btn sm" onClick={() => withdraw(l)}>Withdraw</button>}</td></tr>)}</tbody></table></div>)}
    </Card>
  );
}

function Templates({ list, reload }: { list: Tpl[]; reload: () => void }) {
  const blank: Tpl = { id: '', kind: 'other', name: '', body: 'Dear {{name}},\n\n', needs_signature: true, active: true };
  const [ed, setEd] = useState<Tpl | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  async function save() {
    setBusy(true); setErr(null);
    try { await rpc('letter_template_save', { p_id: ed!.id || null, p_kind: ed!.kind, p_name: ed!.name, p_body: ed!.body, p_needs_signature: ed!.needs_signature, p_active: ed!.active }); setEd(null); reload(); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const insert = (k: string) => setEd((x) => (x ? { ...x, body: `${x.body}{{${k}}}` } : x));
  if (ed) return (
    <Card title={ed.id ? `Edit · ${ed.name}` : 'New letter template'} help="Write the letter once. Words in double curly brackets are filled for each person when the letter is sent.">
      <div className="stack">
        <div className="grid two">
          <label className="field">Name of the letter<input value={ed.name} onChange={(e) => setEd({ ...ed, name: e.target.value })} placeholder="e.g. Appointment letter – field staff" /></label>
          <label className="field">Type<select value={ed.kind} onChange={(e) => setEd({ ...ed, kind: e.target.value })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        </div>
        <label className="field">Letter text<textarea rows={20} value={ed.body} onChange={(e) => setEd({ ...ed, body: e.target.value })} style={{ fontFamily: 'inherit', lineHeight: 1.5 }} /></label>
        <div className="field">Filled from the person's record — tap to add at the end of the text
          <div className="segbtns">{AUTO.map((k) => <button key={k} type="button" className="btn sm" onClick={() => insert(k)}>{`{{${k}}}`}</button>)}</div>
          <span className="small muted">Any other word in double curly brackets, such as {'{{effective_date}}'} or {'{{revised_monthly_salary}}'}, becomes a box HR fills when sending. Leave a blank line between paragraphs; start a line with “- ” for a bullet.</span></div>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" style={{ width: 'auto', minHeight: 0 }} checked={ed.needs_signature} onChange={(e) => setEd({ ...ed, needs_signature: e.target.checked })} /><span>The person must sign this letter (untick for letters they only receive, such as relieving and experience letters)</span></label>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" style={{ width: 'auto', minHeight: 0 }} checked={ed.active} onChange={(e) => setEd({ ...ed, active: e.target.checked })} /><span>In use (untick to retire it without losing letters already sent)</span></label>
        <ErrorBox error={err} />
        <div className="row"><button className="btn primary" disabled={busy || ed.name.trim().length < 3 || ed.body.trim().length < 20} onClick={save}>{busy ? 'Saving…' : 'Save template'}</button><button className="btn" onClick={() => setEd(null)}>Cancel</button></div>
        <p className="small muted" style={{ margin: 0 }}>Changing a template does not change letters already sent; each sent letter keeps the text it was sent with.</p>
      </div>
    </Card>);
  return (
    <Card title="Letter templates" action={<button className="btn sm primary" onClick={() => setEd(blank)}>Add a template</button>} help="One template per kind of letter. The starting wording is a general draft: read it with your HR policy and change it to the company's own words before sending.">
      <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Letter</th><th>Type</th><th>Signature</th><th>Status</th><th /></tr></thead>
        <tbody>{list.map((t) => <tr key={t.id}><td><b>{t.name}</b><div className="small muted">{t.body.replace(/\s+/g, ' ').slice(0, 90)}…</div></td><td>{KIND[t.kind] ?? t.kind}</td>
          <td>{t.needs_signature ? 'Signs' : 'Acknowledges'}</td><td>{t.active ? <span className="pill ok">In use</span> : <span className="pill neutral">Retired</span>}</td>
          <td><button className="btn sm" onClick={() => setEd(t)}>Edit</button></td></tr>)}</tbody></table></div>
    </Card>
  );
}

function Roles({ setup, reload }: { setup: Setup; reload: () => void }) {
  const [ed, setEd] = useState<{ designation: string; department: string; responsibilities: string } | null>(null);
  const [pid, setPid] = useState(''); const [ptext, setPtext] = useState<{ text: string | null; own: boolean } | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null); const [msg, setMsg] = useState('');
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(null); setMsg(''); try { await fn(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  const save = () => run(async () => { await rpc('role_profile_save', { p_designation: ed!.designation, p_department: ed!.department, p_responsibilities: ed!.responsibilities }); setEd(null); reload(); });
  const pick = (id: string) => { setPid(id); setPtext(null); if (id) run(async () => setPtext(await rpc('person_responsibilities_get', { p_person: id }))); };
  const savePerson = (text: string) => run(async () => { await rpc('person_responsibilities_save', { p_person: pid, p_responsibilities: text }); setPtext(await rpc('person_responsibilities_get', { p_person: pid })); setMsg(text ? 'Saved for this person.' : 'Back to the designation\'s responsibilities.'); reload(); });
  const person = setup.people.find((p) => p.id === pid);
  return (
    <div className="stack">
      <ErrorBox error={err} />
      {ed ? (
        <Card title={`Roles & responsibilities · ${ed.designation || 'new'}`}>
          <div className="stack">
            <div className="grid two">
              <label className="field">Designation<select value={ed.designation} onChange={(e) => setEd({ ...ed, designation: e.target.value })}><option value="">Choose…</option>
                {[...new Set([...setup.designations, ed.designation].filter(Boolean))].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
              <label className="field">Department<select value={ed.department} onChange={(e) => setEd({ ...ed, department: e.target.value })}><option value="">All departments</option>{setup.departments.map((x) => <option key={x} value={x}>{x}</option>)}</select>
                <span className="small muted">Choose a department only when this designation's work differs there.</span></label>
            </div>
            <label className="field">Roles and responsibilities<textarea rows={12} value={ed.responsibilities} onChange={(e) => setEd({ ...ed, responsibilities: e.target.value })} placeholder={'- One responsibility per line\n- Start each line with a dash'} style={{ fontFamily: 'inherit', lineHeight: 1.5 }} /></label>
            <div className="row"><button className="btn primary" disabled={busy || !ed.designation || ed.responsibilities.trim().length < 10} onClick={save}>Save</button><button className="btn" onClick={() => setEd(null)}>Cancel</button></div>
          </div>
        </Card>) : (
        <Card title="By designation" action={<button className="btn sm primary" onClick={() => setEd({ designation: '', department: '', responsibilities: '' })}>Add a designation</button>}
          help="What each designation is responsible for. It goes into the appointment and promotion letters wherever the template says {{responsibilities}}. A title such as 'Assistant Branch Manager' uses the longest matching designation here.">
          <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Designation</th><th>Department</th><th>Responsibilities</th><th /></tr></thead>
            <tbody>{setup.roles.map((r) => <tr key={r.id}><td><b>{r.designation}</b></td><td>{r.department || 'All'}</td><td className="small">{r.responsibilities.split('\n').filter(Boolean).length} points<div className="muted">{r.responsibilities.split('\n')[0].slice(0, 80)}</div></td>
              <td><button className="btn sm" onClick={() => setEd({ designation: r.designation, department: r.department, responsibilities: r.responsibilities })}>Edit</button></td></tr>)}</tbody></table></div>
        </Card>)}
      <Card title="For one person" help="When one person's responsibilities differ from their designation's, write theirs here. Their letters then use this text.">
        <div className="stack">
          <label className="field">Person<select value={pid} onChange={(e) => pick(e.target.value)}><option value="">Choose…</option>{setup.people.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.designation ?? 'no designation'}{p.own_text ? ' · own text' : ''}</option>)}</select></label>
          {pid && ptext && <PersonText key={pid + String(ptext.own)} start={ptext.text ?? ''} own={ptext.own} busy={busy} name={person?.name ?? ''} onSave={savePerson} />}
          {msg && <div className="banner ok" role="status">{msg}</div>}
        </div>
      </Card>
    </div>
  );
}
function PersonText({ start, own, busy, name, onSave }: { start: string; own: boolean; busy: boolean; name: string; onSave: (t: string) => void }) {
  const [t, setT] = useState(start);
  return (<>
    <div className="small muted">{own ? `${name} has their own text.` : start ? `${name} currently uses the designation's text below. Change it to give them their own.` : `No responsibilities are written for ${name}'s designation yet. Write them here, or add the designation above.`}</div>
    <textarea rows={10} value={t} onChange={(e) => setT(e.target.value)} aria-label={`Roles and responsibilities of ${name}`} style={{ fontFamily: 'inherit', lineHeight: 1.5 }} />
    <div className="row"><button className="btn primary" disabled={busy || t.trim().length < 10 || t === start} onClick={() => onSave(t)}>Save for {name}</button>
      {own && <button className="btn" disabled={busy} onClick={() => onSave('')}>Use the designation's text again</button>}</div>
  </>);
}

/** Read an image, shrink it so it stores small, and hand back a data URL. */
function shrink(f: File, maxW: number, type: 'image/png' | 'image/jpeg'): Promise<string> {
  return new Promise((res, rej) => { const img = new Image(); const u = URL.createObjectURL(f);
    img.onload = () => { const k = Math.min(1, maxW / img.naturalWidth); const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      const g = c.getContext('2d')!; if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); } g.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); res(c.toDataURL(type, 0.85)); };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('That file is not an image. Use a PNG or JPG.')); }; img.src = u; });
}
function Head({ me }: { me: Me }) {
  const d = useLoad(() => rpc<Letterhead>('letterhead', {}), []);
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState('');
  const put = async (key: 'letterhead' | 'signature', f?: File | null) => { setBusy(key); setErr(null);
    try { await rpc('company_asset_set', { p_key: key, p_data_url: f ? await shrink(f, key === 'letterhead' ? 1600 : 600, key === 'letterhead' ? 'image/jpeg' : 'image/png') : '' }); d.reload(); } catch (e) { setErr(e); } finally { setBusy(''); } };
  if (d.loading && !d.data) return <Loading rows={3} />;
  const lh = d.data; if (!lh) return <ErrorBox error={d.error} retry={d.reload} />;
  const pick = (key: 'letterhead' | 'signature', text: string) => <label className="btn sm" style={{ cursor: 'pointer' }}>{busy === key ? 'Uploading…' : text}<input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => { put(key, e.target.files?.[0]); e.target.value = ''; }} /></label>;
  return (
    <div className="stack">
      <ErrorBox error={err} />
      <Card title="Letterhead" help="Every letter and salary slip is printed on this. Upload the top strip of your letterhead as an image (logo, name and address across the page). Without it, the company logo, name and address from Settings are used.">
        <div className="stack">
          <div className="letter-head" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}>{lh.letterhead ? <img src={lh.letterhead} alt="Letterhead" /> :
            <div className="row" style={{ gap: 12 }}><img src={`${import.meta.env.BASE_URL}crux-logo.png`} alt="" style={{ height: 40 }} /><div><b>{lh.name}</b><div className="small muted">{[lh.address || lh.place, lh.website].filter(Boolean).join(' · ')}</div></div></div>}</div>
          <div className="row">{pick('letterhead', lh.letterhead ? 'Replace the letterhead image' : 'Upload a letterhead image')}{lh.letterhead && <button className="btn sm" onClick={() => put('letterhead', null)}>Remove and use logo and address</button>}</div>
        </div>
      </Card>
      <Card title="Signed for the company by" help="Printed at the end of every letter.">
        <div className="stack">
          <div><b>{lh.signatory_name || 'Authorised Signatory'}</b>{lh.signatory_name && <div className="small muted">{lh.signatory_title}</div>}{lh.signature && <div><img src={lh.signature} alt="Signature" style={{ height: 50 }} /></div>}</div>
          <div className="row">{pick('signature', lh.signature ? 'Replace the signature image' : 'Upload the signatory\'s signature')}{lh.signature && <button className="btn sm" onClick={() => put('signature', null)}>Remove</button>}</div>
          <p className="small muted" style={{ margin: 0 }}>The signatory's name and designation, the company address and CIN are changed {me.roles.includes('admin') ? <>under <b>Admin → Settings → Company</b>.</> : 'by Admin under Settings → Company.'} Upload the signature only with that person's consent.</p>
        </div>
      </Card>
    </div>
  );
}

const COLS = ['mobile', 'name', 'month', 'paid_days', 'basic', 'hra', 'allowances', 'incentive', 'arrears', 'pf', 'esi', 'pt', 'tds', 'other_deductions', 'net'];
function SlipsAdmin({ people }: { people: Person[] }) {
  const sum = useLoad(() => rpc<{ month: string; people: number; net: number }[]>('payslip_history_summary', {}), []);
  const [rows, setRows] = useState<Record<string, string>[] | null>(null); const [chk, setChk] = useState<{ ok: number; problems: { row: number; who: string; month: string; why: string }[] } | null>(null);
  const [busy, setBusy] = useState(''); const [err, setErr] = useState<unknown>(null); const [msg, setMsg] = useState(''); const [pid, setPid] = useState('');
  const template = () => { const ws = utils.aoa_to_sheet([COLS, ['9800000001', 'Example Name', '2025-04', 30, 12500, 6250, 6250, 0, 0, 1500, 0, 200, 0, 0, 23300]]); const wb = utils.book_new(); utils.book_append_sheet(wb, ws, 'Past salary'); writeFile(wb, 'past-salary-slips-template.xlsx'); };
  async function load(f?: File) {
    if (!f) return; setErr(null); setMsg(''); setChk(null); setRows(null); setBusy('read');
    try {
      const wb = read(await f.arrayBuffer()); const raw = utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
      const clean = raw.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim().toLowerCase().replace(/\s+/g, '_'), String(v ?? '').replace(/,/g, '').trim()]).filter(([k]) => COLS.includes(k))))
        .filter((r) => Object.values(r).some((v) => v !== ''));
      if (!clean.length) throw new Error('No rows found. Use the template: the first row must be the column names.');
      setRows(clean); setChk(await rpc('payslip_history_upload', { p_rows: clean, p_apply: false }));
    } catch (e) { setErr(e); } finally { setBusy(''); }
  }
  async function apply() {
    setBusy('apply'); setErr(null);
    try { const good = rows!.filter((_, i) => !chk!.problems.some((p) => p.row === i + 1)); const r = await rpc<{ ok: number }>('payslip_history_upload', { p_rows: good, p_apply: true });
      setMsg(`${r.ok} salary slips saved. Each person can now download theirs under My letters & salary slips.`); setRows(null); setChk(null); sum.reload(); } catch (e) { setErr(e); } finally { setBusy(''); }
  }
  return (
    <div className="stack">
      <Card title="Salary slips for past months" help="For months before payroll was run in this app. One row per person per month. From the month payroll is approved here, slips are made automatically and need no upload.">
        <div className="stack">
          <ol className="howsteps"><li>Download the template and fill one row per person per month: mobile number (or exact name), month as 2025-04, paid days, then the amounts.</li>
            <li>Upload it. Every row is checked first: the person must exist, the month must be in the past, and earnings minus deductions must equal net pay.</li>
            <li>Save the rows that pass. Uploading a person's month again replaces it.</li></ol>
          <div className="row"><button className="btn" onClick={template}>Download the template</button>
            <label className="btn primary" style={{ cursor: 'pointer' }}>{busy === 'read' ? 'Checking…' : 'Upload the filled sheet'}<input type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => { load(e.target.files?.[0]); e.target.value = ''; }} /></label></div>
          <ErrorBox error={err} />{msg && <div className="banner ok" role="status">{msg}</div>}
          {chk && <>
            <div className={`banner ${chk.problems.length ? 'warn' : 'ok'}`}>{chk.ok} of {rows?.length} rows are ready.{chk.problems.length ? ` ${chk.problems.length} need correcting and will not be saved.` : ''}</div>
            {chk.problems.length > 0 && <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Row</th><th>Person</th><th>Month</th><th>What is wrong</th></tr></thead>
              <tbody>{chk.problems.slice(0, 100).map((p) => <tr key={p.row}><td>{p.row + 1}</td><td>{p.who}</td><td>{p.month}</td><td>{p.why}</td></tr>)}</tbody></table></div>}
            <div><button className="btn primary" disabled={!chk.ok || busy === 'apply'} onClick={apply}>{busy === 'apply' ? 'Saving…' : `Save ${chk.ok} salary slips`}</button></div></>}
        </div>
      </Card>
      <Card title="Uploaded so far">
        {sum.loading && !sum.data ? <Loading rows={2} /> : <ErrorBox error={sum.error} retry={sum.reload} />}
        {sum.data && (sum.data.length === 0 ? <Empty>Nothing uploaded yet.</Empty> :
          <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Month</th><th className="num">People</th><th className="num">Net pay</th></tr></thead>
            <tbody>{sum.data.map((m) => <tr key={m.month}><td>{new Date(m.month + 'T12:00:00+05:30').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</td><td className="num">{m.people}</td><td className="num">{money(m.net)}</td></tr>)}</tbody></table></div>)}
      </Card>
      <Card title="A person's salary slips" help="Open anyone's slips to check or download them.">
        <label className="field">Person<select value={pid} onChange={(e) => setPid(e.target.value)}><option value="">Choose…</option>{people.filter((p) => !p.partner).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.designation ?? ''}</option>)}</select></label>
      </Card>
      {pid && <Payslips personId={pid} />}
    </div>
  );
}
