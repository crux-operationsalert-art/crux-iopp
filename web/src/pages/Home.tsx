import { Link } from 'react-router-dom';
import { entersFigures, Me, rpc, select, sb } from '../lib/api';
import { label, nice, time } from '../lib/format';
import { MyAttendance } from './Attendance';
import Performance from './Performance';
import CollectionsPerf from './Collections';
import { TaskStrip } from './Tasks';
import { PermissionCard } from './Notifications';
import { PerfOrProduct } from './Products';
import { Card, Countdown, Empty, ErrorBox, Loading, Pill, useLoad } from '../components/ui';

export default function Home({ me }: { me: Me }) {
  const today = me.today;
  const day = useLoad(() => rpc('my_day', { p_work_date: today }), [today]);
  const team = useLoad(() => me.manages_operations ? rpc<any[]>('team_status', { p_work_date: today }) : Promise.resolve([]), [today]);
  const cert = useLoad(() => me.manages_operations ? select('certifications', 'id', (b) => b.eq('manager_id', me.person_id).eq('work_date', today).eq('function', 'operations')) : Promise.resolve([]), [today]);
  const notes = useLoad(() => select('notifications', '*', (b) => b.is('read_at', null).order('created_at', { ascending: false }).limit(8)), []);

  const st = day.data?.status?.status ?? (day.data?.rows?.length ? 'pending' : null);
  const pending = (team.data ?? []).filter((t) => !t.resolved);

  return (
    <div className="stack">
      <div className="topbar"><div><h1>Good day, {me.full_name.split(' ')[0]}</h1><div className="muted">{nice(today)} · {me.company?.name}</div></div></div>
      {!!me.ea_for?.length && <div className="banner info">You are Executive Assistant to <b>{me.ea_for.join(', ')}</b>: you see what they see (read only) and can assign tasks on their behalf from Tasks.</div>}
      <TaskStrip me={me} />
      <PermissionCard me={me} />

      {entersFigures(me) && <Card title="Today" action={<Link className="btn primary" to="/productivity">Enter today's numbers ›</Link>}>
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
      </Card>}

      {me.manages_operations && (
        <Card title="My team today" action={<Link className="btn" to="/team">Review team</Link>}>
          {team.loading ? <Loading rows={1} /> : <ErrorBox error={team.error} />}
          {team.data && (pending.length === 0
            ? <div className="banner ok">{cert.data?.length ? 'Your team is certified for today.' : 'Everyone in your direct team is resolved. You can certify now.'}</div>
            : <div className="stack"><div className="banner warn">{pending.length} of {team.data.length} still pending</div>
                <div className="chips">{pending.slice(0, 8).map((p) => <span key={p.person_id} className="chip">{p.full_name} · {label(p.status)}</span>)}</div></div>)}
        </Card>
      )}

      {me.ops_blind ? <><h2 style={{ margin: 0 }}>Collections</h2><CollectionsPerf me={me} month={today.slice(0, 7) + '-01'} /></> : <PerfOrProduct me={me} team={<Performance me={me} />} />}

      <Card title="Alerts">
        {notes.loading ? <Loading rows={1} /> : <ErrorBox error={notes.error} />}
        {notes.data && (notes.data.length === 0 ? <Empty>Nothing needs your attention.</Empty> :
          <div className="stack">{notes.data.map((n: any) => <div key={n.id} className="row"><Pill status="reopened" text={label(n.kind)} /><span>{n.message}</span><span className="spacer" /><span className="small muted">{time(n.created_at)}</span></div>)}
            <button className="btn sm" onClick={async () => { await sb.rpc('mark_notifications_read', {}); notes.reload(); }}>Mark all read</button></div>)}
      </Card>
    </div>
  );
}
