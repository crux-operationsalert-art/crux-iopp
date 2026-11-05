import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Me, rpc } from '../lib/api';
import { Card, ErrorBox, Kpi, Loading, Progress, Tabs, useLoad } from '../components/ui';
import { Bar, C, Chart, Spark } from '../components/Charts';
import CollectionsPerf from './Collections';
import { TeamTable } from './Targets';
import { TeamSplit } from './TeamSplit';
import { PrintButton, PrintStamp } from '../components/PrintButton';

type Row = { month: string; target: number | null; cases: number | null; revenue_target: number | null; revenue: number | null; billing?: number | null; source?: string };
type D = { month: string; today: string; wd_done: number; wd_total: number; series: Row[];
  by_stakeholder: (Row & { stakeholder: string })[]; by_location: (Row & { location: string; stakeholder: string })[];
  by_client: (Row & { client: string })[]; by_person: (Row & { person: string })[];
  daily: { d: string; cases: number; revenue: number }[]; team?: any; daily_tracker: { d: string; mtd_cases: number; mtd_revenue: number; target: number }[] };

const n0 = (v: number | null | undefined) => (v == null ? '—' : Math.round(Number(v)).toLocaleString('en-IN'));
const cr = (v: number | null | undefined) => { if (v == null) return '—'; const a = Math.abs(Number(v)); return a >= 1e7 ? `₹${(a / 1e7).toFixed(2)} Cr` : a >= 1e5 ? `₹${(a / 1e5).toFixed(2)} L` : `₹${n0(a)}`; };
const pc = (a: number | null | undefined, t: number | null | undefined) => (a == null || !t ? '—' : `${((Number(a) / Number(t)) * 100).toFixed(1)}%`);
const mon = (m: string) => new Date(m + 'T12:00:00').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
const addM = (m: string, k: number) => { const d = new Date(m + 'T12:00:00'); d.setMonth(d.getMonth() + k); return d.toISOString().slice(0, 7) + '-01'; };

/** Performance dashboard for the signed-in person's scope (their locations / team; all for leadership). */
export default function Performance({ me }: { me: Me }) {
  const [month, setMonth] = useState(me.today.slice(0, 7) + '-01');
  const [bt, setBt] = useState<'all' | 'own' | 'partner'>('all');
  const d = useLoad(() => rpc<D>('perf_dashboard', bt === 'all' ? { p_month: month } : { p_month: month, p_branch_type: bt }), [month, bt]);
  const [view, setView] = useState<'cases' | 'revenue'>('revenue');
  const x = d.data;
  const calc = useMemo(() => {
    if (!x) return null;
    const by = (m: string) => x.series.find((s) => s.month === m);
    const cur = by(month), prev = by(addM(month, -1)), ly = by(addM(month, -12));
    const mtd = Number(cur?.cases ?? 0), rev = Number(cur?.revenue ?? 0);
    const days = x.daily.filter((r) => r.d >= month);
    const lastDay = days.at(-1);
    const proj = x.wd_done ? (mtd / x.wd_done) * x.wd_total : null;
    const projRev = x.wd_done ? (rev / x.wd_done) * x.wd_total : null;
    // same working day last month: last month's tracker snapshot with the same day of month or earlier
    const dom = Number((lastDay?.d ?? x.today).slice(8, 10));
    const prevSnaps = x.daily_tracker.filter((s) => s.d.startsWith(addM(month, -1).slice(0, 7)) && Number(s.d.slice(8, 10)) <= dom);
    const prevSame = prevSnaps.at(-1);
    return { cur, prev, ly, mtd, rev, lastDay, proj, projRev, prevSame };
  }, [x, month]);
  if (d.loading) return <Loading rows={6} />;
  if (d.error) return <ErrorBox error={d.error} retry={d.reload} />;
  if (!x || !calc) return null;
  const labels = x.series.map((s) => mon(s.month));
  const sh = [...new Set(x.by_stakeholder.map((s) => s.stakeholder))];
  const shMonths = [...new Set(x.by_stakeholder.map((s) => s.month))].sort().slice(-6);
  const locCur = x.by_location.filter((r) => r.month === month), locPrev = x.by_location.filter((r) => r.month === addM(month, -1));
  const locRows = [...new Set([...locCur, ...locPrev].map((r) => r.location))].map((l) => {
    const c = locCur.find((r) => r.location === l), p = locPrev.find((r) => r.location === l);
    return { l, sh: (c ?? p)!.stakeholder, c, p, gap: Number(c?.revenue_target ?? 0) * (x.wd_done / x.wd_total) - Number(c?.revenue ?? 0) };
  }).sort((a, b) => b.gap - a.gap || Number(b.p?.revenue ?? 0) - Number(a.p?.revenue ?? 0));
  const people = [...new Set(x.by_person.map((r) => r.person))];
  const pMonths = [...new Set(x.by_person.map((r) => r.month))].sort().slice(-12);
  const clients = [...new Set(x.by_client.map((r) => r.client))];
  const cMonths = [...new Set(x.by_client.map((r) => r.month))].sort().slice(-3);
  const noTarget = !Number(calc.cur?.revenue_target);
  return (
    <div className="stack">
      <div className="row">
        <h2 style={{ margin: 0 }}>Performance — {mon(month)}{bt !== 'all' ? (bt === 'own' ? ' · own branches' : ' · partner branches') : ''}</h2><span className="spacer" />
        <Tabs tabs={[['all', 'Overall'], ['own', 'Own branches'], ['partner', 'Partner branches']]} value={bt} onChange={setBt} />
        <input type="month" value={month.slice(0, 7)} max={me.today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value + '-01')} style={{ width: 170 }} aria-label="Month" />
        <Link className="btn sm" to="/reports">Zonal Tracker ›</Link><PrintButton />
      </div>
      <PrintStamp who={me.full_name} filters={`Performance · ${mon(month)} · ${bt === 'all' ? 'overall' : bt + ' branches'} · scope: ${me.full_name}'s view`} />
      <div className="small muted">Working day {x.wd_done} of {x.wd_total}. {calc.cur?.source === 'app' ? 'Figures entered in this app.' : calc.cur ? 'From the Zonal Tracker history.' : 'No figures entered yet this month.'}
        {noTarget && month >= me.today.slice(0, 7) + '-01' ? ' No revenue targets set for this month yet (Targets).' : ''}</div>
      <div className="grid kpis">
        <Kpi label="MTD revenue" value={cr(calc.rev)} sub={noTarget ? 'no target set' : `of ${cr(calc.cur?.revenue_target)} target · ${pc(calc.rev, calc.cur?.revenue_target)}`} />
        <Kpi label="Latest day" value={calc.lastDay ? `+${cr(calc.lastDay.revenue)}` : '—'} sub={calc.lastDay ? `${calc.lastDay.d.slice(8, 10)}/${calc.lastDay.d.slice(5, 7)} · ${n0(calc.lastDay.cases)} cases` : 'nothing reported yet'} />
        <Kpi label="Projected month end" value={calc.projRev ? cr(calc.projRev) : '—'} sub={calc.projRev && !noTarget ? `${pc(calc.projRev, calc.cur?.revenue_target)} of target at current pace` : 'MTD ÷ working days done × working days'} />
        <Kpi label="Same day last month" value={calc.prevSame ? cr(calc.prevSame.mtd_revenue) : '—'} sub={calc.prevSame ? `MTD on ${calc.prevSame.d.slice(8, 10)}/${calc.prevSame.d.slice(5, 7)} (Zonal Tracker)` : 'no snapshot'} />
        <Kpi label="Last month final" value={cr(calc.prev?.revenue)} sub={calc.prev?.revenue_target ? `${pc(calc.prev?.revenue, calc.prev?.revenue_target)} of target` : ''} />
        <Kpi label="MTD cases" value={n0(calc.mtd)} sub={calc.cur?.target ? `of ${n0(calc.cur?.target)} · ${pc(calc.mtd, calc.cur?.target)}` : 'volume behind the revenue'} />
      </div>
      {!noTarget && <Progress value={(calc.rev / Number(calc.cur?.revenue_target)) * 100} />}
      <Card title="Trend" action={<Tabs tabs={[['revenue', 'Revenue ₹'], ['cases', 'Cases']]} value={view} onChange={setView} />}>
        <Chart labels={labels} series={view === 'cases'
          ? [{ name: 'Actual cases', values: x.series.map((s) => s.cases), color: C.navy, bars: true }, { name: 'Target cases', values: x.series.map((s) => s.target), color: C.blue }]
          : [{ name: 'Revenue', values: x.series.map((s) => s.revenue), color: C.navy, bars: true }, { name: 'Revenue target', values: x.series.map((s) => s.revenue_target), color: C.blue }, { name: 'Billing', values: x.series.map((s) => s.billing ?? null), color: C.grey, dashed: true }]} />
        <p className="small muted">Oct 2024 – Oct 2026: month-end cases, revenue and billing exactly as in the CRUX BI dashboard (the sum of the Zonal Tracker's client rows). From Nov 2026: figures entered in this app; billing = bills raised reported daily by the location heads. Monthly targets exist only from Oct 2026.</p>
      </Card>
      {x.team && x.team.people?.length > 0 && <Card title="Me and my team — revenue and collection vs target"><TeamTable t={x.team} /></Card>}
      {x.team && x.team.people?.length > 0 && <TeamSplit me={me} month={month} team={x.team} />}
      <h3 style={{ margin: '8px 0 0' }}>Collections — {mon(month)}</h3>
      <CollectionsPerf me={me} month={month} />
      <Card title="Stakeholders (Zonal Manager groups) — revenue">
        <div className="tablewrap" tabIndex={0}><table>
          <thead><tr><th>Stakeholder</th>{shMonths.map((m) => <th key={m} className="num">{mon(m)}</th>)}<th>Trend</th><th className="num">This month vs target</th></tr></thead>
          <tbody>{sh.map((s) => { const v = shMonths.map((m) => x.by_stakeholder.find((r) => r.stakeholder === s && r.month === m));
            const c = x.by_stakeholder.find((r) => r.stakeholder === s && r.month === month);
            return <tr key={s}><td><b>{s}</b></td>{v.map((r, i) => <td key={i} className="num">{cr(r?.revenue)}<div className="small muted">{n0(r?.cases)} cases</div></td>)}
              <td><Spark values={v.map((r) => r?.revenue ?? null)} /></td><td className="num">{pc(c?.revenue, c?.revenue_target)}</td></tr>; })}</tbody></table></div>
      </Card>
      <Card title="Locations — revenue this month vs last month (largest gap to pro-rata first)">
        <div className="tablewrap" tabIndex={0}><table>
          <thead><tr><th>Location</th><th>Stakeholder</th><th className="num">Last month ₹</th><th className="num">Last month ach.</th><th className="num">This month ₹</th><th className="num">Revenue target</th><th style={{ width: 140 }}>Achieved</th></tr></thead>
          <tbody>{locRows.slice(0, 40).map((r) => <tr key={r.l}><td>{r.l}</td><td className="small">{r.sh}</td><td className="num">{cr(r.p?.revenue)}</td><td className="num">{pc(r.p?.revenue, r.p?.revenue_target)}</td>
            <td className="num"><b>{cr(r.c?.revenue)}</b><div className="small muted">{n0(r.c?.cases)} cases</div></td><td className="num">{cr(r.c?.revenue_target)}</td>
            <td>{r.c?.revenue_target ? <Bar value={Number(r.c?.revenue ?? 0)} max={Number(r.c.revenue_target)} color={Number(r.c?.revenue ?? 0) / Number(r.c.revenue_target) >= x.wd_done / x.wd_total ? C.green : C.red} /> : <span className="small muted">no target</span>}</td></tr>)}</tbody></table></div>
      </Card>
      <div className="grid two">
        <Card title="People — 12-month revenue">
          <div className="tablewrap" tabIndex={0}><table><tbody>{people.map((p) => { const v = pMonths.map((m) => x.by_person.find((r) => r.person === p && r.month === m)?.revenue ?? null);
            const last = x.by_person.filter((r) => r.person === p && r.revenue != null).sort((a, b) => a.month.localeCompare(b.month)).at(-1);
            return <tr key={p}><td>{p}</td><td><Spark values={v} color={C.blue} /></td><td className="num small">{last ? `${cr(last.revenue)} in ${mon(last.month)}` : '—'}</td></tr>; })}</tbody></table></div>
          <p className="small muted">Up to Oct 2026: the Branch Manager / BA recorded against each row in the Zonal Tracker at the time. From Nov 2026: the person who entered the figures. Nothing is re-assigned to today's heads.</p>
        </Card>
        <Card title="Client families — last 3 months (revenue)">
          <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Client</th>{cMonths.map((m) => <th key={m} className="num">{mon(m)}</th>)}</tr></thead>
            <tbody>{clients.map((c) => ({ c, v: cMonths.map((m) => x.by_client.find((r) => r.client === c && r.month === m)?.revenue ?? null) }))
              .sort((a, b) => Number(b.v.at(-2) ?? 0) - Number(a.v.at(-2) ?? 0)).slice(0, 15)
              .map(({ c, v }) => <tr key={c}><td>{c}</td>{v.map((x2, i) => <td key={i} className="num">{cr(x2)}</td>)}</tr>)}</tbody></table></div>
        </Card>
      </div>
    </div>
  );
}
