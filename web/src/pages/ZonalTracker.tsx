import { useMemo, useState } from 'react';
import { PrintButton, PrintStamp } from '../components/PrintButton';
import { Me, rpc } from '../lib/api';
import { nice } from '../lib/format';
import { Card, Empty, ErrorBox, Kpi, Loading, useLoad } from '../components/ui';
import { COL, downloadExcel, MRow, Sheet, sheetsFor, TExport } from '../lib/trackerModel';

const n0 = (v: unknown) => (v == null || v === '' ? '' : typeof v === 'number' ? new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(v) : String(v));
const MODE: Record<TExport['mode'], string> = {
  full: 'Whole business — every zone and location', zm: 'Your locations (as Zonal Manager)',
  team: 'Your team, person by person, plus your own figures', self: 'Your own figures',
};

/** Zonal Tracker produced from figures entered in the tool, in the Live Zonewise tracker's layout and colours. What you see depends on your role. */
export default function ZonalTracker({ me }: { me: Me }) {
  const [date, setDate] = useState(me.today);
  const [tab, setTab] = useState(0);
  const [hist, setHist] = useState(false);
  const [busy, setBusy] = useState('');
  const d = useLoad(() => rpc<TExport>('tracker_export', { p_date: date }), [date]);
  const sheets = useMemo(() => (d.data ? sheetsFor(d.data) : []), [d.data]);
  const sh = sheets[Math.min(tab, sheets.length - 1)];
  const pan = sh?.rows.find((r) => r.kind === 'pan');

  async function dl(f: boolean) { if (!d.data) return; setBusy(f ? 'f' : 'v'); try { await downloadExcel(d.data, f); } finally { setBusy(''); } }

  return (
    <div className="stack" style={{ minWidth: 0, maxWidth: '100%' }}>
      <div className="topbar">
        <div><h1>Zonal Tracker</h1>
          <div className="muted">{d.data ? MODE[d.data.mode] : 'Built from the figures entered in this app'}. Same layout, colours and formulas as the Live Zonewise tracker;
            rows follow today's locations, clients, heads and rates in the tool. Actual MTD = Incoming − Cancelled; Daily count = today's MTD − yesterday's.</div></div>
        <div className="row">
          <input type="date" value={date} max={me.today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="As on" style={{ width: 170 }} />
          <button className="btn" onClick={() => dl(true)} disabled={!d.data || !!busy}>{busy === 'f' ? 'Preparing…' : 'Download Excel'}</button>
          <button className="btn ghost" onClick={() => dl(false)} disabled={!d.data || !!busy} title="Values only, no formulas — for sending">{busy === 'v' ? 'Preparing…' : 'Values only'}</button>
          <PrintButton />
        </div>
      </div>
      <PrintStamp who={me.full_name} filters={`Zonal Tracker as on ${date}${d.data ? ' · ' + MODE[d.data.mode] : ''}`} />
      {d.loading ? <Loading rows={6} /> : <ErrorBox error={d.error} retry={d.reload} />}
      {d.data && sh && <>
        {d.data.source !== 'app' && <div className="note small">No figures have been entered in the tool for {nice(date).slice(3)} yet, so this shows the imported Zonal Tracker {d.data.source === 'tracker_daily' ? 'snapshot' : 'month'} for that date.</div>}
        {pan && <div className="grid kpis">
          <Kpi label="Actual MTD" value={n0(pan.cells[COL.H].v)} sub={Number(pan.cells[COL.D].v) ? `of ${n0(pan.cells[COL.D].v)} target · ${(Number(pan.cells[COL.H].v) / Number(pan.cells[COL.D].v) * 100).toFixed(1)}%` : 'no target set'} />
          <Kpi label="Actual revenue" value={'₹' + n0(pan.cells[COL.J].v)} sub={Number(pan.cells[COL.I].v) ? `of ₹${n0(pan.cells[COL.I].v)} · ${(Number(pan.cells[COL.K].v) * 100).toFixed(1)}%` : ''} />
          <Kpi label={`Daily count · ${nice(date)}`} value={n0(pan.cells[COL.N].v)} sub={`Incoming ${n0(pan.cells[COL.E].v)} · Closure ${n0(pan.cells[COL.F].v)} · Cancelled ${n0(pan.cells[COL.G].v)} (MTD)`} />
          <Kpi label="Working day" value={`${d.data.wd_done} of ${d.data.wd_total}`} />
        </div>}
        {sheets.length > 1 && <div className="chips">{sheets.map((s, i) => <button key={s.name} className={`chip ${i === tab ? 'on' : ''}`} onClick={() => setTab(i)}>{s.name}</button>)}</div>}
        {sh.histMonths.length > 0 && <label className="row small" style={{ gap: 8 }}><input type="checkbox" style={{ width: 'auto', minHeight: 0 }} checked={hist} onChange={(e) => setHist(e.target.checked)} /> Show past months ({sh.histMonths.length})</label>}
        {sh.rows.length <= 1 ? <Card><Empty>Nothing to show yet for {nice(date)}.</Empty></Card> : <TrackerTable sh={sh} hist={hist} />}
      </>}
    </div>
  );
}

function TrackerTable({ sh, hist }: { sh: Sheet; hist: boolean }) {
  const cols = [COL.A, COL.B, COL.C, COL.D, COL.E, COL.F, COL.G, COL.H, COL.I, COL.J, COL.K, COL.L, COL.M, COL.N,
    ...(hist ? sh.histMonths.flatMap((_, i) => [16 + i * 3, 17 + i * 3, 18 + i * 3]) : [])].filter((c) => sh.headers[c] !== '' || c === COL.C);
  const show = (r: MRow, c: number) => { const v = r.cells[c]?.v;
    if (c === COL.K && typeof v === 'number') return `${Math.round(v * 100)}%`;
    if (c === COL.L) return <span style={{ color: '#004a21', letterSpacing: -1 }}>{String(v ?? '')}</span>;
    return n0(v); };
  return (
    <div className="tablewrap tracker" tabIndex={0} style={{ maxHeight: '70vh', maxWidth: '100%', width: '100%', overflow: 'auto' }}>
      <table style={{ fontSize: 12, borderCollapse: 'collapse' }}>
        <tbody>{sh.rows.map((r, i) => r.kind === 'blank' ? <tr key={i}><td colSpan={cols.length} style={{ height: 10 }} /></tr> : (
          <tr key={i} style={{ fontWeight: r.bold ? 700 : 400, position: r.kind === 'header' ? 'sticky' : undefined, top: 0, zIndex: r.kind === 'header' ? 2 : undefined }}>
            {cols.map((c) => <td key={c} className={c > COL.C ? 'num' : ''}
              style={{ background: r.fill && (r.kind === 'cw_header' || r.kind === 'sh_header' ? c > COL.B : true) ? '#' + r.fill : undefined,
                       color: '#111', whiteSpace: r.kind.endsWith('header') ? 'pre-line' : 'nowrap', border: '1px solid #d0d7de', padding: '3px 6px',
                       minWidth: c === COL.L ? 120 : undefined, maxWidth: c === COL.C ? 170 : undefined, overflow: 'hidden', textOverflow: 'ellipsis' }}>{show(r, c)}</td>)}
          </tr>))}</tbody>
      </table>
    </div>
  );
}
