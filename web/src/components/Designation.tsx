import { useState } from 'react';
import { rpc } from '../lib/api';
import { ErrorBox, useLoad } from './ui';

export type DesigOpt = { name: string; rank: number; default_role: string; departments?: string[] };
type Options = { admin: boolean; my_department: string | null; departments: string[]; designations: DesigOpt[] };

/** Designation (from the approved list) and department for a new person. The server applies the same rules. */
export function DesignationFields({ designation, department, onChange }: {
  designation: string; department: string; onChange: (v: { designation: string; department: string; role?: string }) => void }) {
  const o = useLoad(() => rpc<Options>('designation_options'), []);
  const [nw, setNw] = useState({ name: '', like: '', only: true });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const d = o.data;
  const all = d?.designations ?? [];
  const dept = d?.admin ? department : d?.my_department ?? '';
  // a designation with no department listed is common to all; otherwise it shows only for its departments (D-135)
  const list = all.filter((x) => !dept || !x.departments?.length || x.departments.includes(dept) || x.name === designation);

  async function addNew() {
    setBusy(true); setErr(null);
    try {
      const r = await rpc<{ name: string }>('designation_add', { p_name: nw.name, p_level_with: nw.like });
      const like = all.find((x) => x.name === nw.like);
      if (nw.only && dept) await rpc('designation_map_set', { p_designation: r.name, p_department: dept, p_on: true });
      o.reload(); setNw({ name: '', like: '', only: true });
      onChange({ designation: r.name, department: dept, role: like && !['zm', 'bm', 'ba'].includes(like.default_role) ? like.default_role : undefined });
    } catch (x) { setErr(x); } finally { setBusy(false); }
  }

  return (
    <>
      <label className="field">Department
        {d?.admin
          ? <select value={department} onChange={(e) => { const nd = e.target.value; const keep = all.find((x) => x.name === designation); onChange({ designation: keep && nd && keep.departments?.length && !keep.departments.includes(nd) ? '' : designation, department: nd }); }}>
              <option value="">Decide later</option>{d.departments.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          : <input readOnly value={dept || '—'} aria-label="Department" />}
        <span className="small muted">{!d ? ' ' : d.admin ? 'New department? Admin → KPIs → Departments.' : 'People you add join your own department.'}</span>
      </label>
      <label className="field">Designation
        <select required value={designation} onChange={(e) => onChange({ designation: e.target.value, department: dept, role: list.find((x) => x.name === e.target.value)?.default_role })}>
          <option value="">Choose…</option>
          {list.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
        </select>
        <span className="small muted">{!d ? ' ' : d.admin ? (dept ? `Designations for ${dept}, most senior first. Not listed? Add it below.` : 'Most senior first. Pick the department to see only its designations.')
          : list.length ? 'Only designations below your own. HR/Admin can add a new one.' : 'There is no designation below yours to add. Ask HR/Admin.'}</span>
      </label>
      {d?.admin && (
        <details className="field" style={{ gridColumn: '1 / -1' }}>
          <summary className="small" style={{ cursor: 'pointer' }}>Add a new designation to the approved list</summary>
          <div className="grid two" style={{ marginTop: 8 }}>
            <label className="field">Designation name<input value={nw.name} placeholder="e.g. Principal Consultant" onChange={(e) => setNw({ ...nw, name: e.target.value })} /></label>
            <label className="field">Same level as
              <select value={nw.like} onChange={(e) => setNw({ ...nw, like: e.target.value })}><option value="">Choose…</option>{all.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}</select>
              <span className="small muted">This sets where it sits in the seniority order.</span></label>
          </div>
          {dept && <label className="row small" style={{ gap: 8, margin: '6px 0' }}><input type="checkbox" style={{ width: 'auto', minHeight: 0 }} checked={nw.only} onChange={(e) => setNw({ ...nw, only: e.target.checked })} />
            <span>Only for {dept} (untick to use it in every department)</span></label>}
          <ErrorBox error={err} />
          <button type="button" className="btn" disabled={busy || nw.name.trim().length < 2 || !nw.like} onClick={addNew}>{busy ? 'Adding…' : 'Add designation'}</button>
        </details>)}
    </>
  );
}

/** Admin/HR: which designations each department uses. A designation ticked for no department is offered in all of them. */
export function DesignationMap() {
  const o = useLoad(() => rpc<Options>('designation_options'), []);
  const [dept, setDept] = useState(''); const [busy, setBusy] = useState(''); const [err, setErr] = useState<unknown>(null);
  if (!o.data) return o.error ? <ErrorBox error={o.error} retry={o.reload} /> : null;
  const d = o.data; const cur = dept || d.departments[0] || '';
  const mine = d.designations.filter((x) => x.departments?.includes(cur)), common = d.designations.filter((x) => !x.departments?.length), others = d.designations.filter((x) => x.departments?.length && !x.departments.includes(cur));
  const set = async (name: string, on: boolean) => { setBusy(name); setErr(null); try { await rpc('designation_map_set', { p_designation: name, p_department: cur, p_on: on }); o.reload(); } catch (e) { setErr(e); } finally { setBusy(''); } };
  const chip = (x: DesigOpt, on: boolean) => <button key={x.name} className={`btn sm${on ? ' primary' : ''}`} aria-pressed={on} disabled={busy === x.name} onClick={() => set(x.name, !on)} title={on ? 'Remove from this department' : 'Add to this department'}>{x.name}</button>;
  return (
    <div className="stack">
      <label className="field" style={{ maxWidth: 360 }}>Department<select value={cur} onChange={(e) => setDept(e.target.value)}>{d.departments.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      <ErrorBox error={err} />
      <div className="field">Designations of {cur} — tap to remove<div className="segbtns">{mine.length ? mine.map((x) => chip(x, true)) : <span className="small muted">None yet. Add from the lists below.</span>}</div></div>
      <div className="field">Common to every department<div className="segbtns">{common.map((x) => <span key={x.name} className="pill neutral">{x.name}</span>)}</div>
        <span className="small muted">Leadership and general titles. Tapping one in “Other departments” style is not needed; these are always offered.</span></div>
      <div className="field">Used by other departments — tap to also use in {cur}<div className="segbtns">{others.map((x) => chip(x, false))}</div></div>
      <p className="small muted" style={{ margin: 0 }}>A new designation is added from the Add a team member form (“Add a new designation to the approved list”), where you place it level with an existing one.</p>
    </div>
  );
}

/** A designation box that suggests the approved designations while typing (for editing an existing person). */
export function DesignationInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const o = useLoad(() => rpc<Options>('designation_options'), []);
  return (<>
    <input required value={value} list="approved-designations" onChange={(e) => onChange(e.target.value)} />
    <datalist id="approved-designations">{(o.data?.designations ?? []).map((x) => <option key={x.name} value={x.name} />)}</datalist>
  </>);
}
