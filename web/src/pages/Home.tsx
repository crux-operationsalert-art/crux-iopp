import { Link } from 'react-router-dom';
import { entersFigures, Me, pageOff, paused, rpc, select, sb } from '../lib/api';
import { label, time } from '../lib/format';
import { MyAttendance } from './Attendance';
import Performance from './Performance';
import { TeamTable } from './Targets';
import CollectionsPerf from './Collections';
import { TaskStrip } from './Tasks';
import { PermissionCard } from './Notifications';
import { PerfOrProduct } from './Products';
import { Card, Empty, ErrorBox, Loading, Pill, useLoad } from '../components/ui';
import { JourneyCard, TodayHero, useJourney } from '../components/Journey';
import { Icon } from '../components/Icon';
import { MyDataIssues } from '../components/DataIssues';
import { CommitmentCard } from '../components/Commitment';
import { MyScorecard } from '../components/MyScorecard';

export default function Home({ me }: { me: Me }) {
  const today = me.today;
  const day = useLoad(() => rpc('my_day', { p_work_date: today }), [today]);
  const team = useLoad(() => me.manages_operations ? rpc<any[]>('team_status', { p_work_date: today }) : Promise.resolve([]), [today]);
  const cert = useLoad(() => me.manages_operations ? select('certifications', 'id', (b) => b.eq('manager_id', me.person_id).eq('work_date', today).eq('function', 'operations')) : Promise.resolve([]), [today]);
  const notes = useLoad(() => select('notifications', '*', (b) => b.is('read_at', null).order('created_at', { ascending: false }).limit(8)), []);

  const j = useJourney();
  const pending = (team.data ?? []).filter((t) => !t.resolved);
  // branch and company figures are for people who file or run them; everyone else sees their own scorecard (D-145)
  // everyone keeps the dashboards they had; only an individual who files no figures and has a scorecard sees the scorecard instead of revenue targets
  const business = !(me.individual && me.has_kpis && !entersFigures(me));

  return (
    <div className="stack">
      <TodayHero me={me} day={entersFigures(me) ? day.data : null} j={j.data ?? null} />
      {!!day.error && <ErrorBox error={day.error} retry={day.reload} />}
      {!!me.ea_for?.length && <div className="banner info">You are Executive Assistant to <b>{me.ea_for.join(', ')}</b>: you see what they see (read only) and can assign tasks on their behalf from Tasks.</div>}
      {!pageOff(me, 'tasks') && <TaskStrip me={me} />}
      <PermissionCard me={me} />
      {!paused(me, 'hr_docs') && <MyDataIssues />}
      {me.has_kpis && !pageOff(me, 'kpis') && <MyScorecard />}
      {entersFigures(me) && !pageOff(me, 'plan') && <CommitmentCard me={me} />}
      {entersFigures(me) && !pageOff(me, 'attendance') && <Card><MyAttendance me={me} compact /></Card>}
      {j.data && <JourneyCard j={j.data} />}

      {me.manages_operations && (
        <Card title="My team today" action={<Link className="btn" to="/team">Review team</Link>}>
          {team.loading ? <Loading rows={1} /> : <ErrorBox error={team.error} />}
          {team.data && (pending.length === 0
            ? <div className="banner ok">{cert.data?.length ? 'Your team is certified for today.' : 'Everyone in your direct team is resolved. You can certify now.'}</div>
            : <div className="stack"><div className="banner warn">{pending.length} of {team.data.length} still pending</div>
                <div className="chips">{pending.slice(0, 8).map((p) => <span key={p.person_id} className="chip">{p.full_name} · {label(p.status)}</span>)}</div></div>)}
        </Card>
      )}

      {/* an individual contributor sees their own month; branch and company dashboards are for people who run a team or a location (D-136) */}
      {!business ? null : me.individual ? <MyMonth me={me} />
        : me.ops_blind ? <><h2 style={{ margin: 0 }}>Collections</h2><CollectionsPerf me={me} month={today.slice(0, 7) + '-01'} /></> : <PerfOrProduct me={me} team={<Performance me={me} />} />}

      <Card title="Alerts">
        {notes.loading ? <Loading rows={1} /> : <ErrorBox error={notes.error} />}
        {notes.data && (notes.data.length === 0 ? <Empty>Nothing needs your attention.</Empty> :
          <div className="stack">{notes.data.map((n: any) => <Link key={n.id} to={n.link ?? '/notifications'} className="alert-row" onClick={() => { sb.rpc('mark_notifications_read', { p_ids: [n.id] }).then(() => null); }}>
              <Pill status="reopened" text={label(n.kind)} /><span className="grow">{n.message}</span><span className="small muted">{time(n.created_at)}</span><Icon name="back" size={16} className="flip" /></Link>)}
            <button className="btn sm" onClick={async () => { await sb.rpc('mark_notifications_read', {}); notes.reload(); }}>Mark all read</button></div>)}
      </Card>
    </div>
  );
}

/** My own target and achievement for the month (individual contributors). Quietly absent when Targets is turned off for the role. */
function MyMonth({ me }: { me: Me }) {
  const d = useLoad(() => rpc<any>('team_targets', { p_month: me.today.slice(0, 7) + '-01', p_person: null }), [me.today]);
  if (d.error || !d.data?.people?.length) return null;
  return <Card title="My month so far" help="Your own revenue and collection against your target for this month. Your daily figures are under My day."><TeamTable t={d.data} /></Card>;
}
