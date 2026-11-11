import { useEffect, useMemo, useState } from 'react';
import { Me, rpc, errText } from '../lib/api';
import { Card, Empty, ErrorBox, Loading, useLoad } from './ui';
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
  const [tab, setTab] = useState<'library' | 'people' | 'rollup'>('library');
  const [editing, setEditing] = useState<string | null>(null);
  const [dept, setDept] = useState('');
  const list = (cat.data ?? []) as Cat[];
  const depts = useMemo(() => [...new Set(list.map((k) => k.department))].sort(), [list]);
  const shown = list.filter((k) => !dept || k.department === dept);
  const byDept = useMemo(() => { const m: Record<string, Cat[]> = {}; for (const k of shown) (m[k.department] ??= []).push(k); return m; }, [shown]);
  const TABS: [typeof tab, string][] = [['library', 'KPI library'], ['people', 'Who has what'], ['rollup', 'Roll-up']];
  return (
    <div className="stack">
      <div className="segbtns">{TABS.map(([k, l]) => <button key={k} className={`btn sm${tab === k ? ' primary' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>

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

      {tab === 'people' && <><HowKpisWork /><TeamSetup /></>}
      {tab === 'rollup' && <Rollup depts={depts} />}
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
