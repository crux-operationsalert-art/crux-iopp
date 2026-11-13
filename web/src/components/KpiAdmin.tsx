import { useEffect, useMemo, useState } from 'react';
import { Me, rpc, errText } from '../lib/api';
import { Card, Empty, ErrorBox, Loading, useLoad } from './ui';
import { DesignationMap } from './Designation';
import { HowKpisWork, TeamSetup } from './Scorecard';

type Cat = { id: string; department: string; name: string; unit: string | null; cadence: string; higher_better: boolean; active: boolean;
  description: string | null; levels: string[]; auto: boolean; assignees: number };
const MEASURES: [string, string, string][] = [['count', 'a count (how many)', ' – Volume'], ['percent', 'a percentage', ' – Rate %'], ['time', 'time taken', ' – Turnaround Time'],
  ['amount', 'an amount in ₹', ' – Value (₹)'], ['rating', 'a quality score out of 10', ' – Quality Score']];
const LEVELS: [string, string][] = [['executive', 'Executive'], ['lead', 'Lead / coordinator'], ['manager', 'Manager'], ['head', 'Head']];

/** Split a standard KPI name back into "what is measured" + "how", so editing uses the same form as adding. */
function parseName(k: Cat) {
  for (const [code, , suffix] of MEASURES) if (k.name.endsWith(suffix)) return { subject: k.name.slice(0, -suffix.length), measure: code };
  return { subject: k.name, measure: 'count' };
}

/** HR/Admin: the KPI library (add and edit with one form), who holds which KPIs, and a department roll-up. */
export function KpiAdmin(_props: { me: Me }) {
  const cat = useLoad(() => rpc<Cat[]>('kpi_catalogue', {}), []);
  const [tab, setTab] = useState<'library' | 'defaults' | 'depts' | 'people' | 'rollup'>('defaults');
  const [editing, setEditing] = useState<string | null>(null);
  const [dept, setDept] = useState('');
  const list = (cat.data ?? []) as Cat[];
  const depts = useMemo(() => [...new Set(list.map((k) => k.department))].sort(), [list]);
  const shown = list.filter((k) => !dept || k.department === dept);
  const byDept = useMemo(() => { const m: Record<string, Cat[]> = {}; for (const k of shown) (m[k.department] ??= []).push(k); return m; }, [shown]);
  const TABS: [typeof tab, string][] = [['defaults', 'Default scorecards'], ['library', 'KPI library'], ['depts', 'Departments'], ['people', 'Who has what'], ['rollup', 'Roll-up']];
  return (
    <div className="stack">
      <div className="segbtns">{TABS.map(([k, l]) => <button key={k} className={`btn sm${tab === k ? ' primary' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>

      {tab === 'defaults' && <Defaults />}

      {tab === 'library' && <>
        <Card title="Add a KPI" help="Say what is measured and how. The name is built for you so every KPI reads the same way. Editing a KPI below uses this same form.">
          <KpiForm depts={depts} onDone={cat.reload} />
        </Card>
        <label className="field" style={{ maxWidth: 300 }}>Show department
          <select className="input" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All departments</option>{depts.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
        {cat.loading ? <Loading rows={3} /> : cat.error ? <ErrorBox error={cat.error} retry={cat.reload} />
          : shown.length === 0 ? <Card><Empty>No KPIs yet.</Empty></Card>
          : Object.entries(byDept).map(([d, ks]) => <Card key={d} title={`${d} · ${ks.length}`} collapsible collapseKey={`kpilib-${d}`}>
              <div className="stack">{ks.map((k) => <div key={k.id} className="kpirow">
                <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}><b>{k.name}</b>{!k.active && <span className="pill warn small" style={{ marginLeft: 6 }}>hidden</span>}{k.auto && <span className="pill info small" style={{ marginLeft: 6 }}>automatic</span>}
                    <div className="small muted">{k.description ?? 'No description'}</div>
                    <div className="small muted">{k.higher_better ? 'higher is better' : 'lower is better'} · fits {k.levels.length ? k.levels.join(', ') : 'all levels'} · {k.assignees} {k.assignees === 1 ? 'person has' : 'people have'} it</div></div>
                  <button className="btn sm" onClick={() => setEditing(editing === k.id ? null : k.id)}>{editing === k.id ? 'Close' : 'Edit'}</button>
                </div>
                {editing === k.id && <div className="panel"><KpiForm depts={depts} initial={k} onDone={() => { setEditing(null); cat.reload(); }} onCancel={() => setEditing(null)} /></div>}
              </div>)}</div></Card>)}
      </>}

      {tab === 'depts' && <><Departments onChange={cat.reload} /><Card title="Designations by department" help="Each department has its own ladder. When a person is added, only their department's designations and the common ones are offered. A manager can add only designations of their own department, below their own level."><DesignationMap /></Card></>}
      {tab === 'people' && <><HowKpisWork /><TeamSetup /></>}
      {tab === 'rollup' && <Rollup depts={depts} />}
    </div>
  );
}

type Dept = { name: string; head_id: string | null; head: string | null; kpis: number; people: { person_id: string; full_name: string; designation: string | null; fixed: boolean }[] };

/** Departments: add one, see who is in it, move a person into it. */
function Departments({ onChange }: { onChange: () => void }) {
  const d = useLoad(() => rpc<Dept[]>('departments_list', {}), []);
  const [name, setName] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null); const [ok, setOk] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const list = (d.data ?? []) as Dept[];
  const everyone = useMemo(() => list.flatMap((x) => x.people.map((p) => ({ ...p, dept: x.name }))), [list]);
  async function add() {
    setBusy(true); setErr(null); setOk('');
    try { const r = await rpc<any>('department_add', { p_name: name }); setOk(`${r.name} added. Now add people to it.`); setOpen(r.name); setName(''); d.reload(); onChange(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <div className="stack">
      <Card title="Add a department" help="1. Add the department. 2. Add people to it. 3. Under 'Who has what', set each person's KPIs — the manager can add the department's first KPIs there.">
        <div className="kpiform">
          <label className="field" style={{ flex: 1, minWidth: 220 }}>Department name<input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Business Communication" /></label>
          <button className="btn primary" disabled={busy || name.trim().length < 2} onClick={add}>{busy ? 'Adding…' : 'Add department'}</button>
        </div>
        {ok && <div className="banner ok small" style={{ marginTop: 8 }}>{ok}</div>}
        {err ? <div className="banner bad" style={{ marginTop: 8 }}>{errText(err)}</div> : null}
      </Card>
      {d.loading ? <Loading rows={3} /> : d.error ? <ErrorBox error={d.error} retry={d.reload} /> : list.map((x) => <div key={x.name} className="scperson">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 180 }}><b>{x.name}</b><div className="small muted">{x.head ? `Headed by ${x.head}` : 'No head set'} · {x.people.length} {x.people.length === 1 ? 'person' : 'people'} · {x.kpis} KPI{x.kpis === 1 ? '' : 's'} in the library</div></div>
          <HeadPicker dept={x} everyone={everyone} onDone={d.reload} />
          <button className="btn sm" onClick={() => setOpen(open === x.name ? null : x.name)}>{open === x.name ? 'Close' : 'People'}</button>
        </div>
        {open === x.name && <DeptPeople dept={x} everyone={everyone} onChange={d.reload} />}
      </div>)}
    </div>
  );
}

/** Who heads a department (D-146). */
function HeadPicker({ dept, everyone, onDone }: { dept: Dept; everyone: { person_id: string; full_name: string }[]; onDone: () => void }) {
  const [err, setErr] = useState<unknown>(null);
  const people = useMemo(() => [...new Map(everyone.map((p) => [p.person_id, p])).values()].sort((a, b) => a.full_name.localeCompare(b.full_name)), [everyone]);
  return <label className="field small" style={{ minWidth: 200 }}>Head
    <select value={dept.head_id ?? ''} aria-label={`Head of ${dept.name}`} onChange={async (e) => { setErr(null); try { await rpc('department_head_set', { p_department: dept.name, p_person: e.target.value || null }); onDone(); } catch (x) { setErr(x); } }}>
      <option value="">No head</option>{people.map((p) => <option key={p.person_id} value={p.person_id}>{p.full_name}</option>)}</select>
    {err ? <span className="small" style={{ color: 'var(--bad)' }}>{errText(err)}</span> : null}</label>;
}

/** Department default scorecards (D-144): what a person gets until their manager chooses otherwise. */
function Defaults() {
  const d = useLoad(() => rpc<any>('scorecard_defaults', {}), []);
  const [busy, setBusy] = useState(''); const [msg, setMsg] = useState<Record<string, string>>({}); const [err, setErr] = useState<unknown>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  async function act(key: string, fn: () => Promise<string>) { setBusy(key); setErr(null); try { const m = await fn(); setMsg({ ...msg, [key]: m }); d.reload(); } catch (e) { setErr(e); } finally { setBusy(''); } }
  const data = d.data;
  return (
    <div className="stack">
      <Card title="How defaults work" help="Defaults never overwrite a scorecard a manager has already set.">
        <p className="small" style={{ margin: 0 }}>Each department can have a default scorecard: 3 to 5 KPIs with targets and 3 to 5 attributes. Use <b>Give to everyone without KPIs</b> to put it on people who have nothing yet. A manager can change any person's scorecard afterwards under KPIs → My team. To change a default, set one person's scorecard the way you want it and use <b>Make this the default</b>.</p>
        {data && <label className="row small" style={{ marginTop: 10, gap: 8 }}><input type="checkbox" checked={data.auto} disabled={busy === 'auto'}
          onChange={(e) => act('auto', async () => { await rpc('scorecard_defaults_auto', { p_on: e.target.checked }); return ''; })} />New people get their department's default by themselves (checked every few minutes)</label>}
      </Card>
      {err ? <div className="banner bad">{errText(err)}</div> : null}
      {d.loading ? <Loading rows={3} /> : d.error ? <ErrorBox error={d.error} retry={d.reload} /> : (data?.departments ?? []).map((x: any) => (
        <Card key={x.department} title={x.department}>
          {x.kpis.length === 0 ? <p className="small muted" style={{ margin: 0 }}>No default yet.</p>
            : <div className="stack" style={{ gap: 4 }}>{x.kpis.map((k: any) => <div key={k.kpi_id} className="row small" style={{ justifyContent: 'space-between' }}>
                <span>{k.name}{k.auto && <span className="pill info small" style={{ marginLeft: 6 }}>automatic</span>}</span><b>{k.higher_better ? '≥' : '≤'} {k.target}{/%/.test(k.name) ? '%' : ''}</b></div>)}
                {x.attributes.length > 0 && <div className="small muted">Attributes: {x.attributes.join(', ')}</div>}</div>}
          <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            {x.kpis.length > 0 && <button className="btn sm primary" disabled={!!busy || x.without === 0}
              onClick={() => act('apply:' + x.department, async () => { const r = await rpc<any>('scorecard_defaults_apply', { p_department: x.department }); return `Given to ${r.applied} ${r.applied === 1 ? 'person' : 'people'}.`; })}>
              {x.without === 0 ? 'Everyone has KPIs' : `Give to everyone without KPIs (${x.without})`}</button>}
            {x.ready.length > 0 && <><select value={pick[x.department] ?? ''} onChange={(e) => setPick({ ...pick, [x.department]: e.target.value })} aria-label={`Person whose scorecard becomes the ${x.department} default`}>
              <option value="">Copy a person's scorecard…</option>{x.ready.map((p: any) => <option key={p.person_id} value={p.person_id}>{p.full_name}</option>)}</select>
              <button className="btn sm" disabled={!!busy || !pick[x.department]} onClick={() => act('from:' + x.department, async () => { await rpc('scorecard_default_from', { p_person: pick[x.department] }); return 'Default updated.'; })}>Make this the default</button></>}
            {Object.entries(msg).filter(([k]) => k.endsWith(':' + x.department)).map(([k, m]) => m && <span key={k} className="pill ok small">{m}</span>)}
          </div>
        </Card>))}
    </div>
  );
}

function DeptPeople({ dept, everyone, onChange }: { dept: Dept; everyone: { person_id: string; full_name: string; designation: string | null; dept: string }[]; onChange: () => void }) {
  const [q, setQ] = useState(''); const [busy, setBusy] = useState(''); const [err, setErr] = useState<unknown>(null);
  const choices = q.trim().length < 2 ? [] : everyone.filter((p) => p.dept !== dept.name && p.full_name.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  async function move(pid: string) {
    setBusy(pid); setErr(null);
    try { await rpc('person_set_department', { p_person: pid, p_department: dept.name }); setQ(''); onChange(); } catch (e) { setErr(e); } finally { setBusy(''); }
  }
  return (
    <div className="panel stack">
      {dept.people.length === 0 ? <p className="muted small" style={{ margin: 0 }}>No one is in this department yet.</p>
        : <div className="attachrow">{dept.people.map((p) => <span key={p.person_id} className="attachchip pending">{p.full_name}{p.designation ? <span className="muted"> · {p.designation}</span> : null}</span>)}</div>}
      <label className="field">Add a person to {dept.name}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name" /></label>
      {choices.length > 0 && <div className="stack" style={{ gap: 4 }}>{choices.map((p) => <div key={p.person_id} className="row small">
        <span style={{ flex: 1 }}>{p.full_name} <span className="muted">· now in {p.dept}</span></span>
        <button className="btn sm primary" disabled={busy === p.person_id} onClick={() => move(p.person_id)}>{busy === p.person_id ? 'Moving…' : `Move to ${dept.name}`}</button></div>)}</div>}
      {q.trim().length >= 2 && choices.length === 0 && <span className="muted small">No match outside this department.</span>}
      {err ? <div className="banner bad">{errText(err)}</div> : null}
    </div>
  );
}

/** One form for both adding and editing a KPI. */
function KpiForm({ depts, initial, onDone, onCancel }: { depts: string[]; initial?: Cat; onDone: () => void; onCancel?: () => void }) {
  const p = initial ? parseName(initial) : { subject: '', measure: 'count' };
  const [f, setF] = useState({ department: initial?.department ?? '', subject: p.subject, measure: p.measure, unit: initial?.unit === 'hours' ? 'hours' : 'days',
    higher: initial ? initial.higher_better : true, levels: initial?.levels ?? [] as string[], description: initial?.description ?? '', active: initial?.active ?? true });
  const [name, setName] = useState<string | null>(initial?.name ?? null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null); const [ok, setOk] = useState('');
  const auto = !!initial?.auto;
  useEffect(() => {
    if (f.subject.trim().length < 3 || !f.department.trim()) { setName(null); return; }
    const t = setTimeout(() => { rpc<any>('kpi_custom_add', { p_department: f.department, p_subject: f.subject, p_measure: f.measure, p_time_unit: f.unit, p_preview: true }).then((r) => setName(r.name)).catch(() => setName(null)); }, 400);
    return () => clearTimeout(t);
  }, [f.subject, f.measure, f.department, f.unit]);
  const toggleLevel = (l: string) => setF({ ...f, levels: f.levels.includes(l) ? f.levels.filter((x) => x !== l) : [...f.levels, l] });
  async function save() {
    setBusy(true); setErr(null); setOk('');
    try {
      await rpc('kpi_upsert', { p_kpi: initial?.id ?? null, p_department: f.department.trim(), p_subject: f.subject, p_measure: f.measure, p_time_unit: f.unit,
        p_higher_better: f.higher, p_levels: f.levels, p_description: f.description.trim() || null, p_active: f.active });
      if (!initial) { setOk('Added.'); setF({ ...f, subject: '', description: '' }); }
      onDone();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const id = initial?.id ?? 'new';
  return (
    <div className="stack">
      <div className="kpiform">
        <label className="field" style={{ flex: 1, minWidth: 180 }}>Department
          <input list={`kd-${id}`} value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} placeholder="Pick or type a new one" />
          <datalist id={`kd-${id}`}>{depts.map((d) => <option key={d} value={d} />)}</datalist></label>
        <label className="field" style={{ flex: 2, minWidth: 220 }}>What is measured?
          <input value={f.subject} maxLength={80} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="e.g. vendor bills checked" /></label>
      </div>
      <div className="kpiform">
        <label className="field">It is<select className="input" value={f.measure} disabled={auto} onChange={(e) => setF({ ...f, measure: e.target.value, higher: e.target.value !== 'time' })}>{MEASURES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        {f.measure === 'time' && <label className="field">In<select className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}><option value="days">days</option><option value="hours">hours</option></select></label>}
        <label className="field">Better when<select className="input" value={f.higher ? '1' : '0'} disabled={auto} onChange={(e) => setF({ ...f, higher: e.target.value === '1' })}><option value="1">higher</option><option value="0">lower</option></select></label>
        {initial && <label className="field">Shown to managers<select className="input" value={f.active ? '1' : '0'} onChange={(e) => setF({ ...f, active: e.target.value === '1' })}><option value="1">Yes</option><option value="0">No — hide it</option></select></label>}
      </div>
      <div className="field">Fits which roles? <span className="small muted">(none ticked = all)</span>
        <div className="segbtns">{LEVELS.map(([v, l]) => <button key={v} type="button" aria-pressed={f.levels.includes(v)} className={`btn sm${f.levels.includes(v) ? ' primary' : ''}`} onClick={() => toggleLevel(v)}>{l}</button>)}</div></div>
      <label className="field">Short description — what counts<input value={f.description} maxLength={160} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="One line a manager will read" /></label>
      {auto && <div className="small muted">This KPI is counted automatically from daily updates, so how it is measured cannot change.</div>}
      {name && <div className="banner info small">Name: <b>{name}</b></div>}
      {err ? <div className="banner bad">{errText(err)}</div> : null}
      <div className="row"><button className="btn primary" disabled={busy || !name} onClick={save}>{busy ? 'Saving…' : initial ? 'Save changes' : 'Add KPI'}</button>
        {onCancel && <button className="btn" onClick={onCancel}>Cancel</button>}{ok && <span className="pill ok small">{ok}</span>}</div>
    </div>
  );
}

function Rollup({ depts }: { depts: string[] }) {
  const [dept, setDept] = useState(depts[0] ?? '');
  const d = useLoad(() => (dept ? rpc<any[]>('kpi_rollup', { p_department: dept }) : Promise.resolve([])), [dept]);
  const kpis = ((d.data ?? []) as any[]).filter((k) => (k.rows ?? []).length > 0);
  return (
    <Card title="Department roll-up" help="This period's plan and done for each KPI that someone holds.">
      <label className="field" style={{ maxWidth: 300 }}>Department
        <select className="input" value={dept} onChange={(e) => setDept(e.target.value)}>
          {depts.length === 0 && <option value="">No KPIs yet</option>}
          {depts.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      {d.loading ? <Loading rows={2} /> : kpis.length === 0 ? <Empty>No one in this department holds a KPI yet.</Empty> :
        kpis.map((k) => <div key={k.kpi_id} className="kpirow">
          <div><b>{k.name}</b> <span className="muted small">{k.unit ?? ''}</span></div>
          <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Person</th><th className="num">Target</th><th className="num">Planned</th><th className="num">Done</th><th className="num">%</th></tr></thead>
            <tbody>{k.rows.map((r: any) => <tr key={r.person_id}><td>{r.full_name}</td><td className="num">{r.target ?? '—'}</td><td className="num">{r.planned ?? '—'}</td><td className="num">{r.actual ?? '—'}</td>
              <td className="num">{r.commitment == null ? '—' : <span className={`pill ${r.commitment >= 90 ? 'ok' : r.commitment >= 60 ? 'warn' : 'bad'} small`}>{r.commitment}%</span>}</td></tr>)}</tbody></table></div>
        </div>)}
    </Card>
  );
}
