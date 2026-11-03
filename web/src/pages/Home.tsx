import { Link } from 'react-router-dom';
import { isLeader, Me, rpc, select, sb } from '../lib/api';
import { label, money, monthStart, nice, num, pct, time } from '../lib/format';
import { MyAttendance } from './Attendance';
import { Card, Countdown, Empty, ErrorBox, Kpi, Loading, Pill, Progress, useLoad } from '../components/ui';

export default function Home({ me }: { me: Me }) {
  const today = me.today, from = monthStart(today);
  const day = useLoad(() => rpc('my_day', { p_work_date: today }), [today]);
  const mine = useLoad(() => rpc<any[]>('ops_rollup', { p_from: from, p_to: today, p_group: 'person', p_person_id: me.person_id }), [today]);
  const tgt = useLoad(() => rpc<any[]>('target_progress', { p_month: from }), [from]);
  const team = useLoad(() => me.manages_operations ? rpc<any[]>('team_status', { p_work_date: today }) : Promise.resolve([]), [today]);
  const scope = useLoad(() => isLeader(me) ? rpc<any[]>('ops_rollup', { p_from: from, p_to: today, p_group: 'zone' }) : Promise.resolve([]), [today]);
  const cert = useLoad(() => me.manages_operations ? select('certifications', 'id', (b) => b.eq('manager_id', me.person_id).eq('work_date', today).eq('function', 'operations')) : Promise.resolve([]), [today]);
  const notes = useLoad(() => select('notifications', '*', (b) => b.is('read_at', null).order('created_at', { ascending: false }).limit(8)), []);

  const m = mine.data?.[0];
  const st = day.data?.status?.status ?? (day.data?.rows?.length ? 'pending' : null);
  const pending = (team.data ?? []).filter((t) => !t.resolved);
  const org = (scope.data ?? []).reduce((a, r) => ({ net: a.net + Number(r.net_actioned), rev: a.rev + Number(r.revenue), c: a.c + Number(r.cancelled) }), { net: 0, rev: 0, c: 0 });

  return (
    <div className="stack">
      <div className="topbar"><div><h1>Good day, {me.full_name.split(' ')[0]}</h1><div className="muted">{nice(today)} · figures are month-to-date</div></div></div>

      <Card title="Today" action={<Link className="btn primary" to="/productivity">Enter today's numbers ›</Link>}>
        <MyAttendance me={me} compact />
        {day.loading ? <Loading rows={1} /> : <ErrorBox error={day.error} retry={day.reload} />}
        {day.data && (
          day.data.rows.length === 0 ? <Empty>{me.manages_operations ? 'You have no client rows of your own today. Your own contribution is optional.' : 'No clients or locations are assigned to you today. If that is wrong, tell your manager.'}</Empty> :
          <div className="row">
            {st && <Pill status={st} />}
            <span className="muted">{day.data.rows.length} client/location row(s)</span>
            <span className="spacer" />
            {day.data.window === 'open' && <Countdown to={day.data.deadline} prefix="Deadline midnight · " />}
            {day.data.window === 'grace' && <span className="pill warn">Late window · <Countdown to={day.data.grace_deadline} /></span>}
            {day.data.window === 'closed' && <Pill status="closed" text="Closed — Admin reopen needed" />}
          </div>
        )}
      </Card>

      {me.manages_operations && (
        <Card title="My team today" action={<Link className="btn" to="/team">Review team</Link>}>
          {team.loading ? <Loading rows={1} /> : <ErrorBox error={team.error} />}
          {team.data && (pending.length === 0
            ? <div className="banner ok">{cert.data?.length ? 'Your team is certified for today.' : 'Everyone in your direct team is resolved. You can certify now.'}</div>
            : <div className="stack"><div className="banner warn">{pending.length} of {team.data.length} still pending</div>
                <div className="chips">{pending.slice(0, 8).map((p) => <span key={p.person_id} className="chip">{p.full_name} · {label(p.status)}</span>)}</div></div>)}
        </Card>
      )}

      <div className="grid kpis">
        <Kpi label="Net cases actioned" value={num(m?.net_actioned ?? 0)} sub={`Entry ${num(m?.entry ?? 0)} + Closure ${num(m?.closure ?? 0)} − Cancelled ${num(m?.cancelled ?? 0)}`} />
        <Kpi label="My revenue" value={money(m?.revenue ?? 0)} sub={Number(m?.unrated_lines ?? 0) > 0 ? `${m.unrated_lines} row(s) have no rate` : 'At the rate in effect each day'} />
        {isLeader(me) && <Kpi label="My scope — net actioned" value={num(org.net)} sub={`Cancellations reduced this by ${num(org.c)}`} />}
        {isLeader(me) && <Kpi label="My scope — revenue" value={money(org.rev)} />}
      </div>

      <Card title="Targets this month" action={<Link className="btn" to="/targets">Details</Link>}>
        {tgt.loading ? <Loading rows={2} /> : <ErrorBox error={tgt.error} retry={tgt.reload} />}
        {tgt.data && (tgt.data.length === 0 ? <Empty>No target has been set for you this month yet.</Empty> :
          <div className="stack">{tgt.data.map((t) => (
            <div key={t.target_id}>
              <div className="row"><b>{label(t.metric)}</b><span className="spacer" />
                <span className="num">{t.metric.includes('revenue') || t.metric.includes('amount') || t.metric.startsWith('collections') ? money(t.actual) : num(t.actual)} of {t.metric.includes('revenue') || t.metric.includes('amount') || t.metric.startsWith('collections') ? money(t.target) : num(t.target)} · {pct(t.achievement_pct)}</span></div>
              <Progress value={t.achievement_pct} />
              <div className="small muted">Needed per working day: {num(t.required_daily_run_rate)} · Projection (not a forecast commitment): {num(t.projected_month_end)}</div>
            </div>))}</div>)}
      </Card>

      <Card title="Alerts">
        {notes.loading ? <Loading rows={1} /> : <ErrorBox error={notes.error} />}
        {notes.data && (notes.data.length === 0 ? <Empty>Nothing needs your attention.</Empty> :
          <div className="stack">{notes.data.map((n: any) => <div key={n.id} className="row"><Pill status="reopened" text={label(n.kind)} /><span>{n.message}</span><span className="spacer" /><span className="small muted">{time(n.created_at)}</span></div>)}
            <button className="btn sm" onClick={async () => { await sb.rpc('mark_notifications_read', {}); notes.reload(); }}>Mark all read</button></div>)}
      </Card>
    </div>
  );
}
