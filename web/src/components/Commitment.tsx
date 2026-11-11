import { Link } from 'react-router-dom';
import { Me, rpc } from '../lib/api';
import { Card, Loading, useLoad } from './ui';
import { Icon } from './Icon';

const tone = (pct: number | null | undefined) => (pct == null ? 'var(--muted)' : pct >= 90 ? 'var(--ok)' : pct >= 60 ? 'var(--warn)' : 'var(--bad)');

/** A gauge for "how committed / planned" — a half-circle filled to pct (D-113). */
export function CommitmentMeter({ pct, label, big }: { pct: number | null | undefined; label?: string; big?: boolean }) {
  const v = Math.max(0, Math.min(100, pct ?? 0));
  const r = 52, c = Math.PI * r;             // half circle
  const size = big ? 150 : 110;
  return (
    <div className="meter" style={{ width: size }} role="img" aria-label={label ?? `${pct ?? 0} percent`}>
      <svg viewBox="0 0 120 66" width={size} height={size * 0.55}>
        <path d="M8 60 A52 52 0 0 1 112 60" fill="none" stroke="var(--surface-2)" strokeWidth="10" strokeLinecap="round" />
        <path d="M8 60 A52 52 0 0 1 112 60" fill="none" stroke={tone(pct)} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${(v / 100) * c} ${c}`} />
      </svg>
      <div className="meter-val" style={{ color: tone(pct) }}>{pct == null ? '—' : `${pct}%`}</div>
      {label && <div className="small muted meter-label">{label}</div>}
    </div>
  );
}

/** Home card: check-in nudge + the "planned & committed" meter for me or my team (D-113). */
export function CommitmentCard({ me }: { me: Me }) {
  const d = useLoad(() => rpc<any>('commitment_meter', {}), []);
  const mine = useLoad(() => rpc<any>('my_plan', {}), []);
  if (d.loading || mine.loading) return <Card title="My plan"><Loading rows={2} /></Card>;
  const m = d.data, p = mine.data; if (!m || !p) return null;
  const manager = me.manages_operations;
  const title = manager ? 'How planned & committed we are' : 'My plan today';
  return (
    <Card title={title} action={<Link className="btn sm" to="/plan">Open</Link>}>
      {!p.checked_in_at && <div className="banner info" style={{ marginBottom: 10 }}>
        <div className="row"><span>You haven't checked in yet today.</span><span className="spacer" /><Link className="btn sm primary" to="/plan">Check in</Link></div></div>}
      <div className="commit-wrap">
        <CommitmentMeter pct={manager ? m.avg_commitment : p.commitment_pct} label={manager ? 'avg commitment' : (p.planned_total ? `${p.actual_total} of ${p.planned_total}` : 'not planned yet')} big />
        {manager
          ? <div className="commit-nums">
              <div><div className="muted small">Checked in</div><div className="display" style={{ fontSize: '1.4rem' }}>{m.checked_in}/{m.n}</div></div>
              <div><div className="muted small">Planned today</div><div className="display" style={{ fontSize: '1.4rem' }}>{m.planned}/{m.n}</div></div>
            </div>
          : <div className="commit-nums">
              <div><div className="muted small">Planned</div><div className="display" style={{ fontSize: '1.4rem' }}>{p.planned_total}</div></div>
              <div><div className="muted small">Done</div><div className="display" style={{ fontSize: '1.4rem' }}>{p.actual_total}</div></div>
            </div>}
      </div>
    </Card>
  );
}

/** Manager view of each person's check-in, plan and commitment today (D-113). */
export function TeamCommitment() {
  const d = useLoad(() => rpc<any[]>('team_commitment', {}), []);
  if (d.loading) return <Card title="My team — planned & committed today"><Loading rows={3} /></Card>;
  const rows = (d.data ?? []) as any[];
  return (
    <Card title="My team — planned & committed today" help="Who checked in, what they planned, and what they have done so far. Commitment % is done ÷ planned.">
      {rows.length === 0 ? <p className="muted">No team members.</p> : (
        <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Person</th><th>Checked in</th><th className="num">Planned</th><th className="num">Done</th><th className="num">Commit</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.person_id}>
            <td><b>{r.full_name}</b>{r.plan_note && <div className="small muted">{r.plan_note}</div>}</td>
            <td>{r.checked_in ? <span className="pill ok small"><Icon name="check" size={12} /> yes</span> : <span className="pill warn small">no</span>}</td>
            <td className="num">{r.planned_total || <span className="muted">—</span>}</td>
            <td className="num">{r.actual_total}</td>
            <td className="num">{r.commitment_pct == null ? <span className="muted">—</span> : <span className={`pill ${r.commitment_pct >= 90 ? 'ok' : r.commitment_pct >= 60 ? 'warn' : 'bad'} small`}>{r.commitment_pct}%</span>}</td>
          </tr>)}</tbody></table></div>)}
    </Card>
  );
}
