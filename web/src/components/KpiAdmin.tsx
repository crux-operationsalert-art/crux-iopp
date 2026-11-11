import { useMemo, useState } from 'react';
import { Me, rpc, select, errText } from '../lib/api';
import { Card, Empty, ErrorBox, Loading, useLoad } from './ui';


type Cat = { id: string; department: string; name: string; unit: string | null; cadence: string; higher_better: boolean; active: boolean; assignees: number };
type Person = { id: string; full_name: string; designation: string | null };

/** HR/Admin: define KPIs for any department, assign them to people, and see a department roll-up (D-118). */
export function KpiAdmin(_props: { me: Me }) {
  const cat = useLoad(() => rpc<Cat[]>('kpi_catalogue', {}), []);
  const depts = useLoad(() => rpc<string[]>('kpi_departments', {}), []);
  const people = useLoad(() => select<Person>('persons', 'id,full_name,designation', (b) => b.neq('status', 'exited').order('full_name')), []);
  const [tab, setTab] = useState<'define' | 'rollup'>('define');
  const list = (cat.data ?? []) as Cat[];
  const byDept = useMemo(() => { const m: Record<string, Cat[]> = {}; for (const k of list) (m[k.department] ??= []).push(k); return m; }, [list]);
  const reload = () => { cat.reload(); depts.reload(); };
  return (
    <div className="stack">
      <div className="row"><b>KPIs</b><span className="muted small">Define a department's KPIs, assign them with targets, and track like operations.</span>
        <span className="spacer" /><div className="segbtns">
          <button className={`btn sm${tab === 'define' ? ' primary' : ''}`} onClick={() => setTab('define')}>Define & assign</button>
          <button className={`btn sm${tab === 'rollup' ? ' primary' : ''}`} onClick={() => setTab('rollup')}>Roll-up</button></div></div>

      {tab === 'define' ? <>
        <Card title="Add a KPI"><DefineForm depts={(depts.data ?? []) as string[]} onAdded={reload} /></Card>
        {cat.loading ? <Loading rows={3} /> : cat.error ? <ErrorBox error={cat.error} retry={cat.reload} />
          : list.length === 0 ? <Card><Empty>No KPIs defined yet.</Empty></Card>
          : Object.entries(byDept).map(([dept, ks]) => <Card key={dept} title={dept}>
              <div className="stack">{ks.map((k) => <CatRow key={k.id} k={k} people={(people.data ?? []) as Person[]} onChange={reload} />)}</div></Card>)}
      </> : <Rollup depts={(depts.data ?? []) as string[]} />}
    </div>
  );
}

function DefineForm({ depts, onAdded }: { depts: string[]; onAdded: () => void }) {
  const [f, setF] = useState({ department: '', name: '', unit: '', cadence: 'monthly', higher_better: true });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null); const [ok, setOk] = useState('');
  async function add() {
    setBusy(true); setErr(null); setOk('');
    try {
      await rpc('kpi_define', { p_department: f.department.trim(), p_name: f.name.trim(), p_unit: f.unit.trim() || null, p_cadence: f.cadence, p_higher_better: f.higher_better });
      setOk('KPI added.'); setF({ ...f, name: '', unit: '' }); onAdded();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <div className="stack">
      <div className="kpiform">
        <label className="field" style={{ flex: 1, minWidth: 150 }}>Department
          <input list="kpi-depts" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} placeholder="e.g. Finance" />
          <datalist id="kpi-depts">{depts.map((d) => <option key={d} value={d} />)}</datalist></label>
        <label className="field" style={{ flex: 1, minWidth: 150 }}>KPI name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Invoices processed" /></label>
        <label className="field">Unit<input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="invoices" style={{ width: 110 }} /></label>
        <label className="field">Cadence<select className="input" value={f.cadence} onChange={(e) => setF({ ...f, cadence: e.target.value })}>
          <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
        <label className="field">Direction<select className="input" value={f.higher_better ? '1' : '0'} onChange={(e) => setF({ ...f, higher_better: e.target.value === '1' })}>
          <option value="1">Higher is better</option><option value="0">Lower is better</option></select></label>
      </div>
      <div className="row"><button className="btn primary" disabled={busy || !f.department.trim() || !f.name.trim()} onClick={add}>{busy ? 'Adding…' : 'Add KPI'}</button>{ok && <span className="pill ok small">{ok}</span>}</div>
      {err ? <div className="banner bad">{errText(err)}</div> : null}
    </div>
  );
}

function CatRow({ k, people, onChange }: { k: Cat; people: Person[]; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function toggleActive() { setBusy(true); try { await rpc('kpi_set_active', { p_kpi: k.id, p_active: !k.active }); onChange(); } finally { setBusy(false); } }
  return (
    <div className="kpirow">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div><b>{k.name}</b> {k.unit && <span className="muted small">({k.unit})</span>}
          <div className="small muted">{k.cadence} · {k.higher_better ? 'higher better' : 'lower better'} · {k.assignees} assigned{!k.active ? ' · inactive' : ''}</div></div>
        <div className="row">
          <button className="btn sm" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Assign'}</button>
          <button className="btn sm" disabled={busy} onClick={toggleActive}>{k.active ? 'Deactivate' : 'Activate'}</button>
        </div>
      </div>
      {open && <Assigner kpi={k} people={people} onChange={onChange} />}
    </div>
  );
}

function Assigner({ kpi, people, onChange }: { kpi: Cat; people: Person[]; onChange: () => void }) {
  const a = useLoad(() => rpc<{ person_id: string; full_name: string; designation: string | null; target: number | null }[]>('kpi_assignees', { p_kpi: kpi.id }), [kpi.id]);
  const [person, setPerson] = useState(''); const [target, setTarget] = useState(''); const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const assigned = new Set((a.data ?? []).map((x) => x.person_id));
  const choices = people.filter((p) => !assigned.has(p.id) && (!q || p.full_name.toLowerCase().includes(q.toLowerCase()))).slice(0, 8);
  async function assign() {
    if (!person) return; setBusy(true); setErr(null);
    try { await rpc('kpi_assign', { p_person: person, p_kpi: kpi.id, p_target: target === '' ? null : Number(target) }); setPerson(''); setTarget(''); setQ(''); a.reload(); onChange(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }
  async function remove(pid: string) { await rpc('kpi_unassign', { p_person: pid, p_kpi: kpi.id }); a.reload(); onChange(); }
  return (
    <div className="panel stack">
      {a.loading ? <Loading rows={1} /> : (a.data ?? []).length === 0 ? <p className="muted small">No one assigned yet.</p> :
        <div className="attachrow">{(a.data ?? []).map((x) => <span key={x.person_id} className="attachchip">{x.full_name}{x.target != null ? ` · ${x.target}` : ''}
          <button className="rm" aria-label={`Remove ${x.full_name}`} onClick={() => remove(x.person_id)}>✕</button></span>)}</div>}
      <div className="kpiform">
        <label className="field" style={{ flex: 1, minWidth: 160 }}>Add person<input value={q} onChange={(e) => { setQ(e.target.value); setPerson(''); }} placeholder="Search name" /></label>
        <label className="field">Target<input type="number" value={target} onChange={(e) => setTarget(e.target.value)} className="num" style={{ width: 90 }} /></label>
      </div>
      {q && !person && <div className="attachrow">{choices.map((p) => <button key={p.id} className={`btn sm${person === p.id ? ' primary' : ''}`} onClick={() => { setPerson(p.id); setQ(p.full_name); }}>{p.full_name}</button>)}
        {choices.length === 0 && <span className="muted small">No match.</span>}</div>}
      <div className="row"><button className="btn sm primary" disabled={busy || !person} onClick={assign}>{busy ? 'Assigning…' : 'Assign'}</button></div>
      {err ? <div className="banner bad">{errText(err)}</div> : null}
    </div>
  );
}

function Rollup({ depts }: { depts: string[] }) {
  const [dept, setDept] = useState(depts[0] ?? '');
  const d = useLoad(() => (dept ? rpc<any[]>('kpi_rollup', { p_department: dept }) : Promise.resolve([])), [dept]);
  const kpis = (d.data ?? []) as any[];
  return (
    <Card title="Department roll-up">
      <label className="field" style={{ maxWidth: 260 }}>Department
        <select className="input" value={dept} onChange={(e) => setDept(e.target.value)}>
          {depts.length === 0 && <option value="">No KPIs yet</option>}
          {depts.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      {d.loading ? <Loading rows={2} /> : kpis.length === 0 ? <Empty>Nothing to show.</Empty> :
        kpis.map((k) => <div key={k.kpi_id} className="kpirow">
          <div><b>{k.name}</b> <span className="muted small">{k.cadence} · {k.unit ?? ''}</span></div>
          {(k.rows ?? []).length === 0 ? <p className="muted small">No one assigned.</p> :
            <div className="tablewrap"><table><thead><tr><th>Person</th><th className="num">Target</th><th className="num">Planned</th><th className="num">Done</th><th className="num">%</th></tr></thead>
              <tbody>{k.rows.map((r: any) => <tr key={r.person_id}><td>{r.full_name}</td><td className="num">{r.target ?? '—'}</td><td className="num">{r.planned ?? '—'}</td><td className="num">{r.actual ?? '—'}</td>
                <td className="num">{r.commitment == null ? '—' : <span className={`pill ${r.commitment >= 90 ? 'ok' : r.commitment >= 60 ? 'warn' : 'bad'} small`}>{r.commitment}%</span>}</td></tr>)}</tbody></table></div>}
        </div>)}
    </Card>
  );
}
