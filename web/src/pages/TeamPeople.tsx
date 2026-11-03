import { FormEvent, useMemo, useState } from 'react';
import { has, Me, rpc, select } from '../lib/api';
import { label } from '../lib/format';
import { ROLE_NAMES } from '../lib/messages';
import { Card, Empty, ErrorBox, Loading, useLoad } from '../components/ui';
import { ActivationBanner } from '../components/Onboarding';

type P = { person_id: string; full_name: string; designation: string | null; mobile: string | null; email: string | null; resource_type: string;
  status: string; roles: string[]; function: string | null; manager_id: string | null; manager_name: string | null; depth: number; allocations: string[] };

/** Effective-dated range "[from,to)" contains the day. */
export const activeOn = (r: string, d: string) => { const m = /^[\[(]([^,]*),([^)\]]*)/.exec(r ?? ''); return !!m && (!m[1] || m[1] <= d) && (!m[2] || d < m[2]); };

/** Roles a person may create (the server enforces the same rule). */
function creatable(me: Me) {
  if (has(me, 'admin', 'hr_admin')) return ['executive', 'manager', 'bm', 'ba', 'zm', 'ops_head', 'collections_head', 'hr_admin', 'auditor', 'admin'];
  if (has(me, 'ops_head')) return ['zm', 'bm', 'ba', 'manager', 'executive'];
  return ['bm', 'ba', 'manager', 'executive'];
}

export default function TeamPeople({ me }: { me: Me }) {
  const people = useLoad(() => rpc<P[]>('my_team_people'), []);
  const zones = useLoad(() => select('zones', 'id,name', (b) => b.eq('active', true).order('name')), []);
  const branches = useLoad(() => select('branches', 'id,name,branch_type', (b) => b.eq('active', true).order('name')), []);
  const services = useLoad(() => select('client_locations', 'id,branch_id,valid,clients(name),locations(name)'), []);
  const roles = creatable(me);
  const blank = { name: '', mobile: '', email: '', role: roles.includes('executive') ? 'executive' : roles[0], designation: '', manager: me.person_id,
    fn: me.manages_collections && !me.manages_operations && has(me, 'collections_head') ? 'collections' : 'operations', zone: '', branch: '' };
  const [f, setF] = useState(blank);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [act, setAct] = useState<any>(null);
  const [alloc, setAlloc] = useState<P | null>(null);
  const [filter, setFilter] = useState('');

  const svc = useMemo(() => (services.data ?? []).filter((s: any) => activeOn(s.valid, me.today))
    .map((s: any) => ({ id: s.id, branch: s.branch_id, text: `${s.clients?.name} · ${s.locations?.name}` }))
    .sort((a: any, b: any) => a.text.localeCompare(b.text)), [services.data]);
  const svcShown = svc.filter((s: any) => (!f.branch || s.branch === f.branch) && s.text.toLowerCase().includes(q.toLowerCase()));
  const leaders = (people.data ?? []).filter((p) => p.roles.some((r) => !['executive'].includes(r)));
  const placeOf = () => [branches.data?.find((b: any) => b.id === f.branch)?.name, zones.data?.find((z: any) => z.id === f.zone)?.name].filter(Boolean).join(', ');

  async function add(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null); setAct(null);
    try {
      const mobile = f.mobile.replace(/\D/g, '').slice(-10);
      const p = await rpc('create_team_member', { p_full_name: f.name.trim(), p_email: f.email.trim() || null, p_mobile: mobile,
        p_resource_type: f.role === 'ba' ? 'partner' : 'own_employee', p_designation: f.designation || ROLE_NAMES[f.role], p_role: f.role,
        p_manager_id: f.manager, p_function: f.fn, p_zone_id: f.zone || null, p_branch_id: f.branch || null });
      for (const id of pick) await rpc('allocate', { p_person: p.id, p_client_location: id, p_valid_from: me.today, p_function: f.fn });
      const a = await rpc('issue_activation', { p_person: p.id });
      setAct({ ...a, role: f.role, place: placeOf(), email: f.email.trim() || null });
      setF(blank); setPick(new Set()); people.reload();
    } catch (x) { setErr(x); } finally { setBusy(false); }
  }
  async function code(p: P) {
    setErr(null);
    try { setAct({ ...(await rpc('issue_activation', { p_person: p.person_id })), role: p.roles[0], email: p.email, reset: p.status !== 'invited' }); window.scrollTo(0, 0); }
    catch (x) { setErr(x); }
  }
  const list = (people.data ?? []).filter((p) => !filter || `${p.full_name} ${p.mobile} ${p.allocations.join(' ')}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="stack">
      {act && <ActivationBanner a={act} sender={me.full_name} role={act.role} place={act.place} email={act.email} reset={act.reset} onClose={() => setAct(null)} />}
      <ErrorBox error={err} />
      <Card title="Add a team member">
        <form className="stack" onSubmit={add}>
          <div className="grid two">
            <label className="field">Full name<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label className="field">Mobile number (their login ID)<input required inputMode="tel" pattern="[0-9+ ]{10,15}" title="10-digit mobile number"
              value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></label>
            <label className="field">Role<select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              {roles.map((r) => <option key={r} value={r}>{ROLE_NAMES[r] ?? label(r)}</option>)}</select></label>
            <label className="field">Reports to<select value={f.manager} onChange={(e) => setF({ ...f, manager: e.target.value })}>
              <option value={me.person_id}>Me ({me.full_name})</option>
              {leaders.map((p) => <option key={p.person_id} value={p.person_id}>{p.full_name} · {p.roles.map((r) => ROLE_NAMES[r] ?? r).join(', ')}</option>)}</select></label>
            <label className="field">Branch {['bm', 'ba', 'executive', 'manager'].includes(f.role) ? '' : '(optional)'}<select value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })}>
              <option value="">—</option>{(branches.data ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}{b.branch_type === 'partner' ? ' (partner)' : ''}</option>)}</select></label>
            <label className="field">Zone {f.role === 'zm' ? '(required for a Zonal Manager)' : '(optional)'}<select required={f.role === 'zm'} value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })}>
              <option value="">—</option>{(zones.data ?? []).map((z: any) => <option key={z.id} value={z.id}>{z.name}</option>)}</select></label>
            <label className="field">Work type<select value={f.fn} onChange={(e) => setF({ ...f, fn: e.target.value })}><option value="operations">Operations (cases)</option><option value="collections">Collections</option></select></label>
            <label className="field">Email (optional)<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
            <label className="field">Designation (optional)<input value={f.designation} placeholder={ROLE_NAMES[f.role]} onChange={(e) => setF({ ...f, designation: e.target.value })} /></label>
          </div>
          {f.fn === 'operations' && (
            <div className="stack">
              <b>Clients & locations they will report on {pick.size > 0 && `(${pick.size} chosen)`}</b>
              <input placeholder="Search client or location…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search services" />
              <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--line, #ddd)', borderRadius: 8, padding: 8 }}>
                {services.loading ? <Loading rows={2} /> : svcShown.length === 0 ? <Empty>No services{f.branch ? ' for this branch' : ''}. Clear the branch or ask Admin to add the service.</Empty> :
                  svcShown.map((s: any) => <label key={s.id} className="small" style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}><input type="checkbox" style={{ width: 18, height: 18, flex: "none", margin: 0 }} checked={pick.has(s.id)}
                    onChange={(e) => { const n = new Set(pick); e.target.checked ? n.add(s.id) : n.delete(s.id); setPick(n); }} />{s.text}</label>)}
              </div>
              <p className="small muted">You can also add these later with “Clients” in the list below.</p>
            </div>)}
          <p className="small muted">After you press Add, a one-time activation code and a ready-to-send WhatsApp/email message appear at the top. Nobody else ever sees their password. No PAN, Aadhaar, salary or bank details are collected here.</p>
          <div><button className="btn primary" disabled={busy}>{busy ? 'Adding…' : 'Add member and get onboarding message'}</button></div>
        </form>
      </Card>

      {alloc && <AllocPanel me={me} p={alloc} svc={svc} onDone={() => { setAlloc(null); people.reload(); }} />}

      <Card title={`People in my team${people.data ? ` (${people.data.length})` : ''}`} action={<input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 160 }} aria-label="Filter people" />}>
        {people.loading ? <Loading rows={3} /> : <ErrorBox error={people.error} retry={people.reload} />}
        {people.data && (list.length === 0 ? <Empty>No team members yet.</Empty> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Name</th><th>Login (mobile)</th><th>Role · reports to</th><th>Clients & locations</th><th>Status</th><th></th></tr></thead>
            <tbody>{list.map((p) => (
              <tr key={p.person_id}>
                <td><b>{p.full_name}</b><div className="small muted">{p.designation}{p.resource_type === 'partner' ? ' · partner' : ''}</div></td>
                <td>{p.mobile ?? p.email ?? '—'}</td>
                <td className="small">{p.roles.map((r) => ROLE_NAMES[r] ?? r).join(', ')}<div className="muted">{p.manager_name ? `→ ${p.manager_name}` : ''}{p.function === 'collections' ? ' · collections' : ''}</div></td>
                <td className="small">{p.allocations.length ? p.allocations.slice(0, 4).join('; ') + (p.allocations.length > 4 ? ` +${p.allocations.length - 4}` : '') : <span className="muted">none</span>}</td>
                <td>{p.status === 'invited' ? <span className="pill warn">Not activated</span> : p.status === 'active' ? <span className="pill ok">Active</span> : <span className="pill neutral">{label(p.status)}</span>}</td>
                <td><div className="row" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn sm" onClick={() => setAlloc(p)}>Clients</button>
                  {p.status !== 'suspended' && <button className="btn sm" onClick={() => code(p)}>{p.status === 'invited' ? 'Onboarding message' : 'Reset code'}</button>}
                </div></td>
              </tr>))}</tbody></table></div>))}
      </Card>
    </div>
  );
}

function AllocPanel({ me, p, svc, onDone }: { me: Me; p: P; svc: { id: string; text: string }[]; onDone: () => void }) {
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [from, setFrom] = useState(me.today);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const shown = svc.filter((s) => !p.allocations.includes(s.text) && s.text.toLowerCase().includes(q.toLowerCase()));
  async function go() {
    setBusy(true); setErr(null);
    try { for (const id of pick) await rpc('allocate', { p_person: p.person_id, p_client_location: id, p_valid_from: from, p_function: p.function ?? 'operations' }); onDone(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Card title={`Clients & locations for ${p.full_name}`}>
      <div className="stack">
        <p className="small">Current: {p.allocations.length ? p.allocations.join('; ') : 'none'}</p>
        <div className="grid two">
          <input placeholder="Search client or location…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search services" />
          <label className="field">From date<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        </div>
        <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--line, #ddd)', borderRadius: 8, padding: 8 }}>
          {shown.map((s) => <label key={s.id} className="small" style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}><input type="checkbox" style={{ width: 18, height: 18, flex: "none", margin: 0 }} checked={pick.has(s.id)}
            onChange={(e) => { const n = new Set(pick); e.target.checked ? n.add(s.id) : n.delete(s.id); setPick(n); }} />{s.text}</label>)}
        </div>
        <p className="small muted">To stop someone working on a client, ask Admin/HR to end the allocation (history is kept).</p>
        <ErrorBox error={err} />
        <div className="row"><button className="btn primary" disabled={busy || pick.size === 0} onClick={go}>{busy ? 'Saving…' : `Add ${pick.size} allocation(s)`}</button><button className="btn" onClick={onDone}>Close</button></div>
      </div>
    </Card>
  );
}
