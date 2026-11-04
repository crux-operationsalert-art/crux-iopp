import { FormEvent, useMemo, useState } from 'react';
import { has, Me, rpc, select } from '../lib/api';
import { label, money, monthStart, num, time } from '../lib/format';
import { Card, Countdown, Empty, ErrorBox, Kpi, Loading, Pill, Progress, Tabs, useLoad } from '../components/ui';
import { downloadTemplate, readTemplate, Tpl } from '../lib/targetTemplate';

const n = (v: unknown) => Number(v ?? 0) || 0;
const pc = (a: number, t: number | null | undefined) => (t ? `${((a / Number(t)) * 100).toFixed(0)}%` : '—');
type Team = { wd_done: number; wd_total: number; people: { person_id: string; person: string; self: boolean; has_team: boolean; revenue_target: number | null; revenue: number;
  collection_target: number | null; collection: number; revenue_passed_down: number | null; collection_passed_down: number | null }[] };

export default function Targets({ me }: { me: Me }) {
  const [month, setMonth] = useState(monthStart(me.today));
  const lock = useLoad(() => rpc<any>('target_lock_info', { p_month: month }), [month]);
  const team = useLoad(() => rpc<Team>('team_targets', { p_month: month }), [month]);
  const tpl = useLoad(() => rpc<Tpl>('target_template', { p_month: month }), [month]);
  const canStructure = has(me, 'admin', 'ops_head', 'collections_head', 'zm');
  const reload = () => { team.reload(); tpl.reload(); };
  return (
    <div className="stack">
      <div className="topbar"><div><h1>Targets</h1><div className="muted">In money: revenue and collection. Managers set them for their team; everyone sees theirs in My day.</div></div>
        <label className="field">Month<input type="month" value={month.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value + '-01')} /></label></div>
      {lock.data && (lock.data.locked
        ? <div className="banner info">Targets for this month locked on {time(lock.data.lock_at)}. Changes now need an Admin reopen and a reason.
            {!has(me, 'admin') && (tpl.data?.people.length ?? 0) > 0 && <AskReopen month={month} />}</div>
        : <div className="banner warn">Target setting closes {time(lock.data.lock_at)} (<Countdown to={lock.data.lock_at} />) — end of the 5th working day.</div>)}
      <Card title="Me and my team — target vs month to date">
        {team.loading ? <Loading /> : <ErrorBox error={team.error} retry={team.reload} />}
        {team.data && <TeamTable t={team.data} />}
      </Card>
      {tpl.data && tpl.data.people.length > 0 && <SetTargets month={month} tpl={tpl.data} locked={!!lock.data?.locked} onSaved={reload} />}
      {canStructure && <Structure me={me} month={month} />}
    </div>
  );
}

export function TeamTable({ t }: { t: Team }) {
  const pace = t.wd_total ? t.wd_done / t.wd_total : 0;
  const me = t.people.find((p) => p.self);
  return (<>
    {me && <div className="grid kpis">
      <Kpi label="My revenue target" value={money(me.revenue_target)} sub={`${money(me.revenue)} done · ${pc(me.revenue, me.revenue_target)}`} />
      <Kpi label="My collection target" value={money(me.collection_target)} sub={`${money(me.collection)} collected · ${pc(me.collection, me.collection_target)}`} />
      <Kpi label="Working days" value={`${t.wd_done} / ${t.wd_total}`} sub={`pro-rata ${(pace * 100).toFixed(0)}% of the month`} />
    </div>}
    {t.people.length > 1 ? <div className="tablewrap" tabIndex={0}><table>
      <thead><tr><th>Person</th><th className="num">Revenue target</th><th className="num">Revenue MTD</th><th style={{ width: 120 }}>Achieved</th>
        <th className="num">Collection target</th><th className="num">Collected MTD</th><th style={{ width: 120 }}>Achieved</th><th className="num">Passed to their team</th></tr></thead>
      <tbody>{t.people.map((p) => <tr key={p.person_id} style={p.self ? { fontWeight: 700 } : undefined}>
        <td>{p.self ? `${p.person} (me)` : p.person}</td>
        <td className="num">{money(p.revenue_target)}</td><td className="num">{money(p.revenue)}</td>
        <td>{p.revenue_target ? <><span className="small">{pc(p.revenue, p.revenue_target)}</span><Progress value={(n(p.revenue) / n(p.revenue_target)) * 100} /></> : <span className="small muted">no target</span>}</td>
        <td className="num">{money(p.collection_target)}</td><td className="num">{money(p.collection)}</td>
        <td>{p.collection_target ? <><span className="small">{pc(p.collection, p.collection_target)}</span><Progress value={(n(p.collection) / n(p.collection_target)) * 100} /></> : <span className="small muted">no target</span>}</td>
        <td className="num small">{p.has_team ? `${money(p.revenue_passed_down)} · ${money(p.collection_passed_down)}` : '—'}
          {p.has_team && p.revenue_target != null && p.revenue_passed_down != null && n(p.revenue_passed_down) < n(p.revenue_target) && <div><Pill status="pending" text={`${money(n(p.revenue_target) - n(p.revenue_passed_down))} not passed down`} /></div>}</td>
      </tr>)}</tbody></table></div> : <p className="small muted">No direct reports.</p>}
    <p className="small muted">A person's target covers their own work and their team's. MTD revenue = (received − cancelled) × rate; collected = the daily “received” entries. “Passed to their team” = the sum of their direct reports' targets (revenue · collection).</p>
  </>);
}

type Preview = { rows: any[]; errors: number; applied: boolean; totals: { revenue: number; collection: number; cases: number } };

/** Three ways to set targets; all go through save_targets (preview first, then apply). */
function SetTargets({ month, tpl, locked, onSaved }: { month: string; tpl: Tpl; locked: boolean; onSaved: () => void }) {
  const [mode, setMode] = useState<'total' | 'client' | 'bulk'>('total');
  return (
    <Card title="Set targets for my team" action={<Tabs tabs={[['total', '1 · Monthly totals'], ['client', '2 · Client-wise'], ['bulk', '3 · Bulk upload']]} value={mode} onChange={setMode} />}>
      {mode === 'total' && <TotalsForm month={month} tpl={tpl} locked={locked} onSaved={onSaved} />}
      {mode === 'client' && <ClientForm month={month} tpl={tpl} locked={locked} onSaved={onSaved} />}
      {mode === 'bulk' && <Bulk month={month} tpl={tpl} locked={locked} onSaved={onSaved} />}
    </Card>
  );
}

function Apply({ month, rows, locked, onSaved, names }: { month: string; rows: Record<string, unknown>[]; locked: boolean; onSaved: () => void; names?: (r: any) => string }) {
  const [pv, setPv] = useState<Preview | null>(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  async function run(apply: boolean) {
    setBusy(true); setErr(null); setDone('');
    try { const r = await rpc<Preview>('save_targets', { p_month: month, p_rows: rows, p_apply: apply, p_reason: reason || null });
      setPv(r); if (apply) { setDone(`Saved: revenue ${money(r.totals.revenue)} · collection ${money(r.totals.collection)}.`); setPv(null); onSaved(); } }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const bad = pv?.rows.filter((r) => r.error || r.warning) ?? [];
  return (
    <div className="stack" style={{ marginTop: 12 }}>
      {locked && <label className="field">Reason for changing after the lock<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>}
      <div className="row"><button className="btn" disabled={busy || rows.length === 0} onClick={() => run(false)}>Check ({rows.length} row{rows.length === 1 ? '' : 's'})</button>
        {pv && pv.errors === 0 && <button className="btn primary" disabled={busy} onClick={() => run(true)}>Apply targets</button>}
        {done && <span className="banner ok small">{done}</span>}</div>
      <ErrorBox error={err} />
      {pv && <div className="banner info small">Revenue {money(pv.totals.revenue)} · collection {money(pv.totals.collection)}{pv.totals.cases ? ` · ${num(pv.totals.cases)} cases` : ''} — {pv.errors ? `${pv.errors} row(s) need fixing` : 'ready to apply'}.</div>}
      {bad.length > 0 && <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Row</th><th>Person</th><th>Problem</th></tr></thead>
        <tbody>{bad.map((r) => <tr key={r.i}><td>{names ? names(r) : r.i}</td><td>{r.person ?? '—'}</td><td>{r.error ? <Pill status="mismatch" text={r.error} /> : <span className="small">{r.warning}</span>}</td></tr>)}</tbody></table></div>}
    </div>
  );
}

function TotalsForm({ month, tpl, locked, onSaved }: { month: string; tpl: Tpl; locked: boolean; onSaved: () => void }) {
  const [f, setF] = useState<Record<string, { revenue: string; collection: string }>>(() => Object.fromEntries(tpl.people.map((p) =>
    [p.person_id, { revenue: p.style === 'total' && p.revenue != null ? String(p.revenue) : '', collection: p.style === 'total' && p.collection != null ? String(p.collection) : '' }])));
  const rows = tpl.people.filter((p) => f[p.person_id]?.revenue !== '' || f[p.person_id]?.collection !== '')
    .map((p) => ({ person_id: p.person_id, revenue: f[p.person_id].revenue, collection: f[p.person_id].collection }));
  const set = (id: string, k: 'revenue' | 'collection', v: string) => setF({ ...f, [id]: { ...f[id], [k]: v } });
  return (<>
    <p className="small muted">Give each person the revenue and collection you expect this month; they decide how much comes from which client. Saving replaces any client-wise targets for that measure.</p>
    <div className="tablewrap" tabIndex={0}><table>
      <thead><tr><th>Person</th><th>Now</th><th className="num">Revenue target ₹</th><th className="num">Collection target ₹</th></tr></thead>
      <tbody>{tpl.people.map((p) => <tr key={p.person_id}><td>{p.person}<div className="small muted">{p.designation ?? ''}</div></td>
        <td className="small">{p.style ? <>{p.style === 'client' ? 'client-wise' : 'totals'}: {money(p.revenue)} · {money(p.collection)}</> : <span className="muted">none</span>}</td>
        <td className="num"><input type="number" min={0} inputMode="decimal" aria-label={`Revenue target for ${p.person}`} style={{ maxWidth: 150 }} value={f[p.person_id].revenue} onChange={(e) => set(p.person_id, 'revenue', e.target.value)} /></td>
        <td className="num"><input type="number" min={0} inputMode="decimal" aria-label={`Collection target for ${p.person}`} style={{ maxWidth: 150 }} value={f[p.person_id].collection} onChange={(e) => set(p.person_id, 'collection', e.target.value)} /></td></tr>)}</tbody>
    </table></div>
    <Apply month={month} rows={rows} locked={locked} onSaved={onSaved} names={(r) => r.person} />
  </>);
}

function ClientForm({ month, tpl, locked, onSaved }: { month: string; tpl: Tpl; locked: boolean; onSaved: () => void }) {
  const people = tpl.people.filter((p) => tpl.rows.some((r) => r.person_id === p.person_id));
  const [pid, setPid] = useState(people[0]?.person_id ?? '');
  const mine = tpl.rows.filter((r) => r.person_id === pid);
  const [f, setF] = useState<Record<string, { cases: string; collection: string }>>({});
  const key = (r: { branch_id: string; client_id: string }) => `${pid}|${r.branch_id}|${r.client_id}`;
  const val = (r: any, k: 'cases' | 'collection') => f[key(r)]?.[k] ?? (r[k] != null ? String(r[k]) : '');
  const set = (r: any, k: 'cases' | 'collection', v: string) => setF({ ...f, [key(r)]: { cases: val(r, 'cases'), collection: val(r, 'collection'), [k]: v } });
  const rows = mine.filter((r) => f[key(r)]).map((r) => ({ person_id: pid, branch_id: r.branch_id, client_id: r.client_id, cases: val(r, 'cases'), collection: val(r, 'collection') }));
  const tot = mine.reduce((t, r) => ({ c: t.c + n(val(r, 'cases')), rv: t.rv + n(val(r, 'cases')) * n(r.rate), col: t.col + n(val(r, 'collection')) }), { c: 0, rv: 0, col: 0 });
  if (people.length === 0) return <Empty>No one in your team has clients ticked for this month yet.</Empty>;
  return (<>
    <p className="small muted">Cases per client · location; revenue is worked out from the client's rate (you cannot type it). Saving replaces a monthly-total target for that measure.</p>
    <label className="field" style={{ maxWidth: 320 }}>Person<select value={pid} onChange={(e) => setPid(e.target.value)}>{people.map((p) => <option key={p.person_id} value={p.person_id}>{p.person}</option>)}</select></label>
    <div className="tablewrap" tabIndex={0}><table>
      <thead><tr><th>Client · location</th><th className="num">Rate</th><th className="num">Last month</th><th className="num">Target cases</th><th className="num">Revenue (auto)</th><th className="num">Collection target ₹</th></tr></thead>
      <tbody>{mine.map((r) => <tr key={key(r)}><td><b>{r.client}</b> <span className="muted">· {r.location}</span></td>
        <td className="num">{r.rate != null ? money(r.rate) : <Pill status="pending" text="no rate" />}</td>
        <td className="num small">{num(r.last_cases)} · {money(r.last_revenue)}</td>
        <td className="num"><input type="number" min={0} aria-label={`Target cases ${r.client} ${r.location}`} style={{ maxWidth: 110 }} value={val(r, 'cases')} onChange={(e) => set(r, 'cases', e.target.value)} /></td>
        <td className="num">{val(r, 'cases') !== '' && r.rate != null ? money(n(val(r, 'cases')) * n(r.rate)) : '—'}</td>
        <td className="num"><input type="number" min={0} aria-label={`Collection target ${r.client} ${r.location}`} style={{ maxWidth: 140 }} value={val(r, 'collection')} onChange={(e) => set(r, 'collection', e.target.value)} /></td></tr>)}
        <tr style={{ fontWeight: 700 }}><td>Total</td><td /><td /><td className="num">{num(tot.c)}</td><td className="num">{money(tot.rv)}</td><td className="num">{money(tot.col)}</td></tr></tbody>
    </table></div>
    <Apply month={month} rows={rows} locked={locked} onSaved={() => { setF({}); onSaved(); }} names={(r) => mine.find((x) => x.branch_id === r.branch_id && x.client_id === r.client_id)?.client ?? r.i} />
  </>);
}

function Bulk({ month, tpl, locked, onSaved }: { month: string; tpl: Tpl; locked: boolean; onSaved: () => void }) {
  const [file, setFile] = useState<{ name: string; rows: Record<string, unknown>[]; problems: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const label2 = useMemo(() => (r: any) => { const s = file?.rows[r.i - 1]; return s ? `${s._sheet} row ${s._row}` : String(r.i); }, [file]);
  return (<>
    <p className="small muted">Download the template — your team, their clients · locations and rates are already filled in, and revenue is a formula (cases × rate). Fill cases and collection (or the monthly totals sheet), upload it, check, then apply.</p>
    <div className="row">
      <button className="btn" disabled={busy} onClick={async () => { setBusy(true); try { await downloadTemplate(tpl); } finally { setBusy(false); } }}>Download template ({tpl.people.length} people · {tpl.rows.length} rows)</button>
      <label className="btn">Upload filled template<input type="file" accept=".xlsx" hidden onChange={async (e) => { const fl = e.target.files?.[0]; if (fl) setFile({ name: fl.name, ...(await readTemplate(fl)) }); e.target.value = ''; }} /></label>
    </div>
    {file && <div className="small" style={{ marginTop: 8 }}><b>{file.name}</b>: {file.rows.length} rows with figures.{file.problems.map((p) => <div key={p} className="banner warn small">{p}</div>)}</div>}
    {file && file.rows.length > 0 && <Apply month={month} rows={file.rows} locked={locked} onSaved={() => { setFile(null); onSaved(); }} names={label2} />}
  </>);
}

const METRICS = ['revenue', 'collections_received', 'entry'];
const fmt = (m: string, v: unknown) => (m === 'entry' ? num(v) : money(v));

/** Optional location targets (Organisation / zone / branch). A branch · client target overrides the sum of the people's targets there. */
function Structure({ me, month }: { me: Me; month: string }) {
  const zones = useLoad(() => select('zones', 'id,name', (b) => b.order('name')), []);
  const branches = useLoad(() => select('branches', 'id,name', (b) => b.order('name')), []);
  const chk = useLoad(() => select('v_target_allocation_check', '*', (b) => b.eq('month', month)), [month]);
  const [f, setF] = useState({ level: has(me, 'zm') && !has(me, 'admin', 'ops_head', 'collections_head') ? 'branch' : 'zone', id: '', metric: 'revenue', amount: '', reason: '' });
  const [err, setErr] = useState<unknown>(null);
  async function go(e: FormEvent) {
    e.preventDefault(); setErr(null);
    try { await rpc('set_target', { p_month: month, p_metric: f.metric, p_level: f.level, p_amount: Number(f.amount),
      p_zone_id: f.level === 'zone' ? f.id : null, p_branch_id: f.level === 'branch' ? f.id : null, p_reason: f.reason || null }); chk.reload(); setF({ ...f, amount: '' }); }
    catch (x) { setErr(x); }
  }
  const zn = (id: string) => zones.data?.find((z: any) => z.id === id)?.name ?? 'Organisation';
  return (
    <Card title="Organisation, zone and branch targets (optional)">
      <p className="small muted">Use these for the top-down number. Client-wise collection targets per location can also be set in Performance → Collections. Where a location has no target of its own, it shows the sum of the people's client-wise targets.</p>
      <form className="row" style={{ alignItems: 'end' }} onSubmit={go}>
        <label className="field">Level<select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value, id: '' })}>
          {has(me, 'admin', 'ops_head', 'collections_head') && <><option value="org">Organisation</option><option value="zone">Zone</option></>}<option value="branch">Branch</option></select></label>
        {f.level !== 'org' && <label className="field">{label(f.level)}<select required value={f.id} onChange={(e) => setF({ ...f, id: e.target.value })}><option value="">Choose…</option>
          {(f.level === 'zone' ? zones.data : branches.data)?.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
        <label className="field">Measure<select value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value })}>{METRICS.map((m) => <option key={m} value={m}>{m === 'entry' ? 'Cases' : label(m)}</option>)}</select></label>
        <label className="field">Amount<input required type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
        <label className="field">Reason<input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
        <button className="btn primary">Save</button>
      </form>
      <ErrorBox error={err} />
      <h3 style={{ marginTop: 16 }}>Allocation check</h3>
      {chk.data && (chk.data.length === 0 ? <Empty>No organisation or zone targets yet.</Empty> : <div className="tablewrap" tabIndex={0}><table>
        <thead><tr><th>Parent</th><th>Measure</th><th className="num">Parent target</th><th className="num">Allocated below</th><th className="num">Unallocated</th></tr></thead>
        <tbody>{chk.data.map((c: any) => <tr key={c.parent_id}><td>{c.level === 'org' ? 'Organisation' : zn(c.zone_id)}</td><td>{label(c.metric)}</td><td className="num">{fmt(c.metric, c.parent_amount)}</td>
          <td className="num">{fmt(c.metric, c.allocated)}</td><td className="num">{Number(c.unallocated) < 0 ? <Pill status="mismatch" text={`Over by ${fmt(c.metric, -c.unallocated)}`} /> : fmt(c.metric, c.unallocated)}</td></tr>)}</tbody></table></div>)}
    </Card>
  );
}

/** After the lock: the manager asks Admin to reopen this month's targets, with the reason. Approval opens editing for 48 hours. */
function AskReopen({ month }: { month: string }) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  if (done) return <div className="small" role="status" style={{ marginTop: 6 }}>Request sent to Admin. You will be notified; editing opens for 48 hours when approved.</div>;
  if (!open) return <div style={{ marginTop: 6 }}><button className="btn sm" onClick={() => setOpen(true)}>Ask Admin to reopen</button></div>;
  return (
    <div className="stack" style={{ marginTop: 8 }}>
      <label className="field">Why must the targets change?<input value={why} onChange={(e) => setWhy(e.target.value)} /></label>
      <ErrorBox error={err} />
      <div className="row"><button className="btn primary sm" disabled={busy || !why.trim()} onClick={async () => {
        setBusy(true); setErr(null);
        try { await rpc('request_target_reopen', { p_month: month, p_reason: why.trim() }); setDone(true); } catch (e) { setErr(e); } finally { setBusy(false); }
      }}>Send request</button><button className="btn sm" onClick={() => setOpen(false)}>Cancel</button></div>
    </div>
  );
}
