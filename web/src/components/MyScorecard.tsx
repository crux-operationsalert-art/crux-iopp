import { Link } from 'react-router-dom';
import { rpc } from '../lib/api';
import { Card, Empty, ErrorBox, Loading, useLoad } from './ui';

export type KpiLine = { kpi_id: string; name: string; unit: string | null; target: number; actual: number | null; pct: number | null; auto: boolean; higher_better: boolean; cadence: string };
const fmt = (n: number | null, unit: string | null) => (n == null ? '—' : unit === '%' ? `${Number(n).toLocaleString('en-IN')}%` : unit === '₹' ? `₹${Number(n).toLocaleString('en-IN')}` : Number(n).toLocaleString('en-IN'));
const tone = (p: number | null) => (p == null ? 'neutral' : p >= 100 ? 'ok' : p >= 70 ? 'warn' : 'bad');

/** One KPI: what it is, the target, the result so far and how that scores. Used on Home, My update and in reviews. */
export function KpiLines({ lines }: { lines: KpiLine[] }) {
  return (
    <div>{lines.map((l) => (
      <div key={l.kpi_id} className="scoreline">
        <div><b>{l.name.replace(/ – (Rate %|Volume|Value \(₹\))$/, '')}</b>
          <div className="small muted">Target {l.higher_better ? 'at least' : 'at most'} {fmt(l.target, l.unit)} · {l.actual == null ? (l.auto ? 'no target set for this month' : 'no result entered yet') : `so far ${fmt(l.actual, l.unit)}`}{l.auto ? ' · counted automatically' : ''}</div></div>
        <span className={`pill ${tone(l.pct)} small`}>{l.pct == null ? 'Not scored yet' : `${Math.round(l.pct)}% of target`}</span>
        <div className="progress" role="img" aria-label={l.pct == null ? `${l.name}: not scored yet` : `${l.name}: ${Math.round(l.pct)}% of target`}><span style={{ width: `${Math.min(100, Math.max(0, l.pct ?? 0))}%` }} /></div>
      </div>))}</div>
  );
}

/** My scorecard for this month (D-145): the KPIs my manager set are what I am measured on, nothing else. */
export function MyScorecard({ link = true }: { link?: boolean }) {
  const d = useLoad(() => rpc<{ month: string; lines: KpiLine[]; achievement: number | null; attributes: string[] }>('my_scorecard', {}), []);
  const month = d.data ? new Date(d.data.month).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : '';
  return (
    <Card title={`My scorecard${month ? ' · ' + month : ''}`} help="The KPIs your reporting manager set for you, with your result so far this month. These, with your attributes, make your monthly score."
      action={link ? <Link className="btn sm" to="/kpis">Update my KPIs</Link> : undefined}>
      {d.loading ? <Loading rows={2} /> : d.error ? <ErrorBox error={d.error} retry={d.reload} />
        : !d.data?.lines.length ? <Empty>No KPIs are set for you yet. Your reporting manager sets these up.</Empty>
        : <><KpiLines lines={d.data.lines} />
            {d.data.attributes.length > 0 && <p className="small muted" style={{ margin: '10px 0 0' }}>Attributes you are rated on: {d.data.attributes.join(', ')}.</p>}</>}
    </Card>
  );
}
