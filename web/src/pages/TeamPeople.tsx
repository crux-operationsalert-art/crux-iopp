import { FormEvent, lazy, ReactNode, Suspense, useMemo, useState } from 'react';
const LazyBulk = lazy(() => import('./BulkUpload').then((m) => ({ default: m.BulkUpload })));
import { has, Me, rpc, select } from '../lib/api';
import { label } from '../lib/format';
import { ROLE_NAMES } from '../lib/messages';
import { Card, Empty, ErrorBox, Loading, useLoad } from '../components/ui';
import { ActivationBanner } from '../components/Onboarding';
import { ClientPicker } from '../components/ClientPicker';

export type P = { person_id: string; full_name: string; designation: string | null; mobile: string | null; email: string | null; resource_type: string;
  status: string; roles: string[]; function: string | null; manager_id: string | null; manager_name: string | null; depth: number; allocations: string[] };

/** Effective-dated range "[from,to)" contains the day. */
export const activeOn = (r: string, d: string) => { const m = /^[\[(]([^,]*),([^)\]]*)/.exec(r ?? ''); return !!m && (!m[1] || m[1] <= d) && (!m[2] || d < m[2]); };

/** Roles a person may create (the server enforces the same rule). */
function creatable(me: Me) {
  if (has(me, 'admin', 'hr_admin')) return ['executive', 'manager', 'bm', 'ba', 'zm', 'ops_head', 'collections_head', 'hr_admin', 'auditor', 'admin'];
  if (has(me, 'ops_head')) return ['zm', 'bm', 'ba', 'manager', 'executive'];
  return ['bm', 'ba', 'manager', 'executive'];
}

/** A scrollable tick list with search, select-all and a count. */
function TickList({ title, items, picked, setPicked, hint }: { title: string; items: { id: string; text: string; sub?: string }[];
  picked: Set<string>; setPicked: (s: Set<string>) => void; hint?: ReactNode }) {
  const [q, setQ] = useState('');
  const shown = items.filter((i) => `${i.text} ${i.sub ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="stack" style={{ minWidth: 0 }}>
      <div className="row"><b>{title}</b><span className="small muted">{picked.size} chosen</span><span className="spacer" />
        <button type="button" className="btn sm" onClick={() => setPicked(new Set([...picked, ...shown.map((s) => s.id)]))}>All shown</button>
        <button type="button" className="btn sm" onClick={() => setPicked(new Set())}>Clear</button></div>
      <input placeholder={`Search ${title.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${title}`} />
      <div style={{ maxHeight: 240, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 8px' }}>
        {shown.length === 0 ? <p className="small muted">Nothing matches.</p> : shown.map((s) => (
          <label key={s.id} className="small" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
            <input type="checkbox" style={{ width: 18, height: 18, flex: 'none', margin: 0 }} checked={picked.has(s.id)}
              onChange={(e) => { const n = new Set(picked); e.target.checked ? n.add(s.id) : n.delete(s.id); setPicked(n); }} />
            <span>{s.text}{s.sub && <span className="muted"> · {s.sub}</span>}</span></label>))}
      </div>
      {hint}
    </div>
  );
}

export default function TeamPeople({ me, onEdit }: { me: Me; onEdit?: (p: P) => void }) {
  const people = useLoad(() => rpc<P[]>('my_team_people'), []);
  const zones = useLoad(() => select('zones', 'id,name', (b) => b.eq('active', true).order('name')), []);
  const branches = useLoad(() => select('branches', 'id,name,branch_type', (b) => b.eq('active', true).order('name')), []);
  const services = useLoad(() => select('client_locations', 'id,branch_id,valid,client_id,location_id,clients(name),locations(name)'), []);
  const roles = creatable(me);
  const blank = { name: '', mobile: '', email: '', role: roles.includes('executive') ? 'executive' : roles[0], designation: '', manager: me.person_id,
    fn: me.manages_collections && !me.manages_operations && has(me, 'collections_head') ? 'collections' : 'operations', zone: '', branch: '' };
  const [f, setF] = useState(blank);
  const [clients, setClients] = useState<Set<string>>(new Set());
  const [locs, setLocs] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [act, setAct] = useState<any>(null);
  const [picker, setPicker] = useState<P | null>(null);
  const [filter, setFilter] = useState('');

  const svc = useMemo(() => (services.data ?? []).filter((s: any) => activeOn(s.valid, me.today)), [services.data, me.today]);
  const locItems = useMemo(() => {
    const m = new Map<string, { id: string; text: string; sub?: string }>();
    svc.filter((s: any) => !f.branch || s.branch_id === f.branch).forEach((s: any) => m.set(s.location_id, { id: s.location_id, text: s.locations?.name }));
    return [...m.values()].sort((a, b) => a.text.localeCompare(b.text));
  }, [svc, f.branch]);
  const clientItems = useMemo(() => {
    const m = new Map<string, { id: string; text: string; sub?: string }>();
    svc.filter((s: any) => (!locs.size || locs.has(s.location_id)) && (!f.branch || s.branch_id === f.branch))
      .forEach((s: any) => m.set(s.client_id, { id: s.client_id, text: s.clients?.name }));
    return [...m.values()].sort((a, b) => a.text.localeCompare(b.text));
  }, [svc, locs, f.branch]);
  const pairs = svc.filter((s: any) => locs.has(s.location_id) && clients.has(s.client_id));
  const missing = [...locs].flatMap((l) => [...clients].filter((c) => !svc.some((s: any) => s.location_id === l && s.client_id === c)).map((c) => [l, c])).length;

  const leaders = (people.data ?? []).filter((p) => p.roles.some((r) => r !== 'executive'));
  const placeOf = () => [branches.data?.find((b: any) => b.id === f.branch)?.name, zones.data?.find((z: any) => z.id === f.zone)?.name].filter(Boolean).join(', ');

  async function add(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null); setAct(null);
    try {
      const mobile = f.mobile.replace(/\D/g, '').slice(-10);
      const p = await rpc('create_team_member', { p_full_name: f.name.trim(), p_email: f.email.trim() || null, p_mobile: mobile,
        p_resource_type: f.role === 'ba' ? 'partner' : 'own_employee', p_designation: f.designation.trim(), p_role: f.role,
        p_manager_id: f.manager, p_function: f.fn, p_zone_id: f.zone || null, p_branch_id: f.branch || null });
      for (const s of pairs) await rpc('allocate', { p_person: p.id, p_client_location: (s as any).id, p_valid_from: me.today, p_function: f.fn });
      const a = await rpc('issue_activation', { p_person: p.id });
      setAct({ ...a, role: f.role, place: placeOf(), email: f.email.trim() || null });
      setF(blank); setClients(new Set()); setLocs(new Set()); people.reload();
    } catch (x) { setErr(x); } finally { setBusy(false); }
  }
  async function code(p: P) {
    setErr(null);
    try { setAct({ ...(await rpc('issue_activation', { p_person: p.person_id })), role: p.roles[0], email: p.email, reset: p.status !== 'invited' }); window.scrollTo(0, 0); }
    catch (x) { setErr(x); }
  }
  const list = (people.data ?? []).filter((p) => !filter || `${p.full_name} ${p.mobile} ${p.manager_name} ${p.allocations.join(' ')}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="stack">
      {act && <ActivationBanner a={act} sender={me.full_name} role={act.role} place={act.place} email={act.email} reset={act.reset} onClose={() => setAct(null)} />}
      <ErrorBox error={err} />
      {picker && <Card title={`Clients for ${picker.full_name}`} action={<button className="btn sm" onClick={() => { setPicker(null); people.reload(); }}>Close</button>}>
        <ClientPicker person={picker.person_id} personName={picker.full_name.split(' ')[0]} /></Card>}

      <Card><details><summary style={{ cursor: 'pointer' }}><b>Bulk upload team members</b> <span className="small muted">— many people at once from Excel (they are added under you unless you give another manager's mobile)</span></summary>
        <div style={{ marginTop: 10 }}><Suspense fallback={<Loading rows={2} />}><LazyBulk me={me} /></Suspense></div></details></Card>
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
            <label className="field">Branch (optional — narrows the lists below)<select value={f.branch} onChange={(e) => { setF({ ...f, branch: e.target.value }); setLocs(new Set()); setClients(new Set()); }}>
              <option value="">—</option>{(branches.data ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}{b.branch_type === 'partner' ? ' (partner)' : ''}</option>)}</select></label>
            <label className="field">Zone {f.role === 'zm' ? '(required for a Zonal Manager)' : '(optional)'}<select required={f.role === 'zm'} value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })}>
              <option value="">—</option>{(zones.data ?? []).map((z: any) => <option key={z.id} value={z.id}>{z.name}</option>)}</select></label>
            <label className="field">Work type<select value={f.fn} onChange={(e) => setF({ ...f, fn: e.target.value })}><option value="operations">Operations (cases)</option><option value="collections">Collections</option></select></label>
            <label className="field">Email (optional)<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
            <label className="field">Designation (required)<input required value={f.designation} placeholder={`e.g. ${ROLE_NAMES[f.role]}`} onChange={(e) => setF({ ...f, designation: e.target.value })} /></label>
          </div>
          {f.fn === 'operations' && (
            <>
              <div className="grid two">
                <TickList title="Locations" items={locItems} picked={locs} setPicked={(s) => { setLocs(s); }} />
                <TickList title="Clients" items={clientItems} picked={clients} setPicked={setClients}
                  hint={locs.size ? <span className="small muted">Showing clients served at the chosen locations.</span> : undefined} />
              </div>
              <div className={`banner ${pairs.length ? 'info' : 'neutral'}`}>{pairs.length
                ? `${pairs.length} client-location assignment(s) will be created${missing ? `; ${missing} chosen combination(s) are not served and will be skipped` : ''}.`
                : 'Choose at least one location and one client, or skip — the person can tick their own clients in My day after signing in.'}</div>
            </>)}
          <p className="small muted">After you press Add, a one-time activation code and a ready-to-send WhatsApp/email message appear at the top. Nobody else ever sees their password. No PAN, Aadhaar, salary or bank details are collected here.</p>
          <div><button className="btn primary" disabled={busy || !f.designation.trim()}>{busy ? 'Adding…' : 'Add member and get onboarding message'}</button></div>
        </form>
      </Card>

      <Card title={`People${people.data ? ` (${people.data.length})` : ''}`} action={<input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 160 }} aria-label="Filter people" />}>
        {people.loading ? <Loading rows={3} /> : <ErrorBox error={people.error} retry={people.reload} />}
        {people.data && (list.length === 0 ? <Empty>No team members yet.</Empty> : (
          <div className="tablewrap" tabIndex={0}><table>
            <thead><tr><th>Name</th><th>Login (mobile)</th><th>Role · reports to</th><th>Clients & locations</th><th>Status</th><th></th></tr></thead>
            <tbody>{list.map((p) => (
              <tr key={p.person_id}>
                <td><b>{p.full_name}</b><div className="small muted">{p.designation}{p.resource_type === 'partner' ? ' · partner' : ''}</div></td>
                <td>{p.mobile ?? p.email ?? '—'}</td>
                <td className="small">{p.roles.map((r) => ROLE_NAMES[r] ?? r).join(', ')}<div className="muted">{p.manager_name ? `→ ${p.manager_name}` : ''}{p.function === 'collections' ? ' · collections' : ''}</div></td>
                <td className="small">{p.allocations.length ? `${p.allocations.length}: ` + p.allocations.slice(0, 3).join('; ') + (p.allocations.length > 3 ? '…' : '') : <span className="muted">none</span>}</td>
                <td>{p.status === 'invited' ? <span className="pill warn">Not activated</span> : p.status === 'active' ? <span className="pill ok">Active</span> : <span className="pill neutral">{label(p.status)}</span>}</td>
                <td><div className="row" style={{ justifyContent: 'flex-end' }}>
                  {onEdit && <button className="btn sm primary" onClick={() => onEdit(p)}>Edit</button>}
                  <button className="btn sm" onClick={() => { setPicker(p); window.scrollTo(0, 0); }}>Clients</button>
                  {p.status !== 'suspended' && <button className="btn sm" onClick={() => code(p)}>{p.status === 'invited' ? 'Onboarding message' : 'Reset code'}</button>}
                </div></td>
              </tr>))}</tbody></table></div>))}
      </Card>
    </div>
  );
}
