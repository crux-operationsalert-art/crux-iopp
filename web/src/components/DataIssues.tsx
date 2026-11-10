import { Link } from 'react-router-dom';
import { Me, rpc } from '../lib/api';
import { Card, Loading, useLoad } from './ui';

export type Issue = { code: string; label: string; detail: string; severity: 'high' | 'medium' | 'low' };
const sevPill: Record<string, string> = { high: 'bad', medium: 'warn', low: 'neutral' };

/** The person's own details that need correcting, with where to fix them (D-104). */
export function MyDataIssues({ to = '/profile' }: { to?: string }) {
  const d = useLoad(() => rpc<Issue[]>('my_data_issues'), []);
  if (!d.data || d.data.length === 0) return null;
  return (
    <Card title="Please correct your details" help="These details are missing or do not look right. Fixing them keeps your profile, pay and records correct.">
      <div className="stack" style={{ gap: 8 }}>
        {d.data.map((x) => <div key={x.code} className="row" style={{ alignItems: 'start', gap: 8 }}>
          <span className={`pill ${sevPill[x.severity]} small`} style={{ marginTop: 2 }}>{x.label}</span>
          <span className="small">{x.detail}</span></div>)}
        {to ? <div><Link className="btn sm primary" to={to}>Fix now</Link></div> : <p className="small muted">Correct them below.</p>}
      </div>
    </Card>
  );
}

/** Admin / HR: a person's data issues (read-only list). */
export function DataIssueList({ issues }: { issues: Issue[] }) {
  if (!issues || issues.length === 0) return <div className="banner ok small">All details are present and valid.</div>;
  return <div className="stack" style={{ gap: 6 }}>{issues.map((x) => <div key={x.code} className="row small" style={{ gap: 8 }}>
    <span className={`pill ${sevPill[x.severity]} small`}>{x.label}</span><span className="muted">{x.detail}</span></div>)}</div>;
}

/** Admin / HR: how much time this person spends in CRUX, and in which hours of the day (D-105, in-app only). */
export function AppUsage({ personId }: { me?: Me; personId: string }) {
  const d = useLoad(() => rpc<any>('person_activity', { p_person: personId, p_days: 21 }), [personId]);
  if (d.loading) return <Loading rows={2} />;
  if (!d.data) return null;
  const a = d.data, hours: number[] = a.by_hour ?? [];
  const max = Math.max(1, ...hours);
  const totalMin = Math.round((a.total_seconds ?? 0) / 60);
  const perDay = a.days?.length ? Math.round(totalMin / a.days.length) : 0;
  const hh = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`;
  return (
    <div className="stack">
      <div className="row small"><b>App usage (last 21 days)</b><span className="muted">in-app time only</span></div>
      <div className="row" style={{ gap: 16 }}>
        <div><div className="display" style={{ fontSize: '1.4rem' }}>{totalMin < 60 ? `${totalMin} min` : `${(totalMin / 60).toFixed(1)} h`}</div><div className="small muted">total · ~{perDay} min a day</div></div>
        {a.busiest_hour != null && <div><div className="display" style={{ fontSize: '1.4rem' }}>{hh(a.busiest_hour)}</div><div className="small muted">most active hour</div></div>}
        {a.last_active && <div><div className="small">Last seen</div><div className="small muted">{new Date(a.last_active).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div></div>}
      </div>
      {totalMin > 0 ? <div className="hourbars" aria-label="Activity by hour of day">
        {hours.map((s, h) => <div key={h} className="hourbar" title={`${hh(h)}: ${Math.round(s / 60)} min`}>
          <div className="hb-fill" style={{ height: `${Math.round((s / max) * 100)}%` }} />
          {h % 6 === 0 && <span className="hb-label">{hh(h)}</span>}</div>)}
      </div> : <div className="muted small">No app activity recorded yet.</div>}
    </div>
  );
}
