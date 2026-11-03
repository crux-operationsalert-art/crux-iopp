import { Fragment, useMemo, useState } from 'react';
import { utils, writeFile } from 'xlsx';
import { Me, rpc } from '../lib/api';
import { nice } from '../lib/format';
import { Card, Empty, ErrorBox, Kpi, Loading, useLoad } from '../components/ui';

export type ZRow = { region: string; zone: string; location: string; client: string; stakeholder: string | null; head: string | null; rate: number | null;
  target_cases: number; revenue_target: number; mtd_cases: number; mtd_revenue: number; prev_cases: number; prev_revenue: number; reported_added: number;
  entry_today: number; closure_today: number; cancelled_today: number; mtd_entry: number; mtd_closure: number; mtd_cancelled: number; unrated_lines: number };
export type ZData = { as_of: string; prev_as_of: string | null; wd_done: number; wd_total: number; rows: ZRow[]; dates: string[] };

const n0 = (v: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(v);
const rs = (v: number) => (v < 0 ? '−₹' : '₹') + n0(Math.abs(v));
const pct = (a: number, t: number) => (t > 0 ? `${((a / t) * 100).toFixed(1)}%` : '—');
type Tot = { t: number; a: number; rt: number; ra: number; d: number; e: number; c: number; x: number };
const sum = (rs: ZRow[]): Tot => rs.reduce((s, r) => ({ t: s.t + +r.target_cases, a: s.a + +r.mtd_cases, rt: s.rt + +r.revenue_target, ra: s.ra + +r.mtd_revenue,
  d: s.d + +r.reported_added, e: s.e + +r.entry_today, c: s.c + +r.closure_today, x: s.x + +r.cancelled_today }), { t: 0, a: 0, rt: 0, ra: 0, d: 0, e: 0, c: 0, x: 0 });
const groupBy = <T,>(rs: T[], f: (r: T) => string) => { const m = new Map<string, T[]>(); rs.forEach((r) => m.set(f(r), [...(m.get(f(r)) ?? []), r])); return [...m.entries()]; };

function Cells({ s, bold }: { s: Tot; bold?: boolean }) {
  const B = ({ v }: { v: string }) => (bold ? <b>{v}</b> : <>{v}</>);
  return <>
    <td className="num"><B v={n0(s.t)} /></td><td className="num"><B v={n0(s.a)} /></td><td className="num"><B v={'₹' + n0(s.rt)} /></td><td className="num"><B v={'₹' + n0(s.ra)} /></td>
    <td className="num"><B v={pct(s.ra, s.rt)} /></td><td className="num"><B v={n0(s.d)} /></td><td className="num small">{n0(s.e)} / {n0(s.c)} / {n0(s.x)}</td>
    <td className="num" style={{ color: s.ra - s.rt < 0 ? 'var(--bad, #b42318)' : undefined }}><B v={rs(s.ra - s.rt)} /></td></>;
}

export default function ZonalTracker({ me }: { me: Me }) {
  const [date, setDate] = useState(me.today);
  const [who, setWho] = useState('');
  const d = useLoad(() => rpc<ZData>('zonal_tracker', { p_date: date }), [date]);
  const all = d.data?.rows ?? [];
  const owners = useMemo(() => [...new Set(all.map((r) => r.stakeholder ?? 'Unassigned'))].sort(), [all]);
  const rows = all.filter((r) => !who || (r.stakeholder ?? 'Unassigned') === who);
  const pan = sum(rows);

  function excel() {
    const aoa: (string | number | null)[][] = [[`Zonal Business Tracker — as on ${date} (produced by CRUX IOPP)`], [],
      ['Zone / Location', 'Client', 'Location head', `Target ${date.slice(0, 7)}`, 'Actual MTD', 'Revenue Tgt', 'Actual Revenue', '% Achmt', 'Daily count', 'Entry today', 'Closure today', 'Cancelled today', 'Shortfall', 'Stakeholder']];
    for (const [reg, rr] of groupBy(rows, (r) => r.region)) {
      for (const [zone, zr] of groupBy(rr, (r) => r.zone)) {
        aoa.push([zone]);
        for (const [loc, lr] of groupBy(zr, (r) => r.location)) {
          lr.forEach((r) => aoa.push([loc, r.client, r.head, +r.target_cases, +r.mtd_cases, +r.revenue_target, +r.mtd_revenue, r.revenue_target ? +(r.mtd_revenue / r.revenue_target).toFixed(4) : 0,
            +r.reported_added, +r.entry_today, +r.closure_today, +r.cancelled_today, +r.mtd_revenue - +r.revenue_target, r.stakeholder]));
          const s = sum(lr); aoa.push([`Total ${loc}`, '', '', s.t, s.a, s.rt, s.ra, s.rt ? +(s.ra / s.rt).toFixed(4) : 0, s.d, s.e, s.c, s.x, s.ra - s.rt]);
        }
      }
      const s = sum(rr); aoa.push([`${reg} region`, '', '', s.t, s.a, s.rt, s.ra, s.rt ? +(s.ra / s.rt).toFixed(4) : 0, s.d, s.e, s.c, s.x, s.ra - s.rt], []);
    }
    aoa.push(['Pan India', '', '', pan.t, pan.a, pan.rt, pan.ra, pan.rt ? +(pan.ra / pan.rt).toFixed(4) : 0, pan.d, pan.e, pan.c, pan.x, pan.ra - pan.rt], [], ['Operation Stakeholders', '', '', 'Target', 'Actual MTD', 'Revenue Tgt', 'Actual Revenue', '% Achmt', "Today's count"]);
    for (const [o, or] of groupBy(rows, (r) => r.stakeholder ?? 'Unassigned')) { const s = sum(or); aoa.push([o, '', '', s.t, s.a, s.rt, s.ra, s.rt ? +(s.ra / s.rt).toFixed(4) : 0, s.d]); }
    const wb = utils.book_new(); const ws = utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 34 }, { wch: 18 }, { wch: 18 }];
    utils.book_append_sheet(wb, ws, 'Main Tracker'); writeFile(wb, `Zonal_Tracker_${date}.xlsx`);
  }

  return (
    <div className="stack">
      <div className="topbar">
        <div><h1>Zonal Tracker</h1><div className="muted">Built from the figures entered in this app (not from the WhatsApp tracker). Actual = entered − cancelled; revenue = cases × rate on each day; daily count = today's MTD − yesterday's.</div></div>
        <div className="row">
          <input type="date" value={date} max={me.today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="As on" style={{ width: 170 }} />
          {owners.length > 1 && <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Stakeholder" style={{ width: 220 }}><option value="">All stakeholders</option>{owners.map((o) => <option key={o}>{o}</option>)}</select>}
          <button className="btn" onClick={excel} disabled={!rows.length}>Download Excel</button>
        </div>
      </div>
      {d.loading ? <Loading rows={5} /> : <ErrorBox error={d.error} retry={d.reload} />}
      {d.data && (rows.length === 0 ? <Card><Empty>No targets or figures yet for your locations in {date.slice(0, 7)}. Figures appear as people submit My day; targets come from Admin → Monthly targets.</Empty></Card> : <>
        <div className="grid kpis">
          <Kpi label="Actual MTD" value={n0(pan.a)} sub={`of ${n0(pan.t)} target cases · ${pct(pan.a, pan.t)}`} />
          <Kpi label="Actual revenue" value={'₹' + n0(pan.ra)} sub={`of ₹${n0(pan.rt)} · ${pct(pan.ra, pan.rt)}`} />
          <Kpi label={`Daily count · ${nice(date)}`} value={n0(pan.d)} sub={`Entry ${n0(pan.e)} · Closure ${n0(pan.c)} · Cancelled ${n0(pan.x)}`} />
          <Kpi label="Working day" value={`${d.data.wd_done} of ${d.data.wd_total}`} sub={rows.some((r) => r.unrated_lines > 0) ? 'Some rows have no rate — revenue shows ₹0 for them' : ''} />
        </div>
        <Card title="Operation stakeholders">
          <div className="tablewrap"><table>
            <thead><tr><th>Stakeholder</th><th className="num">Target</th><th className="num">Actual MTD</th><th className="num">Revenue tgt</th><th className="num">Actual revenue</th><th className="num">% Achmt</th><th className="num">Daily count</th><th className="num">E / C / X today</th><th className="num">Shortfall</th></tr></thead>
            <tbody>{groupBy(rows, (r) => r.stakeholder ?? 'Unassigned').map(([o, or]) => <tr key={o}><td><b>{o}</b></td><Cells s={sum(or)} /></tr>)}
              <tr><td><b>Total</b></td><Cells s={pan} bold /></tr></tbody></table></div>
        </Card>
        <Card title="Main tracker">
          <div className="tablewrap"><table>
            <thead><tr><th>Zone · location · client</th><th className="num">Target</th><th className="num">Actual MTD</th><th className="num">Revenue tgt</th><th className="num">Actual revenue</th><th className="num">% Achmt</th><th className="num">Daily count</th><th className="num">E / C / X today</th><th className="num">Shortfall</th></tr></thead>
            <tbody>{groupBy(rows, (r) => r.region).map(([reg, rr]) => (
              <Fragment key={reg}>
                {groupBy(rr, (r) => r.zone).map(([zone, zr]) => (
                  <Fragment key={zone}>
                    <tr><td colSpan={9} style={{ background: 'var(--surface-2, #f3f4f6)' }}><b>{zone}</b> <span className="small muted">· {zr[0].stakeholder ?? 'no stakeholder'}</span></td></tr>
                    {groupBy(zr, (r) => r.location).map(([loc, lr]) => (
                      <Fragment key={loc}>
                        {lr.map((r) => <tr key={loc + r.client}><td style={{ paddingLeft: 18 }}>{r.client}<div className="small muted">{loc !== zone ? loc + ' · ' : ''}{r.head ?? 'no head'}{r.rate ? ` · ₹${n0(r.rate)}/case` : ' · no rate'}</div></td><Cells s={sum([r])} /></tr>)}
                        <tr><td style={{ paddingLeft: 18 }}><b>Total {loc}</b></td><Cells s={sum(lr)} bold /></tr>
                      </Fragment>))}
                  </Fragment>))}
                <tr><td><b>{reg} region</b></td><Cells s={sum(rr)} bold /></tr>
              </Fragment>))}
              <tr><td><b>Pan India</b>{who && <span className="small muted"> ({who})</span>}</td><Cells s={pan} bold /></tr></tbody></table></div>
        </Card></>)}
    </div>
  );
}
