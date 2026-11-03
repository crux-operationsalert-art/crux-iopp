import { FormEvent, useState } from 'react';
import { authFn, errText, has, Me, rpc, sb, select } from '../lib/api';
import { label, money, time } from '../lib/format';
import { Card, Empty, ErrorBox, Loading, useLoad } from '../components/ui';

const TABS = ['masters', 'services', 'rates', 'partners', 'people', 'reopen', 'audit', 'settings'] as const;

export default function Admin({ me }: { me: Me }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>(has(me, 'admin') ? 'masters' : 'people');
  const tabs = has(me, 'admin') ? TABS : (['people'] as const);
  return (
    <div className="stack">
      <div className="topbar"><div><h1>Admin</h1><div className="muted">Every change here is recorded in the audit log, with who made it and when.</div></div></div>
      <div className="chips" role="tablist">{tabs.map((t) => <button key={t} role="tab" aria-selected={tab === t} className={`chip ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{label(t)}</button>)}</div>
      {tab === 'masters' && <Masters />}
      {tab === 'services' && <Services />}
      {tab === 'rates' && <Rates />}
      {tab === 'partners' && <Partners />}
      {tab === 'people' && <People me={me} />}
      {tab === 'reopen' && <Reopen me={me} />}
      {tab === 'audit' && <Audit />}
      {tab === 'settings' && <Settings />}
    </div>
  );
}

function SimpleMaster({ table, fields }: { table: string; fields: { k: string; l: string; opts?: string[] }[] }) {
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
        <div className="tablewrap"><table><thead><tr>{fields.map((x) => <th key={x.k}>{x.l}</th>)}<th>Active</th></tr></thead>
          <tbody>{d.data.map((r: any) => <tr key={r.id}>{fields.map((x) => <td key={x.k}>{r[x.k]}</td>)}<td>{r.active ? 'Yes' : 'No'}</td></tr>)}</tbody></table></div>)}
    </Card>
  );
}

function Masters() {
  return (
    <div className="grid two">
      <SimpleMaster table="zones" fields={[{ k: 'code', l: 'Code' }, { k: 'name', l: 'Name' }]} />
      <SimpleMaster table="branches" fields={[{ k: 'code', l: 'Code' }, { k: 'name', l: 'Name' }, { k: 'branch_type', l: 'Type', opts: ['own', 'partner'] }, { k: 'state', l: 'State' }]} />
      <SimpleMaster table="clients" fields={[{ k: 'code', l: 'Code' }, { k: 'name', l: 'Name' }, { k: 'client_family', l: 'Client family' }]} />
      <SimpleMaster table="locations" fields={[{ k: 'code', l: 'Code' }, { k: 'name', l: 'Name' }, { k: 'state', l: 'State' }]} />
      <SimpleMaster table="processes" fields={[{ k: 'code', l: 'Code' }, { k: 'name', l: 'Name' }, { k: 'function', l: 'Function', opts: ['operations', 'collections'] }]} />
      <BranchZones />
      <BranchTypes />
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

function BranchZones() {
  const m = useMasters();
  const d = useLoad(() => select('branch_zones', 'id,valid,branches(name),zones(name)'), []);
  const [f, setF] = useState({ branch_id: '', zone_id: '', from: '' });
  const [err, setErr] = useState<unknown>(null);
  async function add(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const { error } = await sb.from('branch_zones').insert({ branch_id: f.branch_id, zone_id: f.zone_id, valid: `[${f.from},)` });
    if (error) setErr(error); else d.reload();
  }
  return (
    <Card title="Branch → zone (dated)">
      <form className="row" style={{ alignItems: 'end' }} onSubmit={add}>
        <label className="field">Branch<select required value={f.branch_id} onChange={(e) => setF({ ...f, branch_id: e.target.value })}><Opt list={m.data?.branches} /></select></label>
        <label className="field">Zone<select required value={f.zone_id} onChange={(e) => setF({ ...f, zone_id: e.target.value })}><Opt list={m.data?.zones} /></select></label>
        <label className="field">From<input required type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <button className="btn primary">Assign</button>
      </form>
      <ErrorBox error={err} />
      {d.data && <table><tbody>{d.data.map((r: any) => <tr key={r.id}><td>{r.branches?.name}</td><td>{r.zones?.name}</td><td className="small">{r.valid}</td></tr>)}</tbody></table>}
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
      {d.data && (d.data.length === 0 ? <Empty>No services yet.</Empty> : <div className="tablewrap"><table><thead><tr><th>Client</th><th>Location</th><th>Process</th><th>Branch</th><th>Valid</th></tr></thead>
        <tbody>{d.data.map((r: any) => <tr key={r.id}><td>{r.clients?.name}</td><td>{r.locations?.name}</td><td>{r.processes?.name}</td><td>{r.branches?.name}</td><td className="small">{r.valid}</td></tr>)}</tbody></table></div>)}
    </Card>
  );
}

const EVENTS = [['entry', 'Entered cases less cancelled (default)'], ['closure', 'Closures only'], ['net_actioned', 'Net actioned']] as const;

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
      {d.data && (d.data.length === 0 ? <Empty>No rate cards yet.</Empty> : <div className="tablewrap"><table><thead><tr><th>Client</th><th>Location</th><th>Process</th><th>Earns on</th><th className="num">Rate</th><th>Valid</th><th>Reason</th></tr></thead>
        <tbody>{d.data.map((r: any) => <tr key={r.id}><td>{r.clients?.name}</td><td>{r.locations?.name}</td><td>{r.processes?.name}</td><td>{EVENTS.find(([v]) => v === r.billable_event)?.[1] ?? r.billable_event}</td><td className="num">{money(r.rate)}</td><td className="small">{r.valid}</td><td className="small">{r.reason}</td></tr>)}</tbody></table></div>)}
    </Card>
  );
}

function People({ me }: { me: Me }) {
  const persons = useLoad(() => select('persons', 'id,full_name,personal_email,mobile,designation,status,invite_expires_at', (b) => b.order('full_name')), []);
  const services = useLoad(() => select('client_locations', 'id,clients(name),locations(name),processes(name)'), []);
  const [f, setF] = useState({ name: '', email: '', mobile: '', type: 'own_employee', designation: '', role: 'executive', manager: '', fn: 'operations' });
  const [a, setA] = useState({ person: '', cl: '', from: me.today, fn: 'operations' });
  const [err, setErr] = useState<unknown>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [act, setAct] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null);
  async function issue(id: string) {
    setErr(null); setOk(null);
    try { setAct(await rpc('issue_activation', { p_person: id })); } catch (x) { setErr(x); }
  }
  async function saveEdit(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const { error } = await sb.from('persons').update({ full_name: edit.full_name, personal_email: edit.personal_email || null,
      mobile: edit.mobile || null, designation: edit.designation || null }).eq('id', edit.id);
    if (error) setErr(error); else { setEdit(null); setOk('Saved. If the mobile number or email changed, issue a new activation code.'); persons.reload(); }
  }
  async function create(e: FormEvent) {
    e.preventDefault(); setErr(null); setOk(null);
    try {
      await rpc('create_team_member', { p_full_name: f.name, p_email: f.email, p_mobile: f.mobile || null, p_resource_type: f.type, p_designation: f.designation,
        p_role: f.role, p_manager_id: f.manager || null, p_function: f.fn });
      setOk(`${f.name} added. Use "Activation code" next to their name and give them the code; they sign in with their mobile number.`); persons.reload();
    } catch (x) { setErr(x); }
  }
  async function allocate(e: FormEvent) {
    e.preventDefault(); setErr(null); setOk(null);
    try { await rpc('allocate', { p_person: a.person, p_client_location: a.cl, p_valid_from: a.from, p_function: a.fn }); setOk('Allocation saved.'); }
    catch (x) { setErr(x); }
  }
  const pOpts = <><option value="">Choose…</option>{(persons.data ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</>;
  return (
    <div className="stack">
      <ErrorBox error={err} />{ok && <div className="banner ok" role="status">{ok}</div>}
      {act && <ActivationBanner a={act} onClose={() => setAct(null)} />}
      {edit && <Card title={`Edit ${edit.full_name}`}><form className="grid two" onSubmit={saveEdit}>
        {(['full_name', 'mobile', 'personal_email', 'designation'] as const).map((k) => <label key={k} className="field">{label(k)}
          <input value={edit[k] ?? ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /></label>)}
        <div className="row"><button className="btn primary">Save</button><button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button></div></form></Card>}
      <div className="grid two">
        <Card title="Add a person">
          <form className="stack" onSubmit={create}>
            <label className="field">Full name<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <div className="grid two">
              <label className="field">Mobile (login ID)<input inputMode="tel" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></label>
              <label className="field">Personal email<input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
              <label className="field">Resource type<select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="own_employee">Own-branch employee</option><option value="partner">Partner / BA</option></select></label>
              <label className="field">Designation<input value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} /></label>
              <label className="field">Role<select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{['executive', 'manager', 'bm', 'ba', 'zm', 'ops_head', 'collections_head', 'admin', 'hr_admin', 'auditor'].map((r) => <option key={r} value={r}>{label(r)}</option>)}</select></label>
              <label className="field">Reports to<select value={f.manager} onChange={(e) => setF({ ...f, manager: e.target.value })}>{pOpts}</select></label>
              <label className="field">Function of that line<select value={f.fn} onChange={(e) => setF({ ...f, fn: e.target.value })}><option value="operations">Operations</option><option value="collections">Collections</option></select></label>
            </div>
            <p className="small muted">No password is created or seen by anyone else. After adding, issue an activation code; the person sets their own password. PAN, Aadhaar, salary and bank details are not collected here (HR module, pending legal review).</p>
            <button className="btn primary">Add person</button>
          </form>
        </Card>
        <Card title="Allocate a client / location">
          <form className="stack" onSubmit={allocate}>
            <label className="field">Person<select required value={a.person} onChange={(e) => setA({ ...a, person: e.target.value })}>{pOpts}</select></label>
            <label className="field">Service<select required value={a.cl} onChange={(e) => setA({ ...a, cl: e.target.value })}><option value="">Choose…</option>
              {(services.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.clients?.name} · {s.locations?.name} · {s.processes?.name}</option>)}</select></label>
            <div className="grid two">
              <label className="field">From<input type="date" value={a.from} onChange={(e) => setA({ ...a, from: e.target.value })} /></label>
              <label className="field">Function<select value={a.fn} onChange={(e) => setA({ ...a, fn: e.target.value })}><option value="operations">Operations</option><option value="collections">Collections</option></select></label>
            </div>
            <button className="btn primary">Allocate</button>
          </form>
        </Card>
      </div>
      <Card title="People">
        {persons.loading ? <Loading /> : persons.data && <div className="tablewrap"><table><thead><tr><th>Name</th><th>Mobile (login)</th><th>Email</th><th>Designation</th><th>Status</th><th></th></tr></thead>
          <tbody>{persons.data.map((p: any) => <tr key={p.id}><td>{p.full_name}</td><td>{p.mobile ?? '—'}</td><td className="small">{p.personal_email}</td><td>{p.designation}</td>
            <td>{p.status === 'invited' ? 'Not activated' : label(p.status)}</td>
            <td><div className="row">{p.status !== 'exited' && <>
              <button className="btn sm" onClick={() => issue(p.id)}>Activation code</button>
              <button className="btn sm" onClick={() => setEdit(p)}>Edit</button>
              <button className="btn sm danger" onClick={async () => { const r = window.prompt(`Reason for deactivating ${p.full_name}`); if (!r) return;
              try { await rpc('deactivate_person', { p_person: p.id, p_last_day: me.today, p_reason: r }); await authFn({ action: 'suspend', person_id: p.id }); setOk(`${p.full_name} deactivated and signed out.`); persons.reload(); } catch (x) { setErr(x); } }}>Deactivate</button></>}</div></td></tr>)}</tbody></table></div>}
      </Card>
    </div>
  );
}

function Reopen({ me }: { me: Me }) {
  const persons = useLoad(() => select('persons', 'id,full_name', (b) => b.neq('status', 'exited').order('full_name')), []);
  const grants = useLoad(() => select('reopen_grants', '*,persons!reopen_grants_person_id_fkey(full_name)', (b) => b.order('created_at', { ascending: false }).limit(30)), []);
  const [f, setF] = useState({ kind: 'submission', person: '', date: me.today, month: me.today.slice(0, 7), team: false, fn: 'operations', hours: '8', reason: '' });
  const [err, setErr] = useState<unknown>(null);
  async function go(e: FormEvent) {
    e.preventDefault(); setErr(null);
    try {
      await rpc('grant_reopen', { p_kind: f.kind, p_person: f.person, p_reason: f.reason, p_expires_at: new Date(Date.now() + Number(f.hours) * 3.6e6).toISOString(),
        p_work_date: f.kind === 'submission' ? f.date : null, p_target_month: f.kind === 'target' ? f.month + '-01' : null, p_include_team: f.team, p_function: f.fn });
      grants.reload();
    } catch (x) { setErr(x); }
  }
  return (
    <Card title="Reopen a closed day or target month">
      <form className="row" style={{ alignItems: 'end' }} onSubmit={go}>
        <label className="field">What<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="submission">Daily submission</option><option value="target">Target month</option></select></label>
        <label className="field">Person<select required value={f.person} onChange={(e) => setF({ ...f, person: e.target.value })}><option value="">Choose…</option>{(persons.data ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
        {f.kind === 'submission' ? <label className="field">Work date<input type="date" value={f.date} max={me.today} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
          : <label className="field">Month<input type="month" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} /></label>}
        <label className="field">Function<select value={f.fn} onChange={(e) => setF({ ...f, fn: e.target.value })}><option value="operations">Operations</option><option value="collections">Collections</option></select></label>
        <label className="field">Open for (hours)<input type="number" min={1} max={168} value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /></label>
        <label className="field" style={{ alignSelf: 'center' }}><span><input type="checkbox" style={{ width: 'auto', minHeight: 0 }} checked={f.team} onChange={(e) => setF({ ...f, team: e.target.checked })} /> Include their team</span></label>
        <label className="field">Reason<input required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
        <button className="btn primary">Reopen</button>
      </form>
      <ErrorBox error={err} />
      {grants.data && <table><tbody>{grants.data.map((g: any) => <tr key={g.id}><td>{label(g.kind)}</td><td>{g.persons?.full_name}{g.include_team ? ' + team' : ''}</td><td>{g.work_date ?? g.target_month}</td><td className="small">until {time(g.expires_at)}</td><td className="small">{g.reason}</td></tr>)}</tbody></table>}
    </Card>
  );
}

function Audit() {
  const [t, setT] = useState('');
  const d = useLoad(() => select('audit_events', 'id,at,table_name,action,reason,actor_person,row_id,before,after', (b) => (t ? b.eq('table_name', t) : b).order('at', { ascending: false }).limit(100)), [t]);
  return (
    <Card title="Audit log (latest 100)" action={<input placeholder="Filter by table, e.g. rate_cards" value={t} onChange={(e) => setT(e.target.value.trim())} style={{ width: 240 }} />}>
      {d.loading ? <Loading /> : <ErrorBox error={d.error} />}
      {d.data && <div className="tablewrap"><table><thead><tr><th>When</th><th>Table</th><th>Action</th><th>Reason</th><th>Change</th></tr></thead>
        <tbody>{d.data.map((a: any) => <tr key={a.id}><td className="small">{time(a.at)}</td><td>{a.table_name}</td><td>{a.action}</td><td className="small">{a.reason}</td>
          <td className="small"><details><summary>View</summary><pre style={{ whiteSpace: 'pre-wrap', maxWidth: 520 }}>{JSON.stringify({ before: a.before, after: a.after }, null, 1)}</pre></details></td></tr>)}</tbody></table></div>}
    </Card>
  );
}

function Settings() {
  const d = useLoad(() => select('settings', '*', (b) => b.order('key')), []);
  return (
    <Card title="Policy settings">
      <p className="small muted">These values drive deadlines, locks and invitations. Open decisions are listed in DECISIONS.md. Change them only after the business confirms.</p>
      {d.loading ? <Loading /> : d.error ? <div className="banner bad">{errText(d.error)}</div> : <table><tbody>{d.data!.map((s: any) => <tr key={s.key}><td><code>{s.key}</code></td><td><code>{JSON.stringify(s.value)}</code></td><td className="small muted">{s.description}</td></tr>)}</tbody></table>}
    </Card>
  );
}

export function ActivationBanner({ a, onClose }: { a: any; onClose: () => void }) {
  return (
    <div className="banner info" role="status">
      <b>Activation code for {a.full_name}: <span style={{ fontSize: '1.2rem', letterSpacing: '.08em' }}>{a.code}</span></b>
      <div className="small">Login ID: {a.login_id} · valid until {time(a.expires_at)} · works once. This code is shown only now — share it with the person directly.
        They open the app, choose "First time / reset password", and set their own password.</div>
      <button className="btn sm" style={{ marginTop: 6 }} onClick={onClose}>Done</button>
    </div>
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
