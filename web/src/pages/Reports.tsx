import { HelpTip } from '../components/HelpTip';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import RevenueStatus from './RevenueStatus';
import ZonalTracker from './ZonalTracker';
import { has, Me, rpc } from '../lib/api';
import { label, money, monthStart, nice, num, time } from '../lib/format';
import { Card, Empty, ErrorBox, Kpi, Loading, Pill, useLoad } from '../components/ui';

// Drill path: Organisation → Zone → Branch → Person → Client → Day (SOW 11 / Master §15).
const NEXT: Record<string, string> = { zone: 'branch', branch: 'person', person: 'client', client: 'date', date: 'date' };
const FILTER: Record<string, string> = { zone: 'p_zone_id', branch: 'p_branch_id', person: 'p_person_id', client: 'p_client_id' };
type Step = { group: string; filter?: { key: string; id: string; name: string } };

type V = 'tracker' | 'status' | 'collections' | 'live' | 'history' | 'attrition';
export default function Reports({ me }: { me: Me }) {
  const [sp, setSp] = useSearchParams();
  const people = has(me, 'admin', 'hr_admin', 'ops_head', 'auditor', 'leadership');
  const tabs: [V, string][] = [...(!me.ops_blind ? [['tracker', 'Zonal Tracker'], ['status', 'Revenue Status']] as [V, string][] : []), ...(!me.ops_blind ? [['live', 'Daily submissions'], ['history', 'History (Oct 2024 – Oct 2026)']] as [V, string][] : []), ...(people ? [['attrition', 'Attrition']] as [V, string][] : [])];
  if (!tabs.length) return <Card><Empty>Your collections view is on Home.</Empty></Card>;
  const want = (sp.get('v') ?? tabs[0][0]) as V;
  const view = tabs.some(([k]) => k === want) ? want : tabs[0][0];
  const setView = (v: V) => setSp({ v }, { replace: true });
  return (
    <div className="stack">
      <div className="chips" role="tablist">{tabs.map(([k, l]) =>
        <button key={k} role="tab" aria-selected={view === k} className={`chip ${view === k ? 'on' : ''}`} onClick={() => setView(k)}>{l}</button>)}</div>
      {view === 'attrition' ? <Attrition me={me} /> : view === 'tracker' ? <ZonalTracker me={me} />
        : view === 'status' ? <RevenueStatus me={me} /> : view === 'live' ? <Live me={me} /> : <History me={me} />}
    </div>
  );
}

function History({ me }: { me: Me }) {
  const [group, setGroup] = useState<'month' | 'region' | 'zone' | 'location' | 'client'>('month');
  const [month, setMonth] = useState<string | null>(null);
  const r = useLoad(() => rpc<any[]>('tracker_history', { p_from: '2024-10-01', p_to: me.today, p_group: group, p_month: month }), [group, month]);
  const max = Math.max(1, ...(r.data ?? []).map((x) => Number(x.actual_revenue ?? 0)));
  return (
    <>
      <div className="topbar"><div><div className="h1row"><h1>Zonal Tracker history</h1><HelpTip k="Zonal Tracker history" /></div><div className="muted">Month-end cases, revenue and billing per location and client, exactly as in the CRUX BI dashboard (the Zonal Tracker's client rows).</div></div></div>
      <div className="row">
        <div className="chips">{(['month', 'region', 'zone', 'location', 'client'] as const).map((g) => <button key={g} className={`chip ${group === g ? 'on' : ''}`} onClick={() => setGroup(g)}>By {g}</button>)}</div>
        {group !== 'month' && <label className="field">Month<input type="month" value={(month ?? '').slice(0, 7)} onChange={(e) => setMonth(e.target.value ? e.target.value + '-01' : null)} /></label>}
        {month && <button className="btn sm" onClick={() => setMonth(null)}>All months</button>}
      </div>
      <Card>
        {r.loading ? <Loading /> : <ErrorBox error={r.error} retry={r.reload} />}
        {r.data && (r.data.length === 0 ? <Empty>No history visible for your role.</Empty> : <div className="tablewrap" tabIndex={0}><table>
          <thead><tr><th>{label(group)}</th><th className="num">Target cases</th><th className="num">Actual cases</th><th className="num">Revenue target</th><th className="num">Actual revenue</th><th className="num">Billing amount</th><th style={{ width: 160 }}></th></tr></thead>
          <tbody>{r.data.map((x) => <tr key={x.key ?? 'none'} className={group === 'month' ? 'click' : ''} onClick={() => { if (group === 'month') { setMonth(x.key + '-01'); setGroup('zone'); } }}>
            <td>{x.label}</td><td className="num">{num(x.target_cases)}</td><td className="num">{num(x.actual_cases)}</td><td className="num">{money(x.revenue_target)}</td>
            <td className="num">{money(x.actual_revenue)}</td><td className="num">{money(x.billing_amount)}</td>
            <td><div className="progress" aria-hidden><span style={{ width: `${(Number(x.actual_revenue ?? 0) / max) * 100}%` }} /></div></td></tr>)}</tbody></table></div>)}
        <p className="small muted">Select a month to see it by zone. "—" means the tracker has no value for that column in that month.</p>
      </Card>
    </>
  );
}

function Live({ me }: { me: Me }) {
  const [from, setFrom] = useState(monthStart(me.today));
  const [to, setTo] = useState(me.today);
  const [path, setPath] = useState<Step[]>([{ group: 'zone' }]);
  const cur = path.at(-1)!;
  const filters = Object.fromEntries(path.filter((p) => p.filter).map((p) => [p.filter!.key, p.filter!.id]));
  const r = useLoad(() => rpc<any[]>('ops_rollup', { p_from: from, p_to: to, p_group: cur.group, ...filters }), [from, to, JSON.stringify(path)]);
  const miss = useLoad(() => rpc<any[]>('missing_submissions', { p_work_date: to }), [to]);
  const t = (r.data ?? []).reduce((a, x) => ({ e: a.e + +x.entry, c: a.c + +x.closure, x: a.x + +x.cancelled, n: a.n + +x.net_actioned, rev: a.rev + +x.revenue, u: a.u + +x.unrated_lines }),
    { e: 0, c: 0, x: 0, n: 0, rev: 0, u: 0 });

  function drill(row: any) {
    if (cur.group === 'date') return;
    setPath([...path, { group: NEXT[cur.group], filter: { key: FILTER[cur.group], id: row.key, name: row.label } }]);
  }
  function csv() {
    const head = ['label', 'entry', 'closure', 'cancelled', 'net_actioned', 'revenue'];   // entry = received
    const body = (r.data ?? []).map((x) => head.map((h) => JSON.stringify(x[h] ?? '')).join(','));
    const meta = `# CRUX operations ${from} to ${to}; drill: ${path.map((p) => p.filter?.name ?? 'All').join(' > ')}; exported ${new Date().toISOString()}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([[meta, head.join(','), ...body].join('\n')], { type: 'text/csv' }));
    a.download = `crux-ops-${cur.group}-${from}-${to}.csv`; a.click();
  }

  return (
    <div className="stack">
      <div className="topbar"><div><div className="h1row"><h1>Reports</h1><HelpTip k="Reports" /></div><div className="muted">Only records inside your scope are included. Select a row to drill down.</div></div>
        <div className="row"><label className="field">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="field">To<input type="date" value={to} max={me.today} onChange={(e) => setTo(e.target.value)} /></label></div></div>
      <div className="crumbs" aria-label="Drill-down path">{path.map((p, i) => <span key={i}>{i > 0 && '› '}<button onClick={() => setPath(path.slice(0, i + 1))}>{p.filter?.name ?? 'Organisation'}</button></span>)}
        <span className="muted">· showing by {label(cur.group)}</span></div>
      <div className="grid kpis">
        <Kpi label="Billable cases" value={num(t.e - t.x)} sub={`Received ${num(t.e)} − cancelled ${num(t.x)} · closed ${num(t.c)}`} />
        <Kpi label="Revenue (for targets)" value={money(t.rev)} sub={t.u ? `${t.u} line(s) have no rate card` : '(Received − cancelled) × rate'} />
      </div>
      <Card action={<button className="btn sm" onClick={csv} disabled={!r.data?.length}>Export CSV</button>}>
        {r.loading ? <Loading /> : <ErrorBox error={r.error} retry={r.reload} />}
        {r.data && (r.data.length === 0 ? <Empty>No submitted figures in this period within your scope.</Empty> : <div className="tablewrap" tabIndex={0}><table>
          <thead><tr><th>{label(cur.group)}</th><th className="num">Received</th><th className="num">Closed</th><th className="num">Cancelled</th><th className="num">Billable</th><th className="num">Revenue</th></tr></thead>
          <tbody>{r.data.map((x) => <tr key={x.key} className={cur.group !== 'date' ? 'click' : ''} onClick={() => drill(x)} tabIndex={cur.group !== 'date' ? 0 : -1} onKeyDown={(e) => e.key === 'Enter' && drill(x)}>
            <td>{cur.group === 'date' ? nice(x.key) : x.label}{+x.unrated_lines > 0 && <> <Pill status="exception" text="Rate missing" /></>}</td>
            <td className="num">{num(x.entry)}</td><td className="num">{num(x.closure)}</td><td className="num">{num(x.cancelled)}</td><td className="num"><b>{num(Number(x.entry) - Number(x.cancelled))}</b></td>
            <td className="num">{money(x.revenue)}</td></tr>)}</tbody></table></div>)}
      </Card>
      <Card title={`Missing submissions — ${nice(to)}`}>
        {miss.loading ? <Loading /> : <ErrorBox error={miss.error} />}
        {miss.data && (miss.data.length === 0 ? <Empty>Everyone in your scope has submitted or been resolved.</Empty> : <div className="tablewrap" tabIndex={0}><table>
          <thead><tr><th>Employee</th><th>Manager</th><th>Status</th><th>Deadline</th><th>Action needed</th></tr></thead>
          <tbody>{miss.data.map((m) => <tr key={m.person_id}><td>{m.full_name}</td><td>{m.manager_name ?? '—'}</td><td><Pill status={m.status} /></td><td>{time(m.deadline)}</td><td className="small">{m.required_action}</td></tr>)}</tbody></table></div>)}
      </Card>
    </div>
  );
}

function Attrition({ me }: { me: Me }) {
  const from = `${Number(me.today.slice(0, 4)) - 1}-${me.today.slice(5, 7)}-01`;
  const d = useLoad(() => rpc<any[]>('attrition', { p_from: from, p_to: me.today }), []);
  return (
    <Card title="Attrition — last 12 months">
      <p className="small muted">Opening and closing headcount (everyone on the tool except Admin accounts), joiners and leavers by month. Attrition % = leavers ÷ opening headcount. Joining and exit dates come from people records (Admin → People; exits via Deactivate).</p>
      {d.loading ? <Loading /> : <ErrorBox error={d.error} retry={d.reload} />}
      {d.data && <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Month</th><th className="num">Opening</th><th className="num">Joined</th><th className="num">Left</th><th className="num">Closing</th><th className="num">Attrition</th></tr></thead>
        <tbody>{d.data.map((r) => <tr key={r.month}><td>{new Date(r.month + 'T12:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</td><td className="num">{r.opening}</td>
          <td className="num">{r.joined}</td><td className="num">{r.left_}</td><td className="num">{r.closing}</td><td className="num">{r.attrition_pct == null ? '—' : `${r.attrition_pct}%`}</td></tr>)}</tbody></table></div>}
    </Card>
  );
}
