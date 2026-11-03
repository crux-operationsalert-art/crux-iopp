import { useState } from 'react';
import { Me, rpc } from '../lib/api';
import { label, money, monthStart, nice, num, time } from '../lib/format';
import { Card, Empty, ErrorBox, Kpi, Loading, Pill, useLoad } from '../components/ui';

// Drill path: Organisation → Zone → Branch → Person → Client → Day (SOW 11 / Master §15).
const NEXT: Record<string, string> = { zone: 'branch', branch: 'person', person: 'client', client: 'date', date: 'date' };
const FILTER: Record<string, string> = { zone: 'p_zone_id', branch: 'p_branch_id', person: 'p_person_id', client: 'p_client_id' };
type Step = { group: string; filter?: { key: string; id: string; name: string } };

export default function Reports({ me }: { me: Me }) {
  const [from, setFrom] = useState(monthStart(me.today));
  const [to, setTo] = useState(me.today);
  const [path, setPath] = useState<Step[]>([{ group: 'zone' }]);
  const cur = path.at(-1)!;
  const filters = Object.fromEntries(path.filter((p) => p.filter).map((p) => [p.filter!.key, p.filter!.id]));
  const r = useLoad(() => rpc<any[]>('ops_rollup', { p_from: from, p_to: to, p_group: cur.group, ...filters }), [from, to, JSON.stringify(path)]);
  const miss = useLoad(() => rpc<any[]>('missing_submissions', { p_work_date: to }), [to]);
  const t = (r.data ?? []).reduce((a, x) => ({ e: a.e + +x.entry, c: a.c + +x.closure, x: a.x + +x.cancelled, n: a.n + +x.net_actioned, rev: a.rev + +x.revenue, cs: a.cs + +x.crux_share, ps: a.ps + +x.partner_share, u: a.u + +x.unrated_lines }),
    { e: 0, c: 0, x: 0, n: 0, rev: 0, cs: 0, ps: 0, u: 0 });

  function drill(row: any) {
    if (cur.group === 'date') return;
    setPath([...path, { group: NEXT[cur.group], filter: { key: FILTER[cur.group], id: row.key, name: row.label } }]);
  }
  function csv() {
    const head = ['label', 'entry', 'closure', 'cancelled', 'net_actioned', 'revenue', 'crux_share', 'partner_share'];
    const body = (r.data ?? []).map((x) => head.map((h) => JSON.stringify(x[h] ?? '')).join(','));
    const meta = `# CRUX operations ${from} to ${to}; drill: ${path.map((p) => p.filter?.name ?? 'All').join(' > ')}; exported ${new Date().toISOString()}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([[meta, head.join(','), ...body].join('\n')], { type: 'text/csv' }));
    a.download = `crux-ops-${cur.group}-${from}-${to}.csv`; a.click();
  }

  return (
    <div className="stack">
      <div className="topbar"><div><h1>Reports</h1><div className="muted">Only records inside your scope are included. Select a row to drill down.</div></div>
        <div className="row"><label className="field">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="field">To<input type="date" value={to} max={me.today} onChange={(e) => setTo(e.target.value)} /></label></div></div>
      <div className="crumbs" aria-label="Drill-down path">{path.map((p, i) => <span key={i}>{i > 0 && '› '}<button onClick={() => setPath(path.slice(0, i + 1))}>{p.filter?.name ?? 'Organisation'}</button></span>)}
        <span className="muted">· showing by {label(cur.group)}</span></div>
      <div className="grid kpis">
        <Kpi label="Net cases actioned" value={num(t.n)} sub={`Gross ${num(t.e + t.c)} − cancelled ${num(t.x)}`} />
        <Kpi label="Revenue" value={money(t.rev)} sub={t.u ? `${t.u} line(s) have no rate card` : 'All lines rated'} />
        <Kpi label="CRUX share" value={money(t.cs)} sub={`Partner share ${money(t.ps)}`} />
      </div>
      <Card action={<button className="btn sm" onClick={csv} disabled={!r.data?.length}>Export CSV</button>}>
        {r.loading ? <Loading /> : <ErrorBox error={r.error} retry={r.reload} />}
        {r.data && (r.data.length === 0 ? <Empty>No submitted figures in this period within your scope.</Empty> : <div className="tablewrap"><table>
          <thead><tr><th>{label(cur.group)}</th><th className="num">Entry</th><th className="num">Closure</th><th className="num">Cancelled</th><th className="num">Net</th><th className="num">Revenue</th><th className="num">Partner share</th></tr></thead>
          <tbody>{r.data.map((x) => <tr key={x.key} className={cur.group !== 'date' ? 'click' : ''} onClick={() => drill(x)} tabIndex={cur.group !== 'date' ? 0 : -1} onKeyDown={(e) => e.key === 'Enter' && drill(x)}>
            <td>{cur.group === 'date' ? nice(x.key) : x.label}{+x.unrated_lines > 0 && <> <Pill status="exception" text="Rate missing" /></>}</td>
            <td className="num">{num(x.entry)}</td><td className="num">{num(x.closure)}</td><td className="num">{num(x.cancelled)}</td><td className="num"><b>{num(x.net_actioned)}</b></td>
            <td className="num">{money(x.revenue)}</td><td className="num">{money(x.partner_share)}</td></tr>)}</tbody></table></div>)}
      </Card>
      <Card title={`Missing submissions — ${nice(to)}`}>
        {miss.loading ? <Loading /> : <ErrorBox error={miss.error} />}
        {miss.data && (miss.data.length === 0 ? <Empty>Everyone in your scope has submitted or been resolved.</Empty> : <div className="tablewrap"><table>
          <thead><tr><th>Employee</th><th>Manager</th><th>Status</th><th>Deadline</th><th>Action needed</th></tr></thead>
          <tbody>{miss.data.map((m) => <tr key={m.person_id}><td>{m.full_name}</td><td>{m.manager_name ?? '—'}</td><td><Pill status={m.status} /></td><td>{time(m.deadline)}</td><td className="small">{m.required_action}</td></tr>)}</tbody></table></div>)}
      </Card>
    </div>
  );
}
