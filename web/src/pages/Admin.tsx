import { HelpTip } from '../components/HelpTip';
import { FormEvent, Fragment, useEffect, useMemo, useState } from 'react';
import { PersonProfile } from '../components/PersonProfile';
import { Link, useSearchParams } from 'react-router-dom';
import { authFn, has, Me, rpc, sb, select } from '../lib/api';
import { label, money, time } from '../lib/format';
import { ROLE_NAMES } from '../lib/messages';
import { Card, Empty, ErrorBox, Kpi, Loading, Tabs, useLoad, Pill } from '../components/ui';
import { ActivationBanner } from '../components/Onboarding';
import { KpiAdmin } from '../components/KpiAdmin';
import { AccessCard } from '../components/AccessCard';
import { DocCheck } from '../components/DocCheck';
import { ClientPicker } from '../components/ClientPicker';
import { BulkUpload } from './BulkUpload';
import { SendAlert } from './Notifications';
import { DataIssueList } from '../components/DataIssues';
import { Icon } from '../components/Icon';
import { Documents, DOC_TYPES, PoliceVerification } from '../components/Documents';
import { LettersAdmin } from '../components/LettersAdmin';
import { DesignationInput } from '../components/Designation';
import { EmploymentCard, SalaryHistory } from '../components/Employment';
import TeamPeople, { type P } from './TeamPeople';
export { ActivationBanner };

type Section = 'people' | 'compliance' | 'doccheck' | 'letters' | 'quality' | 'usage' | 'kpis' | 'access' | 'locations' | 'clients' | 'targets' | 'upload' | 'reopen' | 'close' | 'policy' | 'settings' | 'log';
const SECTIONS: [Section, string, string][] = [
  ['people', 'People', 'Add people, change roles, who they report to, the locations they head and the clients they work on'],
  ['compliance', 'HR repository', 'Every person: profile, documents (verify), police verification, salary, partner terms, agreement'],
  ['doccheck', 'Document check', 'Each uploaded document next to the details recorded from it — compare, correct and validate'],
  ['quality', 'Data quality', 'Details that are missing or wrong across everyone — chase them to 100% correct'],
  ['usage', 'App usage report', 'How much the team uses CRUX, by person and by hour — view and download to share'],
  ['letters', 'Letters & salary slips', 'Letter templates, roles and responsibilities, send letters to sign, exit and salary revision letters, past salary slips'],
  ['kpis', 'KPIs', 'The KPI library (add and edit), who holds which KPIs and attributes, and department roll-ups'],
  ['access', 'Who sees what', 'Per role: whose daily figures, tasks, profiles, pay, documents, scores, KPIs and plans can be opened'],
  ['locations', 'Locations & heads', 'Zones, locations, the Zonal Manager and Branch Manager / BA for each location (also per client)'],
  ['clients', 'Clients & rates', 'Clients, which client is served at which location, per-case rates, BA ratios'],
  ['targets', 'Monthly targets', 'Target cases per location and client for each month'],
  ['upload', 'Bulk upload', 'Load many rows at once from Excel'],
  ['reopen', 'Reopen days', 'Let people or whole locations correct closed days (several dates at once) or a locked target month'],
  ['close', 'Month close & backup', 'Checklist before closing a month, close it, download a full backup'],
  ['policy', 'Leave, holidays & policies', 'Leave types with monthly credits, national and regional holidays, penalty rules (empty until a policy is set)'],
  ['settings', 'Settings', 'Working hours, reporting deadline, target lock, report email'],
  ['log', 'Activity log', 'Who changed what, and when'],
];

export default function Admin({ me }: { me: Me }) {
  const isAdmin = has(me, 'admin');
  const hr = has(me, 'hr_admin');
  const list = SECTIONS.filter(([k]) => isAdmin || (hr && ['people', 'compliance', 'doccheck', 'letters', 'quality', 'usage', 'kpis', 'locations', 'upload', 'policy'].includes(k)) || k === 'log')
    .filter(([k]) => !(me.hidden_pages ?? []).includes('adm_' + k));
  const [sp, setSp] = useSearchParams();
  const sec = (sp.get('s') ?? 'people') as Section;
  const setSec = (k: Section) => setSp({ s: k }, { replace: true });
  const cur = list.find(([k]) => k === sec) ?? list[0];
  if (!cur) return <div className="stack"><h1>Admin</h1><div className="banner neutral">The Admin sections are turned off for your role. Ask Admin if you need one of them.</div></div>;
  return (
    <div className="stack">
      <div className="topbar"><div><div className="h1row"><h1>Admin</h1><HelpTip k="Admin" /></div><div className="muted">Every change is recorded in the activity log with who made it and when.</div></div>
        <select className="mobile-only" value={cur[0]} onChange={(e) => setSec(e.target.value as Section)} aria-label="Admin section">{list.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      <div className="row"><h2 style={{ margin: 0 }}>{cur[1]}</h2><span className="small muted">{cur[2]}</span><span className="spacer" />
        <select className="desktop-only" style={{ width: 230 }} value={cur[0]} onChange={(e) => setSec(e.target.value as Section)} aria-label="Admin section (desktop)">{list.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      {cur[0] === 'people' && <PeopleAdmin me={me} />}
      {cur[0] === 'compliance' && <HrRepository me={me} />}
      {cur[0] === 'doccheck' && <DocCheck />}
      {cur[0] === 'letters' && <LettersAdmin me={me} />}
      {cur[0] === 'quality' && <DataQuality me={me} />}
      {cur[0] === 'usage' && <UsageReport />}
      {cur[0] === 'kpis' && <KpiAdmin me={me} />}
      {cur[0] === 'access' && <AccessCard />}
      {cur[0] === 'locations' && <LocationsAdmin me={me} />}
      {cur[0] === 'clients' && <ClientsAdmin />}
      {cur[0] === 'targets' && <TargetsAdmin me={me} />}
      {cur[0] === 'upload' && <BulkUpload me={me} />}
      {cur[0] === 'reopen' && <Reopen me={me} />}
      {cur[0] === 'close' && <MonthClose me={me} />}
      {cur[0] === 'policy' && <Policies />}
      {cur[0] === 'settings' && <SettingsForm />}
      {cur[0] === 'log' && <Audit />}
    </div>
  );
}

function ClientsAdmin() {
  const [t, setT] = useState<'clients' | 'services' | 'rates' | 'ratios' | 'types'>('clients');
  return (
    <div className="stack">
      <Tabs tabs={[['clients', 'Clients'], ['services', 'Client at location'], ['rates', 'Per-case rates'], ['ratios', 'BA ratios & agreements'], ['types', 'Own / partner branch']]} value={t} onChange={setT} />
      {t === 'clients' && <ClientsList />}
      {t === 'services' && <Services />}
      {t === 'rates' && <Rates />}
      {t === 'ratios' && <><Partners /><PartnerAgreements /></>}
      {t === 'types' && <BranchTypes />}
    </div>
  );
}

const HEAD = { zonal_manager: 'Zonal Manager', branch_head: 'Branch Manager / BA' } as Record<string, string>;
const yesterday = (d: string) => { const x = new Date(d + 'T12:00:00+05:30'); x.setDate(x.getDate() - 1); return x.toISOString().slice(0, 10); };
const lowerOf = (r: string) => /^[\[(]([^,]*)/.exec(r ?? '')?.[1] ?? '';

function PeopleAdmin({ me }: { me: Me }) {
  const [edit, setEdit] = useState<P | null>(null);
  const [n, setN] = useState(0);
  if (edit) return <PersonEditor me={me} p={edit} onClose={() => { setEdit(null); setN(n + 1); }} />;
  return <TeamPeople key={n} me={me} onEdit={(p) => { setEdit(p); window.scrollTo(0, 0); }} />;
}

function PersonEditor({ me, p, onClose }: { me: Me; p: P; onClose: () => void }) {
  const d = useLoad(async () => ({
    person: (await select('persons', 'id,full_name,mobile,personal_email,designation,resource_type,status', (b) => b.eq('id', p.person_id)))[0],
    roles: await select('role_assignments', 'id,role,valid,zones(name),branches(name)', (b) => b.eq('person_id', p.person_id).order('created_at')),
    lines: await select('reporting_lines', 'id,function,valid,manager_id', (b) => b.eq('person_id', p.person_id).order('created_at')),
    heads: await select('location_heads', 'id,head_role,valid,branches(name),clients(name)', (b) => b.eq('person_id', p.person_id).order('created_at')),
    people: await select('persons', 'id,full_name,designation', (b) => b.neq('status', 'exited').order('full_name')),
    branches: await select('branches', 'id,name', (b) => b.eq('active', true).order('name')),
    clients: await select('clients', 'id,name', (b) => b.eq('active', true).order('name')),
  }), [p.person_id]);
  const [f, setF] = useState<any>(null);
  const [role, setRole] = useState('');
  const [mgr, setMgr] = useState('');
  const [h, setH] = useState({ branch: '', role: 'branch_head', client: '' });
  const [err, setErr] = useState<unknown>(null);
  const [ok, setOk] = useState('');
  const [act, setAct] = useState<any>(null);
  const today = me.today;
  const active = (r: string) => { const m = /^[\[(]([^,]*),([^)\]]*)/.exec(r ?? ''); return !!m && (!m[1] || m[1] <= today) && (!m[2] || today < m[2]); };
  const run = async (fn: () => Promise<unknown>, msg: string) => { setErr(null); setOk(''); try { await fn(); setOk(msg); d.reload(); } catch (e) { setErr(e); } };
  if (d.loading) return <Loading rows={5} />;
  if (d.error) return <ErrorBox error={d.error} retry={d.reload} />;
  const x = d.data!;
  const pf = f ?? x.person;
  const name = (id: string) => x.people.find((q: any) => q.id === id)?.full_name ?? '—';
  const curLine = x.lines.find((l: any) => l.function === 'operations' && active(l.valid));
  const endRow = (table: string, row: any, reason: string) => rpc('end_assignment', { p_table: table, p_id: row.id,
    p_last_day: lowerOf(row.valid) >= today ? today : yesterday(today), p_reason: reason });
  return (
    <div className="stack">
      <div className="row"><button className="btn" onClick={onClose}>‹ Back to people</button><h2 style={{ margin: 0 }}>{x.person.full_name}</h2>
        <span className={`pill ${x.person.status === 'active' ? 'ok' : 'warn'}`}>{x.person.status === 'invited' ? 'Not activated' : label(x.person.status)}</span></div>
      {act && <ActivationBanner a={act} sender={me.full_name} role={act.role} reset={act.reset} onClose={() => setAct(null)} />}
      <ErrorBox error={err} />{ok && <div className="banner ok" role="status">{ok}</div>}
      <div className="grid two">
        <Card title="Details">
          <form className="stack" onSubmit={(e: FormEvent) => { e.preventDefault(); run(async () => {
            const { error } = await sb.from('persons').update({ full_name: pf.full_name, mobile: pf.mobile || null, personal_email: pf.personal_email || null,
              designation: pf.designation || null, resource_type: pf.resource_type }).eq('id', p.person_id);
            if (error) throw error; setF(null); }, 'Details saved. If the mobile changed, send a new activation code.'); }}>
            <label className="field">Full name<input value={pf.full_name ?? ''} onChange={(e) => setF({ ...pf, full_name: e.target.value })} /></label>
            <label className="field">Mobile (login ID)<input value={pf.mobile ?? ''} onChange={(e) => setF({ ...pf, mobile: e.target.value.replace(/\D/g, '') })} /></label>
            <label className="field">Email<input value={pf.personal_email ?? ''} onChange={(e) => setF({ ...pf, personal_email: e.target.value })} /></label>
            <label className="field">Designation (required)<DesignationInput value={pf.designation ?? ''} onChange={(v) => setF({ ...pf, designation: v })} />
              <span className="small muted">Pick from the approved list as you type, so levels and letters stay consistent.</span></label>
            <label className="field">Type<select value={pf.resource_type} onChange={(e) => setF({ ...pf, resource_type: e.target.value })}><option value="own_employee">CRUX employee</option><option value="partner">Partner / Business Associate</option></select></label>
            <div className="row"><button className="btn primary" disabled={!f}>Save details</button>
              <button type="button" className="btn" onClick={async () => { try { setAct({ ...(await rpc('issue_activation', { p_person: p.person_id })), role: p.roles[0], reset: x.person.status !== 'invited' }); } catch (e) { setErr(e); } }}>
                {x.person.status === 'invited' ? 'Onboarding message' : 'New activation code'}</button>
              {x.person.status !== 'exited' && <button type="button" className="btn danger" onClick={async () => { const r = window.prompt(`Reason for deactivating ${x.person.full_name}`); if (!r) return;
                run(async () => { await rpc('deactivate_person', { p_person: p.person_id, p_last_day: today, p_reason: r }); await authFn({ action: 'suspend', person_id: p.person_id }); }, 'Deactivated and signed out.'); }}>Deactivate</button>}</div>
          </form>
        </Card>
        <Card title="Roles">
          <div className="stack">
            <table><tbody>{x.roles.filter((r: any) => active(r.valid)).map((r: any) => (
              <tr key={r.id}><td><b>{ROLE_NAMES[r.role] ?? label(r.role)}</b><div className="small muted">since {lowerOf(r.valid)}{r.zones?.name ? ` · ${r.zones.name}` : ''}{r.branches?.name ? ` · ${r.branches.name}` : ''}</div></td>
                <td><button className="btn sm" onClick={() => run(() => endRow('role_assignments', r, 'role removed by admin'), 'Role ended.')}>Remove</button></td></tr>))}</tbody></table>
            <div className="row"><select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Add role"><option value="">Add a role…</option>
              {Object.entries(ROLE_NAMES).filter(([k]) => !x.roles.some((r: any) => r.role === k && active(r.valid))).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <button className="btn" disabled={!role} onClick={() => run(async () => { const { error } = await sb.from('role_assignments').insert({ person_id: p.person_id, role, valid: `[${today},)`, reason: 'added by admin' }); if (error) throw error; setRole(''); }, 'Role added.')}>Add</button></div>
            <p className="small muted">One person can hold several roles — e.g. Operations Head and Zonal Manager. Which locations they look after is set under "Locations they head".</p>
          </div>
        </Card>
        <Card title="Reports to">
          <div className="stack">
            <div>{curLine ? <><b>{name(curLine.manager_id)}</b> <span className="small muted">since {lowerOf(curLine.valid)}</span></> : <span className="muted">Nobody (top of the tree)</span>}</div>
            <div className="row"><select value={mgr} onChange={(e) => setMgr(e.target.value)} aria-label="New manager"><option value="">Change to…</option>
              {x.people.filter((q: any) => q.id !== p.person_id).map((q: any) => <option key={q.id} value={q.id}>{q.full_name}</option>)}</select>
              <button className="btn" disabled={!mgr} onClick={() => run(async () => {
                if (curLine && lowerOf(curLine.valid) >= today) { const { error } = await sb.from('reporting_lines').update({ manager_id: mgr }).eq('id', curLine.id); if (error) throw error; }
                else { if (curLine) await endRow('reporting_lines', curLine, 'manager changed by admin');
                  const { error } = await sb.from('reporting_lines').insert({ person_id: p.person_id, manager_id: mgr, function: 'operations', valid: `[${today},)`, reason: 'manager changed by admin' }); if (error) throw error; }
                setMgr(''); }, 'Manager changed from today. Past figures stay with the previous manager.')}>Save</button></div>
            <p className="small muted">The change applies from today; history is kept.</p>
          </div>
        </Card>
        {has(me, 'admin', 'hr_admin') && <SalaryHistory me={me} personId={p.person_id} partner={x.person.resource_type === 'partner'} />}
        <EmploymentCard personId={p.person_id} />
        <AssistantProduct me={me} personId={p.person_id} people={x.people} clients={x.clients} roles={x.roles.filter((r: any) => active(r.valid)).map((r: any) => r.role)} onChange={d.reload} />
        <Card title="Locations they head">
          <div className="stack">
            {x.heads.filter((r: any) => active(r.valid)).length === 0 ? <Empty>None.</Empty> :
              <table><tbody>{x.heads.filter((r: any) => active(r.valid)).map((r: any) => (
                <tr key={r.id}><td><b>{r.branches?.name}</b><div className="small muted">{HEAD[r.head_role]} · {r.clients?.name ?? 'all clients'} · since {lowerOf(r.valid)}</div></td>
                  <td><button className="btn sm" onClick={() => run(() => rpc('end_location_head', { p_id: r.id, p_last_day: lowerOf(r.valid) >= today ? today : yesterday(today), p_reason: 'removed by admin' }), 'Ended.')}>Remove</button></td></tr>))}</tbody></table>}
            <div className="grid two">
              <select value={h.branch} onChange={(e) => setH({ ...h, branch: e.target.value })} aria-label="Location"><option value="">Location…</option>{x.branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
              <select value={h.role} onChange={(e) => setH({ ...h, role: e.target.value })} aria-label="As"><option value="branch_head">as Branch Manager / BA</option><option value="zonal_manager">as Zonal Manager</option></select>
              <select value={h.client} onChange={(e) => setH({ ...h, client: e.target.value })} aria-label="Client"><option value="">for all clients</option>{x.clients.map((c: any) => <option key={c.id} value={c.id}>only {c.name}</option>)}</select>
              <button className="btn" disabled={!h.branch} onClick={() => run(async () => { await rpc('set_location_head', { p_branch: h.branch, p_person: p.person_id, p_role: h.role, p_client: h.client || null, p_reason: 'set by admin' }); setH({ branch: '', role: 'branch_head', client: '' }); }, 'Saved. Any previous head for that location (and client) ends yesterday.')}>Add</button>
            </div>
            <p className="small muted">The Zonal Manager of a location sees it in the Zonal Tracker and stakeholder totals. A head "for only one client" covers that client at a shared location.</p>
          </div>
        </Card>
      </div>
      <Card title="Clients they work on (appear in their My day)"><ClientPicker person={p.person_id} personName={x.person.full_name.split(' ')[0]} /></Card>
    </div>
  );
}

function LocationsAdmin({ me }: { me: Me }) {
  const d = useLoad(async () => ({
    branches: await select('branches', 'id,code,name,branch_type,type_confirmed,branch_zones(valid,zone_id,zones(name,region))', (b) => b.eq('active', true).order('name')),
    heads: await select('location_heads', 'id,branch_id,head_role,valid,person_id,persons!location_heads_person_id_fkey(full_name),clients(name)'),
    zones: await select('zones', 'id,name,region', (b) => b.order('name')),
    people: await select('persons', 'id,full_name', (b) => b.neq('status', 'exited').order('full_name')),
    services: await select('client_locations', 'id,branch_id,valid,clients(name)'),
    clients: await select('clients', 'id,name', (b) => b.eq('active', true).order('name')),
  }), []);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [nl, setNl] = useState({ name: '', zone: '', type: 'partner' });
  const [err, setErr] = useState<unknown>(null);
  const [ok, setOk] = useState('');
  const today = me.today;
  const active = (r: string) => { const m = /^[\[(]([^,]*),([^)\]]*)/.exec(r ?? ''); return !!m && (!m[1] || m[1] <= today) && (!m[2] || today < m[2]); };
  const run = async (fn: () => Promise<unknown>, msg: string) => { setErr(null); setOk(''); try { await fn(); setOk(msg); d.reload(); } catch (e) { setErr(e); } };
  const rows = useMemo(() => (d.data?.branches ?? []).map((b: any) => {
    const bz = (b.branch_zones ?? []).find((z: any) => active(z.valid));
    const hs = (d.data!.heads ?? []).filter((h: any) => h.branch_id === b.id && active(h.valid));
    return { ...b, zone: bz?.zones?.name ?? '—', region: bz?.zones?.region ?? '', zm: hs.find((h: any) => h.head_role === 'zonal_manager' && !h.clients),
      heads: hs.filter((h: any) => h.head_role === 'branch_head'), clients: (d.data!.services ?? []).filter((s: any) => s.branch_id === b.id && active(s.valid)).map((s: any) => s.clients?.name) };
  }).filter((b: any) => `${b.name} ${b.zone} ${b.zm?.persons?.full_name ?? ''} ${b.heads.map((h: any) => h.persons?.full_name).join(' ')}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a: any, b: any) => (a.zone + a.name).localeCompare(b.zone + b.name)), [d.data, q]);
  if (d.loading) return <Loading rows={6} />;
  if (d.error) return <ErrorBox error={d.error} retry={d.reload} />;
  const groups = new Map<string, any[]>(); rows.forEach((r: any) => groups.set(r.zm?.persons?.full_name ?? 'No Zonal Manager', [...(groups.get(r.zm?.persons?.full_name ?? 'No Zonal Manager') ?? []), r]));
  return (
    <div className="stack">
      <ErrorBox error={err} />{ok && <div className="banner ok" role="status">{ok}</div>}
      <Card title="Stakeholder groups (Zonal Manager → locations)">
        <div className="stack">{[...groups.entries()].map(([g, rs]) => <div key={g}><b>{g}</b> <span className="small muted">({rs.length})</span><div className="small">{rs.map((r: any) => r.name).join(' · ')}</div></div>)}</div>
        <p className="small muted">These are the groups in the Zonal Tracker's "Operation Stakeholders" block. Change a location's Zonal Manager below.</p>
      </Card>
      <Card title={`Locations (${rows.length})`} action={<input placeholder="Search location, zone or person…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} aria-label="Search locations" />}>
        <div className="tablewrap" tabIndex={0}><table>
          <thead><tr><th>Location</th><th>Zone</th><th>Zonal Manager</th><th>Branch Manager / BA</th><th className="num">Clients</th><th></th></tr></thead>
          <tbody>{rows.map((b: any) => (
            <Fragment key={b.id}>
              <tr><td><b>{b.name}</b><div className="small muted">{b.branch_type === 'partner' ? 'Partner (BA)' : 'Own branch'}{b.type_confirmed ? '' : ' · type not confirmed'}</div></td>
                <td className="small">{b.zone}<div className="muted">{b.region}</div></td>
                <td>{b.zm?.persons?.full_name ?? <span className="pill warn">none</span>}</td>
                <td className="small">{b.heads.length ? b.heads.map((h: any) => <div key={h.id}>{h.persons?.full_name}{h.clients ? <span className="muted"> — {h.clients.name}</span> : ''}</div>) : <span className="pill warn">none</span>}</td>
                <td className="num">{b.clients.length}</td>
                <td><button className="btn sm" onClick={() => setOpen(open === b.id ? null : b.id)}>{open === b.id ? 'Close' : 'Change'}</button></td></tr>
              {open === b.id && <tr><td colSpan={6}><LocationEditor b={b} d={d.data!} run={run} today={today} /></td></tr>}
            </Fragment>))}</tbody></table></div>
      </Card>
      <TrackerLayout run={run} />
      <Card title="Add a location">
        <form className="row" style={{ alignItems: 'end' }} onSubmit={(e) => { e.preventDefault(); run(async () => {
          const zone = d.data!.zones.find((z: any) => z.id === nl.zone)?.name;
          for (const [k, rows] of [['locations', [{ name: nl.name }]], ['branches', [{ name: nl.name, type: nl.type, zone, valid_from: today }]]] as const) {
            const r = await rpc('bulk_import', { p_kind: k, p_rows: rows, p_dry_run: false }); if (r.errors.length) throw new Error(r.errors[0].error);
          }
          setNl({ name: '', zone: '', type: 'partner' }); }, 'Location added. Now open it to add its clients and heads.'); }}>
          <label className="field">Location name<input required value={nl.name} onChange={(e) => setNl({ ...nl, name: e.target.value })} /></label>
          <label className="field">Zone<select required value={nl.zone} onChange={(e) => setNl({ ...nl, zone: e.target.value })}><option value="">Choose…</option>{d.data!.zones.map((z: any) => <option key={z.id} value={z.id}>{z.name}</option>)}</select></label>
          <label className="field">Type<select value={nl.type} onChange={(e) => setNl({ ...nl, type: e.target.value })}><option value="partner">Partner (BA)</option><option value="own">Own branch</option></select></label>
          <button className="btn primary">Add location</button>
        </form>
      </Card>
    </div>
  );
}

/** Zonal Tracker layout: zone order and colours, each location's order and Zone A / Zone B. */
function TrackerLayout({ run }: { run: (fn: () => Promise<unknown>, msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const d = useLoad(async () => open ? {
    zones: await select('zones', 'id,name,region,sort_order,tracker_style', (b) => b.order('sort_order', { nullsFirst: false })),
    branches: await select('branches', 'id,name,tier,sort_order,branch_zones(valid,zones(name))', (b) => b.eq('active', true).order('sort_order', { nullsFirst: false })),
  } : null, [open]);
  const upd = (t: string, id: string, v: Record<string, unknown>) => run(async () => { const { error } = await sb.from(t).update(v).eq('id', id); if (error) throw error; }, 'Tracker layout saved.');
  const col = (z: any, k: string, def: string) => (z.tracker_style?.[k] ? '#' + z.tracker_style[k] : def);
  return (
    <Card title="Zonal Tracker layout" action={<button className="btn sm" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Change'}</button>}>
      <p className="small muted">Order of zones and locations, the zone colours, and whether each location counts in Zone A or Zone B. Taken from your 30-Oct tracker; changes apply to the next tracker you open or download.</p>
      {open && (d.loading ? <Loading /> : d.data && <div className="grid two">
        <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Zone</th><th>Region</th><th className="num">Order</th><th>Header</th><th>Rows</th><th>Total</th></tr></thead>
          <tbody>{d.data.zones.map((z: any) => <tr key={z.id}><td>{z.name}</td>
            <td><select defaultValue={z.region ?? ''} onChange={(e) => upd('zones', z.id, { region: e.target.value })}>{['North', 'South', 'East', 'West'].map((r) => <option key={r}>{r}</option>)}</select></td>
            <td className="num"><input type="number" defaultValue={z.sort_order ?? ''} style={{ width: 70 }} onBlur={(e) => upd('zones', z.id, { sort_order: Number(e.target.value) || null })} /></td>
            {(['header', 'leaf', 'total'] as const).map((k) => <td key={k}><input type="color" defaultValue={col(z, k, k === 'header' ? '#BDD7EE' : k === 'leaf' ? '#CFE2F3' : '#9FC5E8')}
              aria-label={`${z.name} ${k} colour`} onChange={(e) => upd('zones', z.id, { tracker_style: { ...(z.tracker_style ?? {}), [k]: e.target.value.slice(1).toUpperCase() } })} style={{ width: 44, padding: 0 }} /></td>)}</tr>)}</tbody></table></div>
        <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Location</th><th>Zone</th><th className="num">Order</th><th>Counts in</th></tr></thead>
          <tbody>{d.data.branches.map((b: any) => <tr key={b.id}><td>{b.name}</td><td className="small muted">{b.branch_zones?.[0]?.zones?.name}</td>
            <td className="num"><input type="number" defaultValue={b.sort_order ?? ''} style={{ width: 70 }} onBlur={(e) => upd('branches', b.id, { sort_order: Number(e.target.value) || null })} /></td>
            <td><select defaultValue={b.tier ?? 'Zone B'} onChange={(e) => upd('branches', b.id, { tier: e.target.value })}><option>Zone A</option><option>Zone B</option></select></td></tr>)}</tbody></table></div>
      </div>)}
    </Card>
  );
}

function LocationEditor({ b, d, run, today }: { b: any; d: any; today: string; run: (fn: () => Promise<unknown>, msg: string) => void }) {
  const [zm, setZm] = useState('');
  const [hd, setHd] = useState({ person: '', client: '' });
  const [zone, setZone] = useState('');
  const [add, setAdd] = useState<string[]>([]);
  const missing = d.clients.filter((c: any) => !b.clients.includes(c.name));
  return (
    <div className="grid two" style={{ padding: 8 }}>
      <div className="stack">
        <b>Zonal Manager</b>
        <div className="row"><select value={zm} onChange={(e) => setZm(e.target.value)} aria-label="Zonal Manager"><option value="">Change to…</option>{d.people.map((p: any) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>
          <button className="btn sm" disabled={!zm} onClick={() => run(() => rpc('set_location_head', { p_branch: b.id, p_person: zm, p_role: 'zonal_manager', p_reason: 'changed by admin' }), 'Zonal Manager changed from today.')}>Save</button></div>
        <b>Add a Branch Manager / BA</b>
        <div className="row"><select value={hd.person} onChange={(e) => setHd({ ...hd, person: e.target.value })} aria-label="Head"><option value="">Person…</option>{d.people.map((p: any) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>
          <select value={hd.client} onChange={(e) => setHd({ ...hd, client: e.target.value })} aria-label="For client"><option value="">for all clients</option>{d.clients.filter((c: any) => b.clients.includes(c.name)).map((c: any) => <option key={c.id} value={c.id}>only {c.name}</option>)}</select>
          <button className="btn sm" disabled={!hd.person} onClick={() => run(() => rpc('set_location_head', { p_branch: b.id, p_person: hd.person, p_role: 'branch_head', p_client: hd.client || null, p_reason: 'changed by admin' }), 'Head saved from today; the previous head for the same scope ends yesterday.')}>Save</button></div>
        {b.heads.map((h: any) => <div key={h.id} className="row small">{h.persons?.full_name}{h.clients ? ` — ${h.clients.name}` : ' — all clients'}
          <button className="btn sm" onClick={() => run(() => rpc('end_location_head', { p_id: h.id, p_last_day: yesterday(today), p_reason: 'removed by admin' }), 'Head removed.')}>Remove</button></div>)}
        <p className="small muted">Heads decide who sees the location's numbers. Who enters figures is set by each person's clients (People → Edit → Clients).</p>
      </div>
      <div className="stack">
        <b>Zone</b>
        <div className="row"><select value={zone} onChange={(e) => setZone(e.target.value)} aria-label="Zone"><option value="">Move to zone…</option>{d.zones.map((z: any) => <option key={z.id} value={z.id}>{z.name}</option>)}</select>
          <button className="btn sm" disabled={!zone} onClick={() => run(async () => {
            const all = await select('branch_zones', 'id,valid', (q) => q.eq('branch_id', b.id));
            for (const z of all) if (/,\)$/.test(z.valid)) {
              if (lowerOf(z.valid) >= today) { const { error } = await sb.from('branch_zones').update({ zone_id: zone }).eq('id', z.id); if (error) throw error; return; }
              await rpc('end_assignment', { p_table: 'branch_zones', p_id: z.id, p_last_day: yesterday(today), p_reason: 'zone changed by admin' });
            }
            const { error } = await sb.from('branch_zones').insert({ branch_id: b.id, zone_id: zone, valid: `[${today},)` }); if (error) throw error; }, 'Zone changed from today.')}>Save</button></div>
        <b>Clients served here ({b.clients.length})</b>
        <div className="small">{b.clients.join(', ') || 'none'}</div>
        <select multiple value={add} onChange={(e) => setAdd([...e.target.selectedOptions].map((o) => o.value))} style={{ minHeight: 110 }} aria-label="Add clients">
          {missing.map((c: any) => <option key={c.id} value={c.name}>{c.name}</option>)}</select>
        <button className="btn sm" disabled={!add.length} onClick={() => run(async () => {
          const r = await rpc('bulk_import', { p_kind: 'services', p_rows: add.map((c) => ({ client: c, location: b.name, branch: b.code })), p_dry_run: false });
          if (r.errors.length) throw new Error(`${r.errors[0].error} (nothing saved)`); setAdd([]); }, 'Clients added to this location. Add their rates under Clients & rates.')}>Add selected clients</button>
      </div>
    </div>
  );
}

function TargetsAdmin({ me }: { me: Me }) {
  const [month, setMonth] = useState(me.today.slice(0, 7));
  const m1 = month + '-01';
  const d = useLoad(() => rpc<any[]>('location_targets', { p_month: m1 }), [m1]);
  const lock = useLoad(() => rpc<any>('target_lock_info', { p_month: m1 }), [m1]);
  const [val, setVal] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [ok, setOk] = useState('');
  const [prev, setPrev] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const prevMonth = (() => { const x = new Date(m1 + 'T12:00:00'); x.setMonth(x.getMonth() - 1); return x.toISOString().slice(0, 7) + '-01'; })();
  const rows = (d.data ?? []).filter((r) => `${r.branch} ${r.zone} ${r.client}`.toLowerCase().includes(q.toLowerCase()));
  const key = (r: any) => r.branch_id + '|' + r.client_id;
  const cur = (r: any) => (val[key(r)] !== undefined ? Number(val[key(r)] || 0) : Number(r.target_cases ?? 0));
  const tot = rows.reduce((a, r) => ({ c: a.c + cur(r), v: a.v + cur(r) * Number(r.rate ?? 0) }), { c: 0, v: 0 });
  const changed = Object.keys(val).length;
  async function save() {
    setBusy(true); setErr(null); setOk('');
    try {
      for (const [k, v] of Object.entries(val)) { const [b, c] = k.split('|');
        await rpc('set_target', { p_month: m1, p_metric: 'entry', p_level: 'branch', p_amount: Number(v || 0), p_branch_id: b, p_client_id: c, p_reason: 'set in Admin → Monthly targets' }); }
      setVal({}); setOk(`${changed} target(s) saved.`); d.reload();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  async function copy(apply: boolean, source: string) {
    setErr(null); setOk('');
    try { const r = await rpc('copy_targets', { p_to_month: m1, p_from_month: prevMonth, p_source: source, p_apply: apply });
      if (apply) { setPrev(null); setOk(`${r.rows} targets copied.`); d.reload(); } else setPrev({ ...r, source }); }
    catch (e) { setErr(e); }
  }
  return (
    <div className="stack">
      <Card title="Monthly targets (cases per location and client)">
        <div className="stack">
          <div className="row">
            <label className="field">Month<input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setVal({}); setPrev(null); }} /></label>
            <span className="small muted">{lock.data ? (lock.data.locked ? `Locked since ${time(lock.data.lock_at)} — changes need a reopen.` : `Open for changes until ${time(lock.data.lock_at)}.`) : ''}</span>
          </div>
          <div className="row">
            <button className="btn" onClick={() => copy(false, 'targets')}>Fill from last month's targets</button>
            <button className="btn" onClick={() => copy(false, 'tracker')}>Fill from last month's Zonal Tracker</button>
          </div>
          {prev && <div className="banner warn">{prev.rows === 0 ? 'Nothing to copy from that source.' : <>This will set <b>{prev.rows}</b> location × client targets totalling <b>{new Intl.NumberFormat('en-IN').format(prev.target_cases)}</b> cases for {month}, overwriting any already set.
            <div className="row" style={{ marginTop: 6 }}><button className="btn primary sm" onClick={() => copy(true, prev.source)}>Yes, copy them</button><button className="btn sm" onClick={() => setPrev(null)}>Cancel</button></div></>}</div>}
          <ErrorBox error={err} />{ok && <div className="banner ok">{ok}</div>}
          <div className="row"><b>{new Intl.NumberFormat('en-IN').format(tot.c)} cases · {money(tot.v)} revenue target</b><span className="spacer" />
            <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} aria-label="Search targets" />
            <button className="btn primary" disabled={!changed || busy} onClick={save}>{busy ? 'Saving…' : `Save ${changed || ''} change(s)`}</button></div>
          {d.loading ? <Loading rows={4} /> : <ErrorBox error={d.error} />}
          {d.data && <div className="tablewrap" tabIndex={0}><table>
            <thead><tr><th>Location</th><th>Client</th><th className="num">Rate</th><th className="num">Last month</th><th className="num">Target cases</th><th className="num">Revenue target</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={key(r)}><td>{r.branch}<div className="small muted">{r.zone}</div></td><td>{r.client}</td><td className="num">{r.rate ? money(r.rate) : <span className="pill warn">no rate</span>}</td>
              <td className="num small muted">{r.last_month_cases == null ? '—' : new Intl.NumberFormat('en-IN').format(r.last_month_cases)}</td>
              <td className="num"><input type="number" min={0} inputMode="numeric" style={{ width: 90 }} value={val[key(r)] ?? (r.target_cases ?? '')} placeholder="0"
                onChange={(e) => setVal({ ...val, [key(r)]: e.target.value })} aria-label={`Target ${r.branch} ${r.client}`} /></td>
              <td className="num">{money(cur(r) * Number(r.rate ?? 0))}</td></tr>)}</tbody></table></div>}
          <p className="small muted">Revenue target = target cases × the rate in force. Targets feed the Zonal Tracker and Revenue Status. Every change is versioned with who set it.</p>
        </div>
      </Card>
    </div>
  );
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function SettingsForm() {
  const d = useLoad(() => select('settings', 'key,value,label,help,kind,section,editable,updated_at', (b) => b.order('section').order('label')), []);
  const [val, setVal] = useState<Record<string, any>>({});
  const [err, setErr] = useState<unknown>(null);
  const [ok, setOk] = useState('');
  async function save(s: any) {
    setErr(null); setOk('');
    let v = val[s.key];
    if (s.kind === 'number') v = Number(v);
    if (s.kind === 'emails') v = String(v).split(/[\s,;]+/).filter(Boolean).join(', ');
    try { await rpc('set_setting', { p_key: s.key, p_value: v }); setOk(`Saved: ${s.label}`); setVal((x) => { const n = { ...x }; delete n[s.key]; return n; }); d.reload(); }
    catch (e) { setErr(e); }
  }
  if (d.loading) return <Loading rows={5} />;
  if (d.error) return <ErrorBox error={d.error} />;
  const list = (d.data ?? []).filter((s: any) => s.label);
  const sections = [...new Set(list.map((s: any) => s.section))];
  return (
    <div className="stack">
      <ErrorBox error={err} />{ok && <div className="banner ok" role="status">{ok}</div>}
      {sections.map((sec) => (
        <Card key={sec} title={sec}>
          <div className="stack">{list.filter((s: any) => s.section === sec).map((s: any) => {
            const v = val[s.key] ?? s.value; const dirty = val[s.key] !== undefined;
            const set = (x: any) => setVal({ ...val, [s.key]: x });
            let input;
            if (!s.editable) input = <span>{s.kind === 'toggle' ? (s.value ? 'On' : 'Off') : String(s.value)}</span>;
            else if (s.kind === 'time') input = <input type="time" value={v} onChange={(e) => set(e.target.value)} style={{ maxWidth: 160 }} />;
            else if (s.kind === 'number') input = <input type="number" min={0} value={v} onChange={(e) => set(e.target.value)} style={{ maxWidth: 160 }} />;
            else if (s.kind === 'weekdays') input = <div className="row">{DOW.map((n, i) => <label key={n} className="row small" style={{ gap: 4 }}><input type="checkbox" style={{ width: 18, height: 18, margin: 0 }}
              checked={(v as number[]).includes(i)} onChange={(e) => set(e.target.checked ? [...v, i].sort() : (v as number[]).filter((x) => x !== i))} />{n}</label>)}</div>;
            else if (s.kind?.startsWith('choice:')) input = <select value={v} onChange={(e) => set(e.target.value)} style={{ maxWidth: 220 }}>{s.kind.slice(7).split(',').map((o: string) => <option key={o} value={o}>{label(o)}</option>)}</select>;
            else if (s.kind === 'emails') input = <textarea rows={3} value={v} onChange={(e) => set(e.target.value)} placeholder="name@company.com, other@company.com" />;
            else input = <input value={v} onChange={(e) => set(e.target.value)} />;
            return (
              <div key={s.key} className="stack" style={{ gap: 4, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
                <b>{s.label}</b><span className="small muted">{s.help}</span>
                <div className="row">{input}{s.editable && <button className="btn sm primary" disabled={!dirty} onClick={() => save(s)}>Save</button>}
                  {!s.editable && <span className="small muted">(fixed)</span>}</div>
              </div>);
          })}</div>
        </Card>))}
      <p className="small muted">Last change: {list.length ? time([...list].sort((a: any, b: any) => b.updated_at.localeCompare(a.updated_at))[0].updated_at) : '—'}. Each change is in the activity log.</p>
    </div>
  );
}

function useMasters() {
  return useLoad(async () => ({
    zones: await select('zones', 'id,name', (b) => b.order('name')), branches: await select('branches', 'id,name', (b) => b.order('name')),
    clients: await select('clients', 'id,name', (b) => b.order('name')), locations: await select('locations', 'id,name', (b) => b.order('name')),
    processes: await select('processes', 'id,name', (b) => b.order('name')),
  }), []);
}
const Opt = ({ list }: { list?: any[] }) => <><option value="">Choose…</option>{(list ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</>;
const EVENTS = [['entry', 'Received cases less cancelled (default)'], ['closure', 'Closures only'], ['net_actioned', 'Net actioned']] as const;

export function SimpleMaster({ table, fields }: { table: string; fields: { k: string; l: string; opts?: string[] }[] }) {
  const d = useLoad(() => select(table, '*', (b) => b.order('name')), [table]);
  const [f, setF] = useState<Record<string, string>>({});
  const [err, setErr] = useState<unknown>(null);
  async function add(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const { error } = await sb.from(table).insert(f);
    if (error) setErr(error); else { setF({}); d.reload(); }
  }
  return (
    <Card title={label(table)}>
      <form className="row" style={{ alignItems: 'end' }} onSubmit={add}>
        {fields.map((x) => <label key={x.k} className="field">{x.l}{x.opts
          ? <select required value={f[x.k] ?? ''} onChange={(e) => setF({ ...f, [x.k]: e.target.value })}><option value="">Choose…</option>{x.opts.map((o) => <option key={o}>{o}</option>)}</select>
          : <input required={x.k === 'code' || x.k === 'name'} value={f[x.k] ?? ''} onChange={(e) => setF({ ...f, [x.k]: e.target.value })} />}</label>)}
        <button className="btn primary">Add</button>
      </form>
      <ErrorBox error={err} />
      {d.loading ? <Loading /> : d.data && (d.data.length === 0 ? <Empty>None yet.</Empty> :
        <div className="tablewrap" tabIndex={0}><table><thead><tr>{fields.map((x) => <th key={x.k}>{x.l}</th>)}<th>Active</th></tr></thead>
          <tbody>{d.data.map((r: any) => <tr key={r.id}>{fields.map((x) => <td key={x.k}>{r[x.k]}</td>)}<td>{r.active ? 'Yes' : 'No'}</td></tr>)}</tbody></table></div>)}
    </Card>
  );
}

function Services() {
  const m = useMasters();
  const d = useLoad(() => select('client_locations', 'id,valid,clients(name),locations(name),processes(name),branches(name)'), []);
  const [f, setF] = useState({ client_id: '', location_id: '', process_id: '', branch_id: '', from: '' });
  const [err, setErr] = useState<unknown>(null);
  async function add(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const { from, ...rest } = f;
    const { error } = await sb.from('client_locations').insert({ ...rest, valid: `[${from},)` });
    if (error) setErr(error); else d.reload();
  }
  return (
    <Card title="Client-location services (who serves which client where)">
      <form className="row" style={{ alignItems: 'end' }} onSubmit={add}>
        {(['client', 'location', 'process', 'branch'] as const).map((k) => <label key={k} className="field">{label(k)}<select required value={(f as any)[k + '_id']} onChange={(e) => setF({ ...f, [k + '_id']: e.target.value })}><Opt list={(m.data as any)?.[k === 'process' ? 'processes' : k === 'branch' ? 'branches' : k + 's']} /></select></label>)}
        <label className="field">From<input required type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <button className="btn primary">Add</button>
      </form>
      <ErrorBox error={err} />
      {d.data && (d.data.length === 0 ? <Empty>No services yet.</Empty> : <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Client</th><th>Location</th><th>Process</th><th>Branch</th><th>Valid</th></tr></thead>
        <tbody>{d.data.map((r: any) => <tr key={r.id}><td>{r.clients?.name}</td><td>{r.locations?.name}</td><td>{r.processes?.name}</td><td>{r.branches?.name}</td><td className="small">{r.valid}</td></tr>)}</tbody></table></div>)}
    </Card>
  );
}

function Rates() {
  const m = useMasters();
  const d = useLoad(() => select('rate_cards', 'id,rate,billable_event,valid,version,reason,clients(name),locations(name),processes(name)', (b) => b.order('created_at', { ascending: false })), []);
  const [f, setF] = useState({ client_id: '', location_id: '', process_id: '', billable_event: 'entry', rate: '', from: '', to: '', reason: '' });
  const [err, setErr] = useState<unknown>(null);
  async function add(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const { error } = await sb.from('rate_cards').insert({ client_id: f.client_id, location_id: f.location_id, process_id: f.process_id, billable_event: f.billable_event,
      rate: Number(f.rate), valid: `[${f.from},${f.to ? f.to : ''})`, reason: f.reason });
    if (error) setErr(/exclusion/.test(error.message) ? new Error('This rate overlaps an existing rate for the same client, location and process. End the old rate first (set its "to" date).') : error);
    else d.reload();
  }
  return (
    <Card title="Rate cards (effective-dated)">
      <p className="small muted">Revenue for targets = cases × rate: an entered case earns once it is in WIP or closed, and a cancellation is subtracted. A new rate applies only from its start date. Earlier work keeps the rate that applied on its date. Rates for a closed month cannot be changed.</p>
      <form className="row" style={{ alignItems: 'end' }} onSubmit={add}>
        {(['client', 'location', 'process'] as const).map((k) => <label key={k} className="field">{label(k)}<select required value={(f as any)[k + '_id']} onChange={(e) => setF({ ...f, [k + '_id']: e.target.value })}><Opt list={(m.data as any)?.[k === 'process' ? 'processes' : k + 's']} /></select></label>)}
        <label className="field">Earns on<select value={f.billable_event} onChange={(e) => setF({ ...f, billable_event: e.target.value })}>{EVENTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
        <label className="field">Rate ₹<input required type="number" min={0} step="0.01" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></label>
        <label className="field">From<input required type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label className="field">Until (exclusive)<input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        <label className="field">Reason<input required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
        <button className="btn primary">Add rate</button>
      </form>
      <ErrorBox error={err} />
      {d.data && (d.data.length === 0 ? <Empty>No rate cards yet.</Empty> : <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Client</th><th>Location</th><th>Process</th><th>Earns on</th><th className="num">Rate</th><th>Valid</th><th>Reason</th></tr></thead>
        <tbody>{d.data.map((r: any) => <tr key={r.id}><td>{r.clients?.name}</td><td>{r.locations?.name}</td><td>{r.processes?.name}</td><td>{EVENTS.find(([v]) => v === r.billable_event)?.[1] ?? r.billable_event}</td><td className="num">{money(r.rate)}</td><td className="small">{r.valid}</td><td className="small">{r.reason}</td></tr>)}</tbody></table></div>)}
    </Card>
  );
}

/** Searchable tick list used for choosing several people or locations. */
function MultiPick({ title, items, value, onChange }: { title: string; items: { id: string; name: string; sub?: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState('');
  const shown = items.filter((i) => `${i.name} ${i.sub ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row"><b>{title}</b><span className="small muted">{value.length} chosen</span><span className="spacer" />
        {value.length > 0 && <button type="button" className="btn sm ghost" onClick={() => onChange([])}>Clear</button>}</div>
      <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${title}`} />
      <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 6 }}>
        {shown.map((i) => <label key={i.id} className="row small" style={{ padding: '3px 2px', gap: 8 }}>
          <input type="checkbox" style={{ width: 'auto', minHeight: 0 }} checked={value.includes(i.id)} onChange={() => toggle(i.id)} />
          <span>{i.name}{i.sub && <span className="muted"> · {i.sub}</span>}</span></label>)}
        {shown.length === 0 && <div className="small muted">Nothing matches.</div>}
      </div>
    </div>
  );
}

function Reopen({ me }: { me: Me }) {
  const persons = useLoad(() => select('persons', 'id,full_name,designation', (b) => b.neq('status', 'exited').order('full_name')), []);
  const branches = useLoad(() => select('branches', 'id,name', (b) => b.eq('active', true).order('name')), []);
  const grants = useLoad(() => select('reopen_grants', '*,persons!reopen_grants_person_id_fkey(full_name)', (b) => b.order('created_at', { ascending: false }).limit(60)), []);
  const [kind, setKind] = useState<'submission' | 'target'>('submission');
  const [people, setPeople] = useState<string[]>([]);
  const [locs, setLocs] = useState<string[]>([]);
  const [f, setF] = useState({ from: me.today, to: me.today, month: me.today.slice(0, 7), team: false, fn: 'operations', hours: '24', reason: '', person: '' });
  const [err, setErr] = useState<unknown>(null);
  const [ok, setOk] = useState('');
  const days = Math.round((Date.parse(f.to) - Date.parse(f.from)) / 864e5) + 1;
  async function go(e: FormEvent) {
    e.preventDefault(); setErr(null); setOk('');
    try {
      const exp = new Date(Date.now() + Number(f.hours) * 3.6e6).toISOString();
      if (kind === 'submission') {
        const r = await rpc('grant_reopen_many', { p_persons: people, p_branches: locs, p_from: f.from, p_to: f.to, p_reason: f.reason, p_expires_at: exp, p_include_team: f.team, p_function: f.fn });
        setOk(`Reopened ${r.grants} day(s) for ${r.people} people (everyone working at or heading the chosen locations is included).`);
      } else {
        await rpc('grant_reopen', { p_kind: 'target', p_person: f.person, p_reason: f.reason, p_expires_at: exp, p_target_month: f.month + '-01', p_include_team: f.team, p_function: f.fn });
        setOk('Target month reopened.');
      }
      grants.reload();
    } catch (x) { setErr(x); }
  }
  return (
    <div className="stack">
      <Card title="Reopen closed days">
        <form className="stack" onSubmit={go}>
          <div className="chips"><button type="button" className={`chip ${kind === 'submission' ? 'on' : ''}`} onClick={() => setKind('submission')}>Daily figures (several people, locations, dates)</button>
            <button type="button" className={`chip ${kind === 'target' ? 'on' : ''}`} onClick={() => setKind('target')}>A locked target month</button></div>
          {kind === 'submission' ? <>
            <div className="grid two">
              <MultiPick title="People" items={(persons.data ?? []).map((p: any) => ({ id: p.id, name: p.full_name, sub: p.designation }))} value={people} onChange={setPeople} />
              <MultiPick title="Locations (everyone working there)" items={(branches.data ?? []).map((b: any) => ({ id: b.id, name: b.name }))} value={locs} onChange={setLocs} />
            </div>
            <div className="row" style={{ alignItems: 'end' }}>
              <label className="field">From<input type="date" value={f.from} max={me.today} onChange={(e) => setF({ ...f, from: e.target.value, to: e.target.value > f.to ? e.target.value : f.to })} /></label>
              <label className="field">To<input type="date" value={f.to} min={f.from} max={me.today} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
              <span className="small muted" style={{ alignSelf: 'center' }}>{days > 0 ? `${days} day(s)` : ''}{days > 32 ? ' — at most 31 days at a time' : ''}</span>
            </div>
          </> : <div className="row" style={{ alignItems: 'end' }}>
            <label className="field">Person<select required value={f.person} onChange={(e) => setF({ ...f, person: e.target.value })}><option value="">Choose…</option>{(persons.data ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
            <label className="field">Month<input type="month" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} /></label></div>}
          <div className="row" style={{ alignItems: 'end' }}>
            <label className="field">Function<select value={f.fn} onChange={(e) => setF({ ...f, fn: e.target.value })}><option value="operations">Operations</option><option value="collections">Collections</option></select></label>
            <label className="field">Open for (hours)<input type="number" min={1} max={168} value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /></label>
            <label className="field" style={{ alignSelf: 'center' }}><span><input type="checkbox" style={{ width: 'auto', minHeight: 0 }} checked={f.team} onChange={(e) => setF({ ...f, team: e.target.checked })} /> Include their teams</span></label>
            <label className="field" style={{ flex: 1 }}>Reason<input required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
            <button className="btn primary" disabled={kind === 'submission' && (!people.length && !locs.length || days < 1 || days > 32)}>Reopen</button>
          </div>
        </form>
        <ErrorBox error={err} />{ok && <div className="banner ok" role="status">{ok}</div>}
      </Card>
      <Card title="Recent reopenings">
        {grants.data && <div className="tablewrap" tabIndex={0}><table><tbody>{grants.data.map((g: any) => <tr key={g.id}><td>{label(g.kind)}</td><td>{g.persons?.full_name}{g.include_team ? ' + team' : ''}</td><td>{g.work_date ?? g.target_month}</td><td className="small">until {time(g.expires_at)}</td><td className="small">{g.reason}</td></tr>)}</tbody></table></div>}
      </Card>
    </div>
  );
}

function MonthClose({ me }: { me: Me }) {
  const prev = (() => { const d = new Date(me.today.slice(0, 7) + '-01T12:00:00'); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();
  const [m, setM] = useState(prev);
  const c = useLoad(() => rpc<any>('month_close_check', { p_month: m + '-01' }), [m]);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState('');
  async function close() { setErr(null); setBusy('close'); try { await rpc('close_month', { p_month: m + '-01', p_reason: note }); c.reload(); } catch (x) { setErr(x); } finally { setBusy(''); } }
  async function backup() {
    setErr(null); setBusy('backup');
    try {
      const b = await rpc('admin_backup');
      const url = URL.createObjectURL(new Blob([JSON.stringify(b)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `crux-iopp-backup-${me.today}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (x) { setErr(x); } finally { setBusy(''); }
  }
  const x = c.data;
  const issues: [string, number][] = x ? [['Open misses in the month', +x.open_misses], ['Days not reported', +x.unsubmitted_days], ['Teams not certified', +x.uncertified],
    ['Collections not reported', +x.collections_missing], ['Services without a rate (any month)', +x.missing_rates], ['Reopened days still open', +x.open_reopens]] : [];
  return (
    <div className="stack">
      <Card title="Month close">
        <div className="row"><label className="field">Month<input type="month" value={m} max={me.today.slice(0, 7)} onChange={(e) => e.target.value && setM(e.target.value)} /></label></div>
        {c.loading ? <Loading /> : <ErrorBox error={c.error} retry={c.reload} />}
        {x && <>
          <div className="grid kpis">
            <div className="kpi"><div className="small muted">Cases (net)</div><b>{Number(x.cases).toLocaleString('en-IN')}</b></div>
            <div className="kpi"><div className="small muted">Revenue</div><b>{money(x.revenue)}</b></div>
            <div className="kpi"><div className="small muted">Billed</div><b>{money(x.billed)}</b></div>
            <div className="kpi"><div className="small muted">Received</div><b>{money(x.received)}</b></div>
          </div>
          <table><tbody>{issues.map(([l, v]) => <tr key={l}><td>{l}</td><td className="num">{v ? <span className="pill warn">{v}</span> : <span className="pill ok">0</span>}</td></tr>)}</tbody></table>
          {x.closed ? <div className="banner ok">Closed on {time(x.closed_info.closed_at)} — {x.closed_info.reason}. Figures and rates for this month are locked; corrections need an Admin reopen.</div> : <>
            <p className="small muted">Closing locks the month's figures and rate cards. Clear the items above first where possible; anything left stays visible as an open miss.</p>
            <div className="row" style={{ alignItems: 'end' }}><label className="field" style={{ flex: 1 }}>Note (required)<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Reviewed with Operations Head" /></label>
              <button className="btn primary" disabled={!note.trim() || busy === 'close' || m >= me.today.slice(0, 7)} onClick={close}>Close {m}</button></div></>}
        </>}
        <ErrorBox error={err} />
      </Card>
      <Card title="Full backup">
        <p className="muted">Downloads every table (people, assignments, figures, targets, rates, collections, tasks, agreements, HR profile summaries and salaries) as one file. Keep it somewhere safe — it contains personal data. It can be restored into a fresh database with <code>tools/restore_backup.sql</code> (tested automatically on every change).</p>
        <button className="btn" onClick={backup} disabled={busy === 'backup'}>{busy === 'backup' ? 'Preparing…' : 'Download backup'}</button>
      </Card>
    </div>
  );
}

function Audit() {
  const [t, setT] = useState('');
  const d = useLoad(() => select('audit_events', 'id,at,table_name,action,reason,actor_person,row_id,before,after', (b) => (t ? b.eq('table_name', t) : b).order('at', { ascending: false }).limit(100)), [t]);
  return (
    <Card title="Audit log (latest 100)" action={<input placeholder="Filter by table, e.g. rate_cards" value={t} onChange={(e) => setT(e.target.value.trim())} style={{ width: 240 }} />}>
      {d.loading ? <Loading /> : <ErrorBox error={d.error} />}
      {d.data && <div className="tablewrap" tabIndex={0}><table><thead><tr><th>When</th><th>Table</th><th>Action</th><th>Reason</th><th>Change</th></tr></thead>
        <tbody>{d.data.map((a: any) => <tr key={a.id}><td className="small">{time(a.at)}</td><td>{a.table_name}</td><td>{a.action}</td><td className="small">{a.reason}</td>
          <td className="small"><details><summary>View</summary><pre style={{ whiteSpace: 'pre-wrap', maxWidth: 520 }}>{JSON.stringify({ before: a.before, after: a.after }, null, 1)}</pre></details></td></tr>)}</tbody></table></div>}
    </Card>
  );
}

function BranchTypes() {
  const d = useLoad(() => select('branches', 'id,name,branch_type,type_confirmed', (b) => b.eq('type_confirmed', false).order('name')), []);
  const [err, setErr] = useState<unknown>(null);
  async function set(id: string, t: string) {
    const { error } = await sb.from('branches').update({ branch_type: t, type_confirmed: true }).eq('id', id);
    if (error) setErr(error); else d.reload();
  }
  return (
    <Card title="Confirm branch type (own / partner)">
      <ErrorBox error={err} />
      {d.data && (d.data.length === 0 ? <Empty>All branch types are confirmed.</Empty> : <table><tbody>{d.data.map((b: any) => <tr key={b.id}><td>{b.name}</td>
        <td><div className="row"><button className="btn sm" onClick={() => set(b.id, 'own')}>Own branch</button><button className="btn sm" onClick={() => set(b.id, 'partner')}>Partner (BA)</button></div></td></tr>)}</tbody></table>)}
      <p className="small muted">Branches loaded from the Zonal Tracker are marked unconfirmed until you choose.</p>
    </Card>
  );
}

function Partners() {
  const branches = useLoad(() => select('branches', 'id,name', (b) => b.order('name')), []);
  const d = useLoad(() => select('partner_share_rules', 'id,partner_share_pct,crux_share_pct,valid,agreement_ref,reason,branches(name)'), []);
  const [f, setF] = useState({ branch_id: '', partner: '80', from: '', ref: '', reason: '' });
  const [err, setErr] = useState<unknown>(null);
  async function add(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const p = Number(f.partner);
    const { error } = await sb.from('partner_share_rules').insert({ branch_id: f.branch_id, partner_share_pct: p, crux_share_pct: 100 - p,
      valid: `[${f.from},)`, agreement_ref: f.ref || null, reason: f.reason });
    if (error) setErr(/exclusion/.test(error.message) ? new Error('This branch already has a ratio for that period. End the old one first.') : error); else d.reload();
  }
  return (
    <Card title="Business Associate ratios (bookkeeping only)">
      <p className="small muted">Recorded for reference only — not used in any revenue calculation. The first number is the partner / BA share, the second is CRUX (e.g. 80 : 20).</p>
      <form className="row" style={{ alignItems: 'end' }} onSubmit={add}>
        <label className="field">Branch<select required value={f.branch_id} onChange={(e) => setF({ ...f, branch_id: e.target.value })}><Opt list={branches.data ?? undefined} /></select></label>
        <label className="field">Partner % (CRUX gets the rest)<input required type="number" min={0} max={100} step="0.01" value={f.partner} onChange={(e) => setF({ ...f, partner: e.target.value })} /></label>
        <label className="field">From<input required type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label className="field">Agreement ref<input value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} /></label>
        <label className="field">Reason<input required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
        <button className="btn primary">Save</button>
      </form>
      <ErrorBox error={err} />
      {d.data && (d.data.length === 0 ? <Empty>No ratios recorded.</Empty> : <table><thead><tr><th>Branch</th><th>Partner : CRUX</th><th>Valid</th><th>Agreement</th></tr></thead>
        <tbody>{d.data.map((r: any) => <tr key={r.id}><td>{r.branches?.name}</td><td>{Number(r.partner_share_pct)} : {Number(r.crux_share_pct)}</td><td className="small">{r.valid}</td><td className="small">{r.agreement_ref}</td></tr>)}</tbody></table>)}
    </Card>
  );
}


/** SOW 6.3: agreement signed / received and the security cheque for each partner (BA) branch. Admin only; audited. */
function PartnerAgreements() {
  const br = useLoad(() => select('branches', 'id,name,branch_type', (b) => b.eq('branch_type', 'partner').order('name')), []);
  const d = useLoad(() => select('partner_agreements', '*'), []);
  const [edit, setEdit] = useState<any | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const row = (id: string) => (d.data ?? []).find((x: any) => x.branch_id === id);
  async function save(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const v = { branch_id: edit.branch_id, agreement_signed: !!edit.agreement_signed, signed_on: edit.signed_on || null, agreement_received: !!edit.agreement_received,
      received_on: edit.received_on || null, document_link: edit.document_link || null, cheque_received: !!edit.cheque_received,
      cheque_amount: edit.cheque_received && edit.cheque_amount !== '' && edit.cheque_amount != null ? Number(edit.cheque_amount) : null,
      cheque_number: edit.cheque_received ? edit.cheque_number || null : null, cheque_bank: edit.cheque_received ? edit.cheque_bank || null : null,
      note: edit.note || null, updated_at: new Date().toISOString() };
    const { error } = await sb.from('partner_agreements').upsert(v, { onConflict: 'branch_id' });
    if (error) setErr(/cheque_number/.test(error.message) ? new Error('Cheque number must be the 6 digits printed on the cheque.') : error); else { setEdit(null); d.reload(); }
  }
  const yn = (b: boolean, dt?: string) => (b ? <Pill status="active" text={dt ? `Yes · ${dt}` : 'Yes'} /> : <Pill status="pending" text="No" />);
  return (
    <Card title="Partner agreements & security cheques (restricted)">
      <p className="small muted">Only Admin can change these; Admin, Operations Head and Leadership can see them. Keep the signed agreement in the company drive and paste its link. No bank account numbers are stored.</p>
      {br.data && (br.data.length === 0 ? <Empty>No branches are marked as partner yet (see “Own / partner branch”).</Empty> : <div className="tablewrap" tabIndex={0}><table>
        <thead><tr><th>Partner branch</th><th>Agreement signed</th><th>Agreement received</th><th>Security cheque</th><th></th></tr></thead>
        <tbody>{br.data.map((b: any) => { const r = row(b.id) ?? {}; return <tr key={b.id}><td>{b.name}</td><td>{yn(r.agreement_signed, r.signed_on)}</td>
          <td>{yn(r.agreement_received, r.received_on)}{r.document_link && <div className="small"><a href={r.document_link} target="_blank" rel="noreferrer">document</a></div>}</td>
          <td>{r.cheque_received ? <span className="small">{money(r.cheque_amount)} · no. {r.cheque_number ?? '—'} · {r.cheque_bank ?? '—'}</span> : <Pill status="pending" text="Not received" />}</td>
          <td><button className="btn sm" onClick={() => setEdit({ branch_id: b.id, name: b.name, ...r })}>Edit</button></td></tr>; })}</tbody></table></div>)}
      {edit && <form className="stack" style={{ marginTop: 12 }} onSubmit={save}>
        <b>{edit.name}</b>
        <div className="grid two">
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" style={{ width: 'auto', minHeight: 0 }} checked={!!edit.agreement_signed} onChange={(e) => setEdit({ ...edit, agreement_signed: e.target.checked })} /> Agreement signed</label>
          <label className="field">Signed on<input type="date" value={edit.signed_on ?? ''} onChange={(e) => setEdit({ ...edit, signed_on: e.target.value })} /></label>
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" style={{ width: 'auto', minHeight: 0 }} checked={!!edit.agreement_received} onChange={(e) => setEdit({ ...edit, agreement_received: e.target.checked })} /> Signed copy received</label>
          <label className="field">Received on<input type="date" value={edit.received_on ?? ''} onChange={(e) => setEdit({ ...edit, received_on: e.target.value })} /></label>
          <label className="field">Document link (https)<input value={edit.document_link ?? ''} onChange={(e) => setEdit({ ...edit, document_link: e.target.value })} /></label>
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" style={{ width: 'auto', minHeight: 0 }} checked={!!edit.cheque_received} onChange={(e) => setEdit({ ...edit, cheque_received: e.target.checked })} /> Security cheque received</label>
          {edit.cheque_received && <>
            <label className="field">Cheque amount ₹<input type="number" min={0} value={edit.cheque_amount ?? ''} onChange={(e) => setEdit({ ...edit, cheque_amount: e.target.value })} /></label>
            <label className="field">Cheque number (6 digits)<input inputMode="numeric" maxLength={6} value={edit.cheque_number ?? ''} onChange={(e) => setEdit({ ...edit, cheque_number: e.target.value.replace(/\D/g, '') })} /></label>
            <label className="field">Bank name<input value={edit.cheque_bank ?? ''} onChange={(e) => setEdit({ ...edit, cheque_bank: e.target.value })} /></label></>}
          <label className="field">Note<input value={edit.note ?? ''} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></label>
        </div>
        <ErrorBox error={err} />
        <div className="row"><button className="btn primary">Save</button><button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button></div>
      </form>}
    </Card>
  );
}


function Compliance() {
  const d = useLoad(async () => ({
    people: await select('persons', 'id,full_name,mobile,status,resource_type', (b) => b.neq('status', 'exited').order('full_name')),
    acc: await select('agreement_acceptances', 'person_id,version,accepted_at,typed_name,ip,user_agent'),
    prof: await select('hr_profiles', '*'),
    sal: await select('hr_compensation', 'person_id,monthly_gross,effective_from'),
    ver: await select('settings', 'key,value', (b) => b.eq('key', 'agreement_version')),
  }), []);
  const [q, setQ] = useState('');
  const [show, setShow] = useState<string | null>(null);
  if (d.loading) return <Loading rows={5} />;
  if (d.error) return <ErrorBox error={d.error} retry={d.reload} />;
  const v = String(d.data!.ver.find((x: any) => x.key === 'agreement_version')?.value ?? 'v1').replace(/"/g, '');
  const rows = d.data!.people.filter((p: any) => p.full_name.toLowerCase().includes(q.toLowerCase())).map((p: any) => ({
    p, a: d.data!.acc.filter((a: any) => a.person_id === p.id).sort((x: any, y: any) => y.accepted_at.localeCompare(x.accepted_at))[0],
    h: d.data!.prof.find((h: any) => h.person_id === p.id), s: d.data!.sal.filter((s: any) => s.person_id === p.id).sort((x: any, y: any) => y.effective_from.localeCompare(x.effective_from))[0] }));
  const signed = rows.filter((r: any) => r.a?.version === v).length, done = rows.filter((r: any) => r.h?.completed_at).length;
  return (
    <div className="stack">
      <Card title={`Agreement ${v}: ${signed} of ${rows.length} signed · profiles complete: ${done} of ${rows.length}`} action={<input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 180 }} aria-label="Search people" />}>
        <div className="tablewrap" tabIndex={0}><table>
          <thead><tr><th>Person</th><th>Agreement</th><th>Signed at · from</th><th>Profile</th><th className="num">Salary</th><th></th></tr></thead>
          <tbody>{rows.map(({ p, a, h, s }: any) => <Fragment key={p.id}>
            <tr><td><b>{p.full_name}</b><div className="small muted">{p.mobile ?? 'no mobile'} · {p.status === 'invited' ? 'not activated' : p.status}</div></td>
              <td>{a?.version === v ? <span className="pill ok">Signed {a.version}</span> : a ? <span className="pill warn">Old {a.version}</span> : <span className="pill bad">Not signed</span>}</td>
              <td className="small">{a ? <>{time(a.accepted_at)} as “{a.typed_name}”<div className="muted">{a.ip || 'address not captured'} · {(a.user_agent ?? '').slice(0, 40)}</div></> : '—'}</td>
              <td>{h?.completed_at ? <span className="pill ok">Complete</span> : h ? <span className="pill warn">Incomplete</span> : <span className="pill bad">Not started</span>}</td>
              <td className="num">{p.resource_type === 'partner' ? <span className="small muted">partner</span> : s ? `₹${Number(s.monthly_gross).toLocaleString('en-IN')}` : <span className="pill warn">missing</span>}</td>
              <td>{h && <button className="btn sm" onClick={() => setShow(show === p.id ? null : p.id)}>{show === p.id ? 'Hide' : 'Profile'}</button>}</td></tr>
            {show === p.id && h && <tr><td colSpan={6}><div className="grid two small">{Object.entries(h).filter(([k]) => !['person_id', 'updated_at'].includes(k)).map(([k, val]) =>
              <div key={k}><span className="muted">{label(k)}:</span> {String(val ?? '—')}</div>)}</div></td></tr>}
          </Fragment>)}</tbody></table></div>
        <p className="small muted">Full Aadhaar, PAN and bank numbers are in each person's profile (HR / Admin only). To make everyone sign again (e.g. after a policy change), add a new agreement version and change "User agreement version" in Settings.</p>
      </Card>
    </div>
  );
}

/** Leave types (monthly credit), national / regional holidays and penalty rules. Empty until the owner sets a policy. */
function Policies() {
  const lt = useLoad(() => select('leave_types', '*', (b) => b.order('code')), []);
  const hol = useLoad(() => select('holidays', '*', (b) => b.order('holiday_date')), []);
  const pr = useLoad(() => select('penalty_rules', '*', (b) => b.order('code')), []);
  const [l, setL] = useState({ code: '', name: '', monthly_credit: '', max_per_year: '', carry_forward_max: '', applies_to: 'all' });
  const [h, setH] = useState({ holiday_date: '', name: '', scope: 'national', state: '' });
  const [err, setErr] = useState<unknown>(null);
  const run = async (fn: () => PromiseLike<{ error: unknown }>, done: () => void) => { setErr(null); const r = await fn(); if (r.error) setErr(r.error); else done(); };
  return (
    <div className="stack">
      <ErrorBox error={err} />
      <Card title="Leave types and monthly credits">
        <p className="small muted">No leave policy yet, so this is empty and the app shows leave taken only. Add a type (e.g. Casual leave, 1 day credited per month) when the policy is final; balances will then be credited every month.</p>
        {lt.data && (lt.data.length === 0 ? <Empty>No leave types.</Empty> : <table><thead><tr><th>Code</th><th>Name</th><th className="num">Credit / month</th><th className="num">Max / year</th><th className="num">Carry forward</th><th>For</th><th>Active</th></tr></thead>
          <tbody>{lt.data.map((x: any) => <tr key={x.id}><td>{x.code}</td><td>{x.name}</td><td className="num">{x.monthly_credit}</td><td className="num">{x.max_per_year ?? '—'}</td><td className="num">{x.carry_forward_max ?? '—'}</td><td>{label(x.applies_to)}</td>
            <td><input type="checkbox" style={{ width: 'auto', minHeight: 0 }} checked={x.active} onChange={(e) => run(() => sb.from('leave_types').update({ active: e.target.checked }).eq('id', x.id), lt.reload)} /></td></tr>)}</tbody></table>)}
        <form className="row" style={{ alignItems: 'end' }} onSubmit={(e) => { e.preventDefault(); run(() => sb.from('leave_types').insert({ code: l.code.trim().toUpperCase(), name: l.name.trim(), monthly_credit: Number(l.monthly_credit || 0),
          max_per_year: l.max_per_year ? Number(l.max_per_year) : null, carry_forward_max: l.carry_forward_max ? Number(l.carry_forward_max) : null, applies_to: l.applies_to }),
          () => { setL({ code: '', name: '', monthly_credit: '', max_per_year: '', carry_forward_max: '', applies_to: 'all' }); lt.reload(); }); }}>
          <label className="field">Code<input required value={l.code} onChange={(e) => setL({ ...l, code: e.target.value })} style={{ width: 90 }} /></label>
          <label className="field">Name<input required value={l.name} onChange={(e) => setL({ ...l, name: e.target.value })} /></label>
          <label className="field">Credit / month<input type="number" min={0} step="0.5" value={l.monthly_credit} onChange={(e) => setL({ ...l, monthly_credit: e.target.value })} style={{ width: 110 }} /></label>
          <label className="field">Max / year<input type="number" min={0} value={l.max_per_year} onChange={(e) => setL({ ...l, max_per_year: e.target.value })} style={{ width: 100 }} /></label>
          <label className="field">Carry forward<input type="number" min={0} value={l.carry_forward_max} onChange={(e) => setL({ ...l, carry_forward_max: e.target.value })} style={{ width: 110 }} /></label>
          <label className="field">For<select value={l.applies_to} onChange={(e) => setL({ ...l, applies_to: e.target.value })}><option value="all">Everyone</option><option value="own_employee">Own employees</option><option value="partner">Business Associates</option></select></label>
          <button className="btn">Add leave type</button></form>
      </Card>
      <Card title="Holidays — national and regional">
        <p className="small muted">National holidays apply everywhere; regional holidays apply to locations in that state. Holidays are not working days (no report due, no absence).</p>
        {hol.data && (hol.data.length === 0 ? <Empty>No holidays entered.</Empty> : <table><tbody>{hol.data.map((x: any) => <tr key={x.id}><td>{x.holiday_date}</td><td>{x.name}</td><td>{x.scope === 'national' || x.scope === 'public' ? 'National' : `Regional · ${x.state ?? ''}`}</td></tr>)}</tbody></table>)}
        <form className="row" style={{ alignItems: 'end' }} onSubmit={(e) => { e.preventDefault(); run(() => sb.from('holidays').insert({ holiday_date: h.holiday_date, name: h.name.trim(), scope: h.scope, state: h.scope === 'regional' ? h.state.trim() : null }),
          () => { setH({ holiday_date: '', name: '', scope: 'national', state: '' }); hol.reload(); }); }}>
          <label className="field">Date<input type="date" required value={h.holiday_date} onChange={(e) => setH({ ...h, holiday_date: e.target.value })} /></label>
          <label className="field">Name<input required value={h.name} onChange={(e) => setH({ ...h, name: e.target.value })} /></label>
          <label className="field">Applies to<select value={h.scope} onChange={(e) => setH({ ...h, scope: e.target.value })}><option value="national">National</option><option value="regional">Regional (one state)</option></select></label>
          {h.scope === 'regional' && <label className="field">State code<input required placeholder="e.g. MH" value={h.state} onChange={(e) => setH({ ...h, state: e.target.value })} style={{ width: 90 }} /></label>}
          <button className="btn">Add holiday</button></form>
      </Card>
      <Card title="Penalty rules">
        <p className="small muted">Record only — no pay effect until an HR/legal-approved policy switches a rule on.</p>
        {pr.data && <table><tbody>{pr.data.map((x: any) => <tr key={x.id}><td>{x.code}</td><td>{x.description}</td><td className="num">{x.amount != null ? money(x.amount) : '—'}</td><td>{x.financial_enabled ? 'Affects pay' : 'Record only'}</td><td>{x.active ? 'Active' : 'Off'}</td></tr>)}</tbody></table>}
      </Card>
    </div>
  );
}

/** Clients, their Product Head (optional) and adding a new client; after adding, one click tells the people who need to know. */
function ClientsList() {
  const d = useLoad(async () => ({
    clients: await select('clients', 'id,code,name,client_family,active', (b) => b.order('name')),
    heads: await select('product_heads', 'id,client_id,product,valid,persons(full_name)'),
    people: await select('persons', 'id,full_name', (b) => b.in('status', ['active', 'invited']).order('full_name')),
  }), []);
  const [f, setF] = useState({ name: '', code: '', head: '', product: '' });
  const [err, setErr] = useState<unknown>(null);
  const [added, setAdded] = useState('');
  const [busy, setBusy] = useState(false);
  const live = (v: string) => { const m = /^[\[(]([^,]*),([^)\]]*)/.exec(v ?? ''); return !!m && (!m[2] || new Date().toISOString().slice(0, 10) < m[2]); };
  return (
    <div className="stack">
      <Card title="Add a client">
        <form className="grid two" onSubmit={async (e: FormEvent) => {
          e.preventDefault(); setBusy(true); setErr(null); setAdded('');
          try { await rpc('add_client', { p_name: f.name.trim(), p_code: f.code.trim() || null, p_product_head: f.head || null, p_product: f.product.trim() || null });
            setAdded(f.name.trim().toUpperCase()); setF({ name: '', code: '', head: '', product: '' }); d.reload(); }
          catch (x) { setErr(x); } finally { setBusy(false); }
        }}>
          <label className="field">Client name<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="field">Short code (optional)<input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></label>
          <label className="field">Product Head (optional)<select value={f.head} onChange={(e) => setF({ ...f, head: e.target.value })}><option value="">None</option>
            {(d.data?.people ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
          <label className="field">Product name (optional, e.g. BOM MSME)<input value={f.product} disabled={!f.head} onChange={(e) => setF({ ...f, product: e.target.value })} /></label>
          <div><button className="btn primary" disabled={busy || !f.name.trim()}>Add client</button></div>
        </form>
        <p className="small muted">Names are saved in capitals. Next: Client at location (where it is served) and Per-case rates. A Product Head sees every location and person for their product.</p>
        <ErrorBox error={err} />
      </Card>
      {added && <SendAlert key={added} title={`Tell people about ${added}`} initial={`New client ${added} has been added. Tick it in My day if you work on it.`} />}
      <Card title="Clients">
        {d.loading ? <Loading /> : <ErrorBox error={d.error} retry={d.reload} />}
        {d.data && <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Client</th><th>Code</th><th>Family</th><th>Product Head</th><th>Active</th></tr></thead>
          <tbody>{d.data.clients.map((c: any) => <tr key={c.id}><td><b>{c.name}</b></td><td>{c.code}</td><td>{c.client_family ?? ''}</td>
            <td>{d.data!.heads.filter((h: any) => h.client_id === c.id && live(h.valid)).map((h: any) => `${h.persons?.full_name} (${h.product})`).join(', ') || '—'}</td>
            <td>{c.active ? 'Yes' : 'No'}</td></tr>)}</tbody></table></div>}
      </Card>
    </div>
  );
}

/** Assistant to a leader — an Executive Assistant (sees what the leader sees, cannot enter figures) or an Assistant Branch Manager
 *  (sees what their Branch Manager sees and keeps their own work and team) — and Product Head for clients. */
function AssistantProduct({ me, personId, people, clients, roles, onChange }: { me: Me; personId: string; people: any[]; clients: any[]; roles: string[]; onChange: () => void }) {
  const d = useLoad(async () => ({
    ea: await select('ea_assignments', 'id,principal,valid', (b) => b.eq('ea_person', personId)),
    ph: await select('product_heads', 'id,client_id,product,valid,clients(name)', (b) => b.eq('person_id', personId)),
  }), [personId]);
  const [pr, setPr] = useState('');
  const [pc, setPc] = useState({ client: '', product: '' });
  const [err, setErr] = useState<unknown>(null);
  const [ok, setOk] = useState('');
  const today = me.today;
  const live = (v: string) => { const m = /^[\[(]([^,]*),([^)\]]*)/.exec(v ?? ''); return !!m && (!m[1] || m[1] <= today) && (!m[2] || today < m[2]); };
  const nm = (id: string) => people.find((q) => q.id === id)?.full_name ?? '—';
  // an Assistant Branch Manager (or anyone who already works as a manager) keeps their own role; only a pure assistant gets the EA role
  const deputy = /assistant branch manager/i.test(people.find((q) => q.id === personId)?.designation ?? '') || roles.some((r) => ['manager', 'bm', 'zm'].includes(r));
  const ensureRole = async (role: string) => { if (!roles.includes(role)) { const { error } = await sb.from('role_assignments').insert({ person_id: personId, role, valid: `[${today},)`, reason: 'added by admin' }); if (error) throw error; } };
  const run = async (fn: () => Promise<unknown>, msg: string) => { setErr(null); setOk(''); try { await fn(); setOk(msg); d.reload(); onChange(); } catch (e) { setErr(e); } };
  const end = (table: string, id: string) => run(() => rpc('end_assignment', { p_table: table, p_id: id, p_last_day: today, p_reason: 'ended by admin' }), 'Ended (last day today).');
  const ea = (d.data?.ea ?? []).filter((r: any) => live(r.valid));
  const ph = (d.data?.ph ?? []).filter((r: any) => live(r.valid));
  return (
    <Card title="Assistant to · Product Head for">
      <div className="stack">
        {d.loading ? <Loading rows={2} /> : <>
          {ea.map((r: any) => <div key={r.id} className="row small"><span>{deputy ? 'Assistant Branch Manager to' : 'Executive Assistant to'} <b>{nm(r.principal)}</b> since {lowerOf(r.valid)}</span><span className="spacer" /><button className="btn sm" onClick={() => end('ea_assignments', r.id)}>End</button></div>)}
          {ph.map((r: any) => <div key={r.id} className="row small"><span>Product Head · <b>{r.product}</b> ({r.clients?.name})</span><span className="spacer" /><button className="btn sm" onClick={() => end('product_heads', r.id)}>End</button></div>)}
          {!ea.length && !ph.length && <Empty>Neither.</Empty>}</>}
        <div className="row"><select value={pr} onChange={(e) => setPr(e.target.value)} aria-label="Assistant to"><option value="">{deputy ? 'Make Assistant Branch Manager to…' : 'Make Executive Assistant to…'}</option>
          {people.filter((q) => q.id !== personId).map((q) => <option key={q.id} value={q.id}>{q.full_name}</option>)}</select>
          <button className="btn" disabled={!pr} onClick={() => run(async () => {
            const { error } = await sb.from('ea_assignments').insert({ ea_person: personId, principal: pr, valid: `[${today},)`, reason: 'set by admin' }); if (error) throw error;
            if (!deputy) await ensureRole('ea'); setPr(''); }, deputy ? 'Saved. They now also see what their Branch Manager sees (read only) and can assign tasks on the Branch Manager\'s behalf. Their own work and team are unchanged.'
              : 'Saved. They now see what their leader sees (read only), and can assign tasks on the leader\'s behalf.')}>Save</button></div>
        <div className="row"><select value={pc.client} onChange={(e) => setPc({ ...pc, client: e.target.value })} aria-label="Product client"><option value="">Make Product Head for client…</option>
          {clients.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input placeholder="Product name (e.g. BOM MSME)" value={pc.product} onChange={(e) => setPc({ ...pc, product: e.target.value })} aria-label="Product name" />
          <button className="btn" disabled={!pc.client} onClick={() => run(async () => {
            const { error } = await sb.from('product_heads').insert({ person_id: personId, client_id: pc.client, product: (pc.product.trim() || clients.find((c: any) => c.id === pc.client)?.name).toUpperCase(), valid: `[${today},)`, reason: 'set by admin' });
            if (error) throw error; await ensureRole('product_head'); setPc({ client: '', product: '' }); }, 'Saved. They see every location and person for this product, and can correct figures (the person is told).')}>Save</button></div>
        <p className="small muted">A product made of several clients (e.g. BOM MSME PRE and POST): add each client with the same product name.</p>
        <ErrorBox error={err} />{ok && <div className="banner ok" role="status">{ok}</div>}
      </div>
    </Card>
  );
}

/** HR repository (HR / Admin): everyone's profile, documents, police verification, salary and partner terms in one place. */
function HrRepository({ me }: { me: Me }) {
  const q0 = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const [t, setT] = useState<'people' | 'partners' | 'police' | 'agreements'>(() => (q0.get('t') === 'police' ? 'police' : 'people'));
  const d = useLoad(() => rpc<any[]>('hr_repository'), []);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | 'own' | 'partner' | 'verify'>(() => (q0.get('k') === 'verify' ? 'verify' : 'all'));
  // opened from a notification (?p=person): that person, open (D-101)
  const [open, setOpen] = useState<string | null>(() => new URLSearchParams(location.hash.split('?')[1] ?? '').get('p'));
  useEffect(() => { if (open) window.setTimeout(() => document.getElementById('hr-' + open)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 300); }, [d.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const all = (d.data ?? []) as any[];
  const toVerify = (r: any) => Object.values(r.docs ?? {}).reduce((a: number, x: any) => a + (x.n - x.verified - x.rejected), 0) as number;
  const rows = all.filter((r) => (kind === 'all' || (kind === 'verify' ? toVerify(r) > 0 : (kind === 'partner') === (r.resource_type === 'partner')))
    && `${r.full_name} ${r.designation ?? ''} ${r.location ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  // the core set differs: a Business Associate needs the agreement and security cheque, an employee the offer / appointment letter (D-129)
  const core = ['aadhaar', 'pan', 'address_proof', 'bank', 'qualification'];
  const needFor = (r: any) => (r.resource_type === 'partner' ? ['partner_agreement', 'security_cheque', ...core] : ['offer_letter', ...core]);
  return (
    <div className="stack">
      <Tabs tabs={[['people', 'People & documents'], ['partners', 'Business Associates checklist'], ['police', 'Police verification'], ['agreements', 'App terms & profiles']]} value={t} onChange={setT} />
      {t === 'people' && !(me.hidden_pages ?? []).includes('adm_doccheck') && <div className="banner info">To compare an uploaded document with its recorded details side by side, use <Link to="/admin?s=doccheck"><b>Document check</b></Link>.</div>}
      {t === 'partners' && <PartnerChecklist me={me} />}
      {t === 'police' && <PoliceVerification me={me} all />}
      {t === 'agreements' && <Compliance />}
      {t === 'people' && <Card title={`${rows.length} people`} action={<div className="row">
        <Tabs tabs={[['all', `All (${all.length})`], ['verify', `To verify (${all.filter((r) => toVerify(r) > 0).length})`], ['own', `CRUX employees (${all.filter((r) => r.resource_type !== 'partner').length})`], ['partner', `Partners / BA (${all.filter((r) => r.resource_type === 'partner').length})`]]} value={kind} onChange={setKind} />
        <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 180 }} aria-label="Search people" /></div>}>
        {d.loading ? <Loading rows={5} /> : <ErrorBox error={d.error} retry={d.reload} />}
        {d.data && <div className="tablewrap" tabIndex={0}><table>
          <thead><tr><th>Person</th><th>Profile</th><th>Documents</th><th>Police</th><th className="num">Salary</th><th /></tr></thead>
          <tbody>{rows.map((r) => { const missing = needFor(r).filter((k) => !r.docs?.[k] && !(k === 'offer_letter' && r.docs?.agreement)); const unverified = Object.values(r.docs ?? {}).reduce((a: number, x: any) => a + (x.n - x.verified - x.rejected), 0) as number;
            return <Fragment key={r.person_id}>
              <tr id={'hr-' + r.person_id}><td><b>{r.full_name}</b><div className="small muted">{r.designation ?? ''}{r.manager ? ` · reports to ${r.manager}` : ''}{r.location ? ` · ${r.location}` : ''}{r.status === 'invited' ? ' · not activated' : ''}</div></td>
                <td>{r.profile_complete ? <span className="pill ok">Complete</span> : <span className="pill warn">Incomplete</span>}{r.agreement_signed ? '' : <div><span className="pill bad">App terms not accepted</span></div>}</td>
                <td className="small">{missing.length ? <span className="pill warn">Missing: {missing.map((k) => DOC_TYPES.find(([x]) => x === k)?.[1]).join(', ')}</span> : <span className="pill ok">Core set on file</span>}
                  {unverified > 0 && <div><span className="pill info">{unverified} to verify</span></div>}</td>
                <td><span className={`pill ${r.police === 'verified' || r.police === 'not_required' ? 'ok' : r.police_due < me.today ? 'bad' : 'warn'}`}>{label(r.police)}</span>
                  {!['verified', 'not_required'].includes(r.police) && <div className="small muted">due {r.police_due}</div>}</td>
                <td className="num">{r.resource_type === 'partner' ? <span className="small muted">partner</span> : r.salary ? <>{money(r.salary)}<div className="small muted">from {r.salary_from}</div></> : <span className="pill warn">missing</span>}</td>
                <td><button className="btn sm" onClick={() => setOpen(open === r.person_id ? null : r.person_id)}>{open === r.person_id ? 'Close' : 'Open'}</button></td></tr>
              {open === r.person_id && <tr><td colSpan={6}><div className="stack">
                {r.partner && <div className="small">{r.partner.map((x: any, i: number) => <div key={i}><b>Partner · {x.location}</b>: agreement {x.agreement_signed ? `signed ${x.signed_on ?? ''}` : 'not signed'} · security cheque {x.cheque_received ? `received ${money(x.cheque_amount)}` : 'not received'}{x.ratio != null ? ` · partner share ${x.ratio}%` : ''}</div>)}</div>}
                <PersonProfile me={me} personId={r.person_id} hr onChange={d.reload} />
                <Documents me={me} personId={r.person_id} title={`Upload a document for ${r.full_name}`} hr uploadOnly onUploaded={d.reload} />
                <div className="grid two"><EmploymentCard personId={r.person_id} onSaved={d.reload} /><SalaryHistory me={me} personId={r.person_id} partner={r.resource_type === 'partner'} /></div>
              </div></td></tr>}
            </Fragment>; })}</tbody></table></div>}
        <p className="small muted">Salary is visible only to HR, Admin and the person. Managers see the profile (ID numbers masked) and police verification of their team.</p>
      </Card>}
    </div>
  );
}

/** Business Associates (the partners themselves, not their staff): agreement and security cheque checklist with the papers. */
function PartnerChecklist({ me }: { me: Me }) {
  const d = useLoad(() => rpc<any[]>('partner_checklist'), []);
  const [ed, setEd] = useState<any | null>(null);
  const [docs, setDocs] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const rows = (d.data ?? []) as any[];
  const yes = (b: boolean) => <span className={`pill ${b ? 'ok' : 'bad'}`}>{b ? 'Yes' : 'No'}</span>;
  return (
    <div className="stack">
      <Card title={`${rows.filter((r) => r.complete).length} of ${rows.length} Business Associate(s) complete`}>
        <p className="small muted">Complete = agreement signed and received, security cheque received, and the signed agreement and cheque copy uploaded. One row per BA and partner branch.</p>
        {d.loading ? <Loading rows={3} /> : <ErrorBox error={d.error} retry={d.reload} />}
        {d.data && (rows.length === 0 ? <Empty>No Business Associates.</Empty> :
          <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Business Associate</th><th>Branch</th><th>Agreement signed</th><th>Agreement received</th><th>Security cheque</th><th>Papers</th><th /></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.person_id + (r.branch_id ?? '')}>
              <td><b>{r.full_name}</b>{r.status === 'invited' && <div className="small muted">not activated</div>}{r.complete && <div><span className="pill ok small">Complete</span></div>}</td>
              <td>{r.branch ?? <span className="muted small">no branch set</span>}</td>
              <td>{yes(r.agreement_signed)}{r.signed_on ? <div className="small muted">{r.signed_on}</div> : null}</td>
              <td>{yes(r.agreement_received)}{r.received_on ? <div className="small muted">{r.received_on}</div> : null}</td>
              <td>{yes(r.cheque_received)}{r.cheque_received && <div className="small muted">{money(r.cheque_amount)} · no. {r.cheque_number ?? '—'} · {r.cheque_bank ?? ''}{r.cheque_date ? ` · ${r.cheque_date}` : ''}</div>}</td>
              <td className="small">{['partner_agreement', 'security_cheque', 'pan', 'aadhaar', 'cancelled_cheque'].map((k) => <span key={k} className={`pill ${r.docs?.[k] || (k === 'partner_agreement' && r.docs?.agreement) ? 'ok' : 'neutral'} small`}>{DOC_TYPES.find(([x]) => x === k)?.[1] ?? label(k)}</span>)}</td>
              <td><div className="row"><button className="btn sm" disabled={!r.branch_id} onClick={() => setEd({ ...r })}>Update</button><button className="btn sm" onClick={() => setDocs(docs === r.person_id ? null : r.person_id)}>Papers</button></div></td></tr>)}</tbody></table></div>)}
      </Card>
      {ed && <Card title={`${ed.full_name} · ${ed.branch}`}>
        <div className="grid two">
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" style={{ width: 'auto', minHeight: 0 }} checked={ed.agreement_signed} onChange={(e) => setEd({ ...ed, agreement_signed: e.target.checked })} /> Agreement signed</label>
          <label className="field">Signed on<input type="date" value={ed.signed_on ?? ''} onChange={(e) => setEd({ ...ed, signed_on: e.target.value })} /></label>
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" style={{ width: 'auto', minHeight: 0 }} checked={ed.agreement_received} onChange={(e) => setEd({ ...ed, agreement_received: e.target.checked })} /> Signed agreement received by CRUX</label>
          <label className="field">Received on<input type="date" value={ed.received_on ?? ''} onChange={(e) => setEd({ ...ed, received_on: e.target.value })} /></label>
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" style={{ width: 'auto', minHeight: 0 }} checked={ed.cheque_received} onChange={(e) => setEd({ ...ed, cheque_received: e.target.checked })} /> Security cheque received</label>
          {ed.cheque_received && <>
            <label className="field">Cheque amount ₹<input type="number" min={1} value={ed.cheque_amount ?? ''} onChange={(e) => setEd({ ...ed, cheque_amount: e.target.value })} /></label>
            <label className="field">Cheque number (6 digits)<input inputMode="numeric" maxLength={6} value={ed.cheque_number ?? ''} onChange={(e) => setEd({ ...ed, cheque_number: e.target.value.replace(/\D/g, '') })} /></label>
            <label className="field">Bank<input value={ed.cheque_bank ?? ''} onChange={(e) => setEd({ ...ed, cheque_bank: e.target.value })} /></label>
            <label className="field">Cheque date<input type="date" value={ed.cheque_date ?? ''} onChange={(e) => setEd({ ...ed, cheque_date: e.target.value })} /></label></>}
          <label className="field">Note<input value={ed.note ?? ''} onChange={(e) => setEd({ ...ed, note: e.target.value })} /></label>
        </div>
        <ErrorBox error={err} />
        <div className="row"><button className="btn primary sm" onClick={async () => { setErr(null);
          try { await rpc('set_partner_checklist', { p_branch: ed.branch_id, p: ed }); setEd(null); d.reload(); } catch (e) { setErr(e); } }}>Save</button><button className="btn sm" onClick={() => setEd(null)}>Cancel</button></div>
      </Card>}
      {docs && <Documents me={me} personId={docs} title={`Papers · ${rows.find((r) => r.person_id === docs)?.full_name ?? ''}`} hr
        types={['partner_agreement', 'security_cheque', 'pan', 'aadhaar', 'address_proof', 'cancelled_cheque', 'bank', 'kyc_other', 'other']} />}
    </div>
  );
}


/** Data quality (D-104): everyone whose details are missing or wrong, a breakdown by problem, and the ops gaps. */
function DataQuality({ me }: { me: Me }) {
  const d = useLoad(() => rpc<any>('data_quality'), []);
  const ops = useLoad(() => rpc<any>('ops_anomalies', {}), []);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState('');
  const [addIfsc, setAddIfsc] = useState(''); const [addName, setAddName] = useState(''); const [bankMsg, setBankMsg] = useState('');
  const isAdmin = has(me, 'admin');
  return (
    <div className="stack">
      {d.loading ? <Loading rows={4} /> : <ErrorBox error={d.error} retry={d.reload} />}
      {d.data && <>
        <Card title={`${d.data.clean} of ${d.data.total_people} people have all details correct`}
          action={<button className="btn sm primary" disabled={busy} onClick={async () => { setBusy(true); setOk(''); try { const n = await rpc<number>('remind_corrections_now'); setOk(`Reminded ${n} people.`); } finally { setBusy(false); } }}>Remind everyone to fix</button>}>
          {ok && <div className="banner ok" role="status">{ok}</div>}
          {(d.data.by_problem ?? []).length === 0 ? <div className="banner ok">Every record is complete and valid.</div> :
            <div className="chips">{d.data.by_problem.map((p: any) => <span key={p.code} className={`pill ${p.severity === 'high' ? 'bad' : p.severity === 'medium' ? 'warn' : 'neutral'}`}>{p.label}: {p.count}</span>)}</div>}
        </Card>
        {(d.data.people ?? []).length > 0 && <Card collapsible defaultOpen={false} title={`${d.data.people.length} ${d.data.people.length === 1 ? 'person' : 'people'} to correct`}>
          <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Person</th><th>Issues</th><th /></tr></thead>
            <tbody>{d.data.people.map((r: any) => <Fragment key={r.person_id}>
              <tr><td><b>{r.full_name}</b><div className="small muted">{r.designation ?? ''}{r.status === 'invited' ? ' · not activated' : ''}</div></td>
                <td>{r.high > 0 && <span className="pill bad small">{r.high} important</span>} <span className="pill neutral small">{r.n} in all</span></td>
                <td className="row"><button className="btn sm" onClick={() => setOpen(open === r.person_id ? null : r.person_id)}>{open === r.person_id ? 'Hide' : 'See'}</button>
                  <Link className="btn sm" to={`/admin?s=compliance&p=${r.person_id}`}>Open profile</Link></td></tr>
              {open === r.person_id && <tr><td colSpan={3}><DataIssueList issues={r.issues} /></td></tr>}
            </Fragment>)}</tbody></table></div>
        </Card>}
        {ops.data && <Card title="Operational gaps this month" help="Days people were due to report but did not, and figures they flagged as not tallying. Chase the person or reopen the day to correct.">
          <div className="row"><span className="pill warn">{ops.data.not_reported_count} day(s) not reported</span>
            <span className="pill neutral">{(ops.data.untallied ?? []).length} line(s) flagged as not tallying</span></div>
          {(ops.data.not_reported ?? []).length > 0 && <div className="small muted" style={{ marginTop: 8 }}>Not reported: {ops.data.not_reported.slice(0, 12).map((x: any) => `${x.full_name} (${x.date})`).join(', ')}{ops.data.not_reported.length > 12 ? '…' : ''}</div>}
        </Card>}
        {isAdmin && <Card title="Add a bank" help="If a genuine bank is missing from the list, add it with its four-letter IFSC code (the first four letters of any IFSC of that bank).">
          <div className="row" style={{ alignItems: 'end' }}>
            <label className="field">IFSC code (4 letters)<input value={addIfsc} maxLength={4} onChange={(e) => setAddIfsc(e.target.value.toUpperCase())} style={{ width: 120 }} /></label>
            <label className="field" style={{ flex: 1 }}>Bank name<input value={addName} onChange={(e) => setAddName(e.target.value)} /></label>
            <button className="btn primary" disabled={!/^[A-Z]{4}$/.test(addIfsc) || !addName.trim()} onClick={async () => { setBankMsg(''); try { await rpc('add_bank', { p_ifsc_code: addIfsc, p_name: addName.trim() }); setBankMsg(`Added ${addName.trim()}.`); setAddIfsc(''); setAddName(''); } catch (e) { setBankMsg(String((e as Error).message ?? e)); } }}>Add bank</button>
          </div>{bankMsg && <div className="banner info small" role="status">{bankMsg}</div>}
        </Card>}
      </>}
    </div>
  );
}

/** App usage report (D-109): in-app time across the team, by person and by hour, with a CSV to share. In-app only. */
function UsageReport() {
  const [days, setDays] = useState(21);
  const d = useLoad(() => rpc<any>('usage_report', { p_days: days }), [days]);
  const ad = useLoad(() => rpc<any>('adoption_report', { p_days: 7 }), []);
  const hh = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`;
  const mins = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);
  function download() {
    const rows = (d.data?.people ?? []) as any[];
    const head = ['Name', 'Designation', 'Total minutes', 'Days active', 'Busiest hour', 'App installed', 'Last active'];
    const csv = [head.join(',')].concat(rows.map((r) => [
      r.full_name, r.designation ?? '', Math.round((r.total_seconds ?? 0) / 60), r.days_active ?? 0,
      r.busiest_hour != null ? hh(r.busiest_hour) : '', r.installed ? 'Yes' : 'No',
      r.last_active ? new Date(r.last_active).toLocaleString('en-IN') : ''].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(','))).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob);
    const el = document.createElement('a'); el.href = url; el.download = `crux-app-usage-${d.data?.from ?? ''}.csv`; el.click(); URL.revokeObjectURL(url);
  }
  const hours: number[] = d.data?.by_hour ?? []; const max = Math.max(1, ...hours);
  return (
    <div className="stack">
      <div className="row"><span className="small muted">Last</span>
        {[7, 21, 60].map((n) => <button key={n} className={`chip${days === n ? ' on' : ''}`} onClick={() => setDays(n)}>{n} days</button>)}
        <span className="spacer" /><button className="btn sm" disabled={!d.data} onClick={download}><Icon name="download" size={16} /> Download CSV</button></div>
      {d.loading ? <Loading rows={4} /> : <ErrorBox error={d.error} retry={d.reload} />}
      {ad.data && (() => { const o = ad.data.overall; return <>
        <Card title="Who is signed up and using CRUX" help="Signed up = has an activation / login. Using = opened the app in the last 7 days. Profile complete = all required details and documents are in.">
          <div className="grid kpis">
            <Kpi label="People" value={o.total} sub={`${o.activated} signed up · ${o.invited} not yet`} />
            <Kpi label="Have the app installed" value={o.installed} sub={`${o.browser_only} on browser · ${o.never_opened} never opened`} />
            <Kpi label="Using (last 7 days)" value={o.active} sub={`${o.inactive} signed up but not using`} />
            <Kpi label="Profile complete" value={o.profile_complete} sub={`${o.profile_pending} still pending`} />
          </div>
        </Card>
        <Card title="By team — profile pending vs complete" help="Each person grouped under the operations manager they report to.">
          <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Manager</th><th className="num">Members</th><th className="num">Signed up</th><th className="num">Using</th><th className="num">Complete</th><th className="num">Pending</th></tr></thead>
            <tbody>{(ad.data.teams ?? []).map((t: any) => <tr key={t.manager_id}>
              <td><b>{t.manager}</b></td><td className="num">{t.members}</td><td className="num">{t.activated}</td><td className="num">{t.active}</td>
              <td className="num">{t.profile_complete}</td><td className="num">{t.profile_pending > 0 ? <span className="pill warn small">{t.profile_pending}</span> : 0}</td></tr>)}</tbody></table></div>
        </Card>
      </>; })()}
      <h3 style={{ margin: '14px 0 0' }}>Time in the app</h3>
      {d.data && <>
        <div className="grid kpis">
          <Kpi label="People using CRUX" value={`${d.data.active_people} of ${d.data.total_people}`} sub={`in the last ${d.data.days} days`} />
          <Kpi label="Total time in app" value={mins(d.data.total_seconds)} sub={d.data.active_people ? `~${mins(d.data.total_seconds / d.data.active_people)} per active person` : ''} />
          <Kpi label="Busiest hour" value={hours.length ? hh(hours.indexOf(Math.max(...hours))) : '—'} sub="across the team" />
        </div>
        <Card title="When the team is active" help="In-app time added up across everyone, by hour of day (IST).">
          <div className="hourbars" aria-label="Team activity by hour">
            {hours.map((s, h) => <div key={h} className="hourbar" title={`${hh(h)}: ${mins(s)}`}><div className="hb-fill" style={{ height: `${Math.round((s / max) * 100)}%` }} />{h % 6 === 0 && <span className="hb-label">{hh(h)}</span>}</div>)}
          </div>
        </Card>
        <Card collapsible defaultOpen={false} title={`By person (${(d.data.people ?? []).length})`}>
          <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Person</th><th className="num">Time</th><th className="num">Days</th><th>Busiest</th><th>Installed</th><th>Last active</th></tr></thead>
            <tbody>{(d.data.people ?? []).map((r: any) => <tr key={r.person_id}>
              <td><b>{r.full_name}</b><div className="small muted">{r.designation ?? ''}</div></td>
              <td className="num">{mins(r.total_seconds ?? 0)}</td><td className="num">{r.days_active ?? 0}</td>
              <td>{r.busiest_hour != null ? hh(r.busiest_hour) : <span className="muted">—</span>}</td>
              <td>{r.installed ? <span className="pill ok small">Yes</span> : <span className="pill neutral small">No</span>}</td>
              <td className="small muted">{r.last_active ? new Date(r.last_active).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'never'}</td></tr>)}</tbody></table></div>
          <p className="small muted">In-app time only — the time people spend in CRUX. CRUX cannot see other apps on a phone.</p>
        </Card>
      </>}
    </div>
  );
}
