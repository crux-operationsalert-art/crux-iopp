import { useState } from 'react';
import { rpc } from '../lib/api';
import { ErrorBox, useLoad } from './ui';

export type DesigOpt = { name: string; rank: number; default_role: string };
type Options = { admin: boolean; my_department: string | null; departments: string[]; designations: DesigOpt[] };

/** Designation (from the approved list) and department for a new person. The server applies the same rules. */
export function DesignationFields({ designation, department, onChange }: {
  designation: string; department: string; onChange: (v: { designation: string; department: string; role?: string }) => void }) {
  const o = useLoad(() => rpc<Options>('designation_options'), []);
  const [nw, setNw] = useState({ name: '', like: '' });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const d = o.data;
  const list = d?.designations ?? [];
  const dept = d?.admin ? department : d?.my_department ?? '';

  async function addNew() {
    setBusy(true); setErr(null);
    try {
      const r = await rpc<{ name: string }>('designation_add', { p_name: nw.name, p_level_with: nw.like });
      const like = list.find((x) => x.name === nw.like);
      o.reload(); setNw({ name: '', like: '' });
      onChange({ designation: r.name, department: dept, role: like && !['zm', 'bm', 'ba'].includes(like.default_role) ? like.default_role : undefined });
    } catch (x) { setErr(x); } finally { setBusy(false); }
  }

  return (
    <>
      <label className="field">Designation
        <select required value={designation} onChange={(e) => onChange({ designation: e.target.value, department: dept, role: list.find((x) => x.name === e.target.value)?.default_role })}>
          <option value="">Choose…</option>
          {list.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
        </select>
        <span className="small muted">{!d ? ' ' : d.admin ? 'Most senior first. Not listed? Add it below.'
          : list.length ? 'Only designations below your own. HR/Admin can add a new one.' : 'There is no designation below yours to add. Ask HR/Admin.'}</span>
      </label>
      <label className="field">Department
        {d?.admin
          ? <select value={department} onChange={(e) => onChange({ designation, department: e.target.value })}>
              <option value="">Decide later</option>{d.departments.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          : <input readOnly value={dept || '—'} aria-label="Department" />}
        <span className="small muted">{!d ? ' ' : d.admin ? 'New department? Admin → KPIs → Departments.' : 'People you add join your own department.'}</span>
      </label>
      {d?.admin && (
        <details className="field" style={{ gridColumn: '1 / -1' }}>
          <summary className="small" style={{ cursor: 'pointer' }}>Add a new designation to the approved list</summary>
          <div className="grid two" style={{ marginTop: 8 }}>
            <label className="field">Designation name<input value={nw.name} placeholder="e.g. Principal Consultant" onChange={(e) => setNw({ ...nw, name: e.target.value })} /></label>
            <label className="field">Same level as
              <select value={nw.like} onChange={(e) => setNw({ ...nw, like: e.target.value })}><option value="">Choose…</option>{list.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}</select>
              <span className="small muted">This sets where it sits in the seniority order.</span></label>
          </div>
          <ErrorBox error={err} />
          <button type="button" className="btn" disabled={busy || nw.name.trim().length < 2 || !nw.like} onClick={addNew}>{busy ? 'Adding…' : 'Add designation'}</button>
        </details>)}
    </>
  );
}
