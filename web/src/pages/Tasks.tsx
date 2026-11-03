import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Me, rpc, select } from '../lib/api';
import { label, time } from '../lib/format';
import { Card, Empty, ErrorBox, Loading, Tabs, useLoad } from '../components/ui';
import { ActivationBanner } from '../components/Onboarding';

export type Task = { id: string; kind: string; category: 'miss' | 'task'; title: string; detail: any; status: string; condition_cleared: boolean;
  owner_id: string | null; owner_name: string | null; subject_name: string | null; branch: string | null; client: string | null;
  ref_date: string | null; ref_month: string | null; created_at: string; updated_at: string; scope: 'mine' | 'team' | 'admin';
  last_note: string | null; last_action: string | null; last_at: string | null };

const ST: Record<string, [string, string]> = {
  open: ['bad', 'Reply needed'], replied: ['warn', 'Replied — request resolution when fixed'], resolution_requested: ['info', 'Waiting for Admin'],
  info_requested: ['warn', 'Admin asked for more details'], denied: ['bad', 'Not accepted — still open'], resolved: ['ok', 'Resolved'],
};
export const KIND: Record<string, string> = {
  missed_submission: 'Missed daily report', collections_missing: 'Collections not reported', uncertified_team: 'Team not certified', behind_target: 'Behind target', tat_mismatch: 'Pending did not tally',
  missing_rate: 'Missing rate', onboarding: 'Onboarding', add_team: 'Add team', salary_missing: 'Salary', profile_incomplete: 'Profile',
};

/** Runs the organisation-wide task check (throttled on the server) and returns open tasks. */
export function useTasks(me: Me, scope: 'open' | 'all' = 'open') {
  const [synced, setSynced] = useState(false);
  useEffect(() => { rpc('sync_tasks').catch(() => null).finally(() => setSynced(true)); }, []);
  return useLoad(() => (synced ? rpc<Task[]>('my_tasks', { p_scope: scope }) : Promise.resolve(null as any)), [synced, scope, me.person_id]);
}

export default function Tasks({ me }: { me: Me }) {
  const isAdmin = me.roles.includes('admin');
  const [scope, setScope] = useState<'open' | 'all'>('open');
  const t = useTasks(me, scope);
  const [tab, setTab] = useState<'mine' | 'team' | 'admin'>(isAdmin ? 'admin' : 'mine');
  const rows = (t.data ?? []) as Task[];
  const pick = rows.filter((r) => (tab === 'admin' ? r.scope === 'admin' || (r.owner_id === null && r.status !== 'resolved') : r.scope === tab));
  const count = (s: string) => rows.filter((r) => (s === 'admin' ? r.scope === 'admin' : r.scope === s) && r.status !== 'resolved').length;
  return (
    <div className="stack">
      <div className="topbar"><div><h1>Tasks & misses</h1><div className="muted">A <b>miss</b> needs your reason and stays open until Admin resolves it after your request. A <b>to-do</b> closes by itself once it is done.</div></div>
        <div className="row"><Tabs tabs={[['open', 'Open'], ['all', 'All']]} value={scope} onChange={setScope} /></div></div>
      <Tabs tabs={[['mine', `Mine (${count('mine')})`], ['team', `My team's (${count('team')})`], ...(isAdmin ? [['admin', `Admin queue (${count('admin')})`] as ['admin', string]] : [])]} value={tab} onChange={setTab} />
      {t.loading || !t.data ? <Loading rows={4} /> : <ErrorBox error={t.error} retry={t.reload} />}
      {t.data && (pick.length === 0 ? <Card><Empty>Nothing here.</Empty></Card> : pick.map((r) => <TaskCard key={r.id} me={me} t={r} onChange={t.reload} />))}
    </div>
  );
}

function detailText(t: Task) {
  const d = t.detail ?? {};
  if (t.kind === 'behind_target') return `${d.achievement_pct}% of ${d.target} target cases done vs ${d.elapsed_pct}% of the month gone (working day ${d.working_day} of ${d.working_days}); pro-rata ${d.pro_rata}, actual ${d.actual}.`;
  if (t.kind === 'tat_mismatch') return `Reported pending ${d.reported}, expected ${d.expected} (previous ${d.previous}). Note given: ${d.note}`;
  return '';
}

export function TaskCard({ me, t, onChange }: { me: Me; t: Task; onChange: () => void }) {
  const isAdmin = me.roles.includes('admin');
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [prop, setProp] = useState({ rate: '', earns_on: 'entry', valid_from: me.today.slice(0, 8) + '01' });
  const [sal, setSal] = useState({ amount: '', from: me.today });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [act, setAct] = useState<any>(null);
  const ev = useLoad(() => (open ? select('task_events', 'action,note,data,at,persons(full_name)', (b) => b.eq('task_id', t.id).order('at')) : Promise.resolve([])), [open, t.updated_at]);
  const done = t.status === 'resolved';
  const [tone, stText] = ST[t.status] ?? ['neutral', label(t.status)];
  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErr(null);
    try { await fn(); setNote(''); onChange(); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const subjectId = async () => (await select('tasks', 'subject_id', (b) => b.eq('id', t.id)))[0]?.subject_id;
  return (
    <Card>
      <div className="stack" style={{ gap: 8 }}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <span className={`pill ${t.category === 'miss' ? 'bad' : 'info'}`}>{t.category === 'miss' ? 'Miss' : 'To-do'} · {KIND[t.kind] ?? label(t.kind)}</span>
          <span className={`pill ${tone}`}>{stText}</span>
          {t.condition_cleared && !done && <span className="pill ok">Back on track — can be resolved</span>}
          <span className="spacer" /><span className="small muted">{time(t.updated_at)}</span>
        </div>
        <b>{t.title}</b>
        {detailText(t) && <div className="small">{detailText(t)}</div>}
        <div className="small muted">{t.owner_name ? `Owner: ${t.owner_name}` : 'Owner: Admin'}{t.subject_name && t.subject_name !== t.owner_name ? ` · About: ${t.subject_name}` : ''}{t.last_note && t.last_action !== 'created' ? ` · Last: “${t.last_note}”` : ''}</div>
        {act && <ActivationBanner a={act} sender={me.full_name} onClose={() => setAct(null)} />}
        {!done && (
          <div className="stack" style={{ gap: 6 }}>
            {t.kind === 'onboarding' && <div className="row">
              <button className="btn sm primary" onClick={() => run(async () => setAct(await rpc('issue_activation', { p_person: await subjectId() })))}>Get onboarding message</button>
              <span className="small muted">Closes by itself once they sign in.</span></div>}
            {t.kind === 'add_team' && <div className="row"><Link className="btn sm primary" to="/team">Open My team → People</Link><span className="small muted">Add members one by one or with Bulk upload, then ask Admin to resolve.</span></div>}
            {t.kind === 'profile_incomplete' && <Link className="btn sm primary" to="/profile">Open my profile</Link>}
            {t.kind === 'salary_missing' && <div className="row">
              <input type="number" min={1} placeholder="Monthly gross ₹" value={sal.amount} onChange={(e) => setSal({ ...sal, amount: e.target.value })} style={{ width: 160 }} aria-label="Monthly gross" />
              <input type="date" value={sal.from} onChange={(e) => setSal({ ...sal, from: e.target.value })} style={{ width: 160 }} aria-label="Effective from" />
              <button className="btn sm primary" disabled={!sal.amount || busy} onClick={() => run(async () => rpc('set_salary', { p_person: await subjectId(), p_monthly_gross: Number(sal.amount), p_effective_from: sal.from, p_note: 'Entered from task' }).then(() => rpc('sync_tasks', { p_force: true })))}>Save salary</button></div>}
            {t.kind === 'missing_rate' && <div className="row">
              <input type="number" min={1} placeholder="Rate ₹ per case" value={prop.rate} onChange={(e) => setProp({ ...prop, rate: e.target.value })} style={{ width: 150 }} aria-label="Proposed rate" />
              <select value={prop.earns_on} onChange={(e) => setProp({ ...prop, earns_on: e.target.value })} aria-label="Earns on" style={{ width: 200 }}><option value="entry">Entered less cancelled</option><option value="closure">Closures only</option></select>
              <input type="date" value={prop.valid_from} onChange={(e) => setProp({ ...prop, valid_from: e.target.value })} style={{ width: 160 }} aria-label="Valid from" /></div>}
            <textarea rows={2} placeholder={t.kind === 'missing_rate' ? 'Basis for the rate (e.g. client rate letter dated …)' : t.category === 'miss' ? 'Reason for the miss and what was done about it' : 'Note'} value={note} onChange={(e) => setNote(e.target.value)} />
            <ErrorBox error={err} />
            <div className="row">
              {t.kind === 'missing_rate'
                ? <button className="btn sm primary" disabled={busy || !note.trim() || !prop.rate} onClick={() => run(() => rpc('task_request_resolution', { p_task: t.id, p_reason: note, p_proposal: { ...prop, rate: Number(prop.rate) } }))}>Propose rate to Admin</button>
                : <>
                  <button className="btn sm" disabled={busy || !note.trim()} onClick={() => run(() => rpc('task_reply', { p_task: t.id, p_note: note }))}>Reply</button>
                  {t.status !== 'resolution_requested' && <button className="btn sm primary" disabled={busy || !note.trim()} onClick={() => run(() => rpc('task_request_resolution', { p_task: t.id, p_reason: note }))}>Request resolution</button>}
                </>}
              {isAdmin && <>
                <span className="spacer" />
                <button className="btn sm primary" disabled={busy} onClick={() => run(() => rpc('admin_decide_task', { p_task: t.id, p_decision: 'resolve', p_note: note || null }))}>Resolve{t.kind === 'missing_rate' ? ' (creates the rate)' : ''}</button>
                <button className="btn sm" disabled={busy || !note.trim()} onClick={() => run(() => rpc('admin_decide_task', { p_task: t.id, p_decision: 'ask_info', p_note: note }))}>Ask for details</button>
                <button className="btn sm danger" disabled={busy || !note.trim()} onClick={() => run(() => rpc('admin_decide_task', { p_task: t.id, p_decision: 'deny', p_note: note }))}>Deny</button>
              </>}
            </div>
          </div>)}
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(!open)}>{open ? 'Hide history' : 'History'}</button>
        {open && (ev.loading ? <Loading rows={1} /> : <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>{(ev.data ?? []).map((e: any, i: number) => (
          <li key={i}><b>{label(e.action)}</b> · {e.persons?.full_name ?? 'System'} · {time(e.at)}{e.note ? ` — ${e.note}` : ''}{e.data?.rate ? ` (₹${e.data.rate}/case from ${e.data.valid_from})` : ''}</li>))}</ol>)}
      </div>
    </Card>
  );
}

/** Compact list for Home: the person's own open items first, then the team's misses. */
export function TaskStrip({ me }: { me: Me }) {
  const t = useTasks(me);
  if (!t.data) return null;
  const rows = t.data as Task[];
  const mine = rows.filter((r) => r.scope === 'mine' && r.status !== 'resolved');
  const team = rows.filter((r) => r.scope === 'team' && r.category === 'miss' && r.status !== 'resolved');
  const adm = rows.filter((r) => r.scope === 'admin' && r.status === 'resolution_requested');
  if (!mine.length && !team.length && !adm.length) return null;
  return (
    <Card title="Needs attention" action={<Link className="btn sm" to="/tasks">Open tasks</Link>}>
      <div className="stack" style={{ gap: 6 }}>
        {mine.slice(0, 5).map((r) => <div key={r.id} className="row small"><span className={`pill ${r.category === 'miss' ? 'bad' : 'info'}`}>{r.category === 'miss' ? 'Miss' : 'To-do'}</span>{r.title}</div>)}
        {mine.length > 5 && <div className="small muted">+{mine.length - 5} more of yours</div>}
        {team.length > 0 && <div className="small"><b>{team.length}</b> open miss(es) in your team — {[...new Set(team.map((r) => r.owner_name))].slice(0, 6).join(', ')}</div>}
        {adm.length > 0 && <div className="small"><b>{adm.length}</b> resolution request(s) waiting for Admin</div>}
      </div>
    </Card>
  );
}
