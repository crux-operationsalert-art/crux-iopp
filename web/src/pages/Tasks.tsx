import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Me, rpc, select } from '../lib/api';
import { ROLE_NAMES } from '../lib/messages';
import { Certify } from './Certify';
import { ProfileForm } from './Onboard';
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
  const [open, setOpen] = useState(false);
  const [fix, setFix] = useState(false);
  const ev = useLoad(() => (open ? select('task_events', 'action,note,data,at,persons(full_name)', (b) => b.eq('task_id', t.id).order('at')) : Promise.resolve([])), [open, t.updated_at]);
  const done = t.status === 'resolved';
  const [tone, stText] = ST[t.status] ?? ['neutral', label(t.status)];
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
        <div className="row">
          {!done && <button className="btn primary" onClick={() => setFix(true)}>{FIX_LABEL[t.kind] ?? 'Resolve'}</button>}
          <button className="btn sm" onClick={() => setOpen(!open)}>{open ? 'Hide history' : 'History'}</button>
        </div>
        {open && (ev.loading ? <Loading rows={1} /> : <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>{(ev.data ?? []).map((e: any, i: number) => (
          <li key={i}><b>{label(e.action)}</b> · {e.persons?.full_name ?? 'System'} · {time(e.at)}{e.note ? ` — ${e.note}` : ''}{e.data?.rate ? ` (₹${e.data.rate}/case from ${e.data.valid_from})` : ''}</li>))}</ol>)}
      </div>
      {fix && <Modal title={t.title} onClose={() => setFix(false)}><Resolver me={me} t={t} onDone={() => { setFix(false); onChange(); }} /></Modal>}
    </Card>
  );
}

const FIX_LABEL: Record<string, string> = {
  onboarding: 'Send onboarding message', add_team: 'Add team members', profile_incomplete: 'Complete profile', salary_missing: 'Enter salary',
  missing_rate: 'Enter rate', uncertified_team: 'Certify team', missed_submission: 'Resolve', collections_missing: 'Resolve', behind_target: 'Give reason', tat_mismatch: 'Give reason',
};

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal stack" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row" style={{ alignItems: 'flex-start' }}><b style={{ flex: 1 }}>{title}</b><button className="btn sm" onClick={onClose} aria-label="Close">✕</button></div>
        {children}
      </div>
    </div>
  );
}

/** Everything needed to clear one task, in one pop-up: the fix itself, then the reason / request to Admin, or Admin's decision. */
function Resolver({ me, t, onDone }: { me: Me; t: Task; onDone: () => void }) {
  const isAdmin = me.roles.includes('admin');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState('');
  const [act, setAct] = useState<any>(null);
  const [rate, setRate] = useState({ rate: '', earns_on: 'entry', valid_from: me.today.slice(0, 8) + '01' });
  const [sal, setSal] = useState({ amount: '', from: me.today });
  const [nm, setNm] = useState({ name: '', mobile: '', role: 'executive' });
  const sid = useLoad(() => select('tasks', 'subject_id', (b) => b.eq('id', t.id)).then((r: any[]) => r[0]?.subject_id ?? null), [t.id]);
  const subject = sid.data as string | null;
  const status = useLoad(() => t.kind === 'uncertified_team' && t.ref_date ? rpc<any[]>('team_status', { p_work_date: t.ref_date }) : Promise.resolve([]), [t.id]);
  const run = async (fn: () => Promise<unknown>, msg = '', close = false) => {
    setBusy(true); setErr(null); setOk('');
    try { await fn(); setOk(msg); if (close) onDone(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const request = (reason: string, proposal?: unknown) => rpc('task_request_resolution', { p_task: t.id, p_reason: reason, p_proposal: proposal ?? null });
  const decide = (d: 'resolve' | 'ask_info' | 'deny') => run(() => rpc('admin_decide_task', { p_task: t.id, p_decision: d, p_note: note || null }), '', true);
  const fixedThen = async (reason: string) => { await rpc('sync_tasks', { p_force: true }); if (isAdmin) await rpc('admin_decide_task', { p_task: t.id, p_decision: 'resolve', p_note: reason }).catch(() => null); };

  return (
    <div className="stack">
      {detailText(t) && <div className="small">{detailText(t)}</div>}

      {t.kind === 'onboarding' && <div className="stack">
        <p className="small muted">Send this person their login ID and one-time activation code. The task closes by itself when they sign in.</p>
        <button className="btn primary" disabled={busy || !subject} onClick={() => run(async () => setAct(await rpc('issue_activation', { p_person: subject })))}>Create onboarding message</button>
        {act && <ActivationBanner a={act} sender={me.full_name} onClose={() => setAct(null)} />}</div>}

      {t.kind === 'add_team' && <div className="stack">
        <p className="small muted">Add a team member here (they report to you). For many people use My team → People → Bulk upload. Request resolution when your team is complete.</p>
        <div className="grid two">
          <label className="field">Full name<input value={nm.name} onChange={(e) => setNm({ ...nm, name: e.target.value })} /></label>
          <label className="field">Mobile number<input inputMode="tel" value={nm.mobile} onChange={(e) => setNm({ ...nm, mobile: e.target.value })} /></label>
          <label className="field">Role<select value={nm.role} onChange={(e) => setNm({ ...nm, role: e.target.value })}>{['executive', 'manager', 'ba', 'bm'].map((r) => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}</select></label>
        </div>
        <button className="btn primary" disabled={busy || !nm.name.trim() || nm.mobile.replace(/\D/g, '').length < 10} onClick={() => run(async () => {
          const p = await rpc('create_team_member', { p_full_name: nm.name.trim(), p_email: null, p_mobile: nm.mobile.replace(/\D/g, '').slice(-10), p_resource_type: nm.role === 'ba' ? 'partner' : 'own_employee',
            p_designation: ROLE_NAMES[nm.role], p_role: nm.role, p_manager_id: me.person_id, p_function: 'operations', p_zone_id: null, p_branch_id: null });
          setAct(await rpc('issue_activation', { p_person: p.id })); setNm({ name: '', mobile: '', role: 'executive' });
        }, 'Added. Send them the message below; they choose their clients in My day.')}>Add and create onboarding message</button>
        {act && <ActivationBanner a={act} sender={me.full_name} onClose={() => setAct(null)} />}</div>}

      {t.kind === 'profile_incomplete' && (subject === me.person_id
        ? <ProfileForm me={me} embedded onDone={() => run(() => fixedThen('Profile completed'), 'Profile saved.', true)} />
        : <p className="small muted">This person completes their own profile at their next sign-in (the app does not let them in until it is complete). You can remind them, or reply below.</p>)}

      {t.kind === 'salary_missing' && <div className="row" style={{ alignItems: 'end' }}>
        <label className="field">Monthly gross ₹<input type="number" min={1} value={sal.amount} onChange={(e) => setSal({ ...sal, amount: e.target.value })} /></label>
        <label className="field">Effective from<input type="date" value={sal.from} onChange={(e) => setSal({ ...sal, from: e.target.value })} /></label>
        <button className="btn primary" disabled={!sal.amount || busy || !subject} onClick={() => run(async () => {
          await rpc('set_salary', { p_person: subject, p_monthly_gross: Number(sal.amount), p_effective_from: sal.from, p_note: 'Entered from task' }); await fixedThen('Salary entered'); }, 'Salary saved.', true)}>Save salary</button></div>}

      {t.kind === 'missing_rate' && <div className="stack">
        <div className="row" style={{ alignItems: 'end' }}>
          <label className="field">Rate ₹ per case<input type="number" min={1} value={rate.rate} onChange={(e) => setRate({ ...rate, rate: e.target.value })} /></label>
          <label className="field">Earns on<select value={rate.earns_on} onChange={(e) => setRate({ ...rate, earns_on: e.target.value })}><option value="entry">Entered less cancelled</option><option value="closure">Closures only</option></select></label>
          <label className="field">Valid from<input type="date" value={rate.valid_from} onChange={(e) => setRate({ ...rate, valid_from: e.target.value })} /></label></div>
        <label className="field">Basis (e.g. client rate letter dated …)<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <button className="btn primary" disabled={busy || !rate.rate || !note.trim()} onClick={() => run(async () => {
          await request(note, { ...rate, rate: Number(rate.rate) });
          if (isAdmin) await rpc('admin_decide_task', { p_task: t.id, p_decision: 'resolve', p_note: note }); }, '', true)}>{isAdmin ? 'Save rate' : 'Send rate to Admin for approval'}</button></div>}

      {t.kind === 'uncertified_team' && t.ref_date && (status.loading ? <Loading rows={2} /> :
        <Certify me={me} date={t.ref_date} fn="operations" blockers={(status.data ?? []).filter((x: any) => !x.resolved)} onDone={() => run(() => fixedThen('Team certified'), 'Certified.', true)} />)}

      {(t.kind === 'missed_submission' || t.kind === 'collections_missing') && isAdmin && subject && t.ref_date && (
        <div className="row"><button className="btn" disabled={busy} onClick={() => run(() => rpc('grant_reopen_many', { p_persons: [subject], p_branches: [], p_from: t.ref_date, p_to: t.ref_date,
          p_reason: note || 'Reopened from task', p_expires_at: new Date(Date.now() + 864e5).toISOString() }), `Reopened ${t.ref_date} for 24 hours — they can enter it in My day now.`)}>Reopen {t.ref_date} for them (24 h)</button></div>)}
      {(t.kind === 'missed_submission' || t.kind === 'collections_missing') && !isAdmin && t.ref_date && (
        <p className="small muted">If Admin reopens {t.ref_date}, enter the figures from <Link to={`/productivity?date=${t.ref_date}`}>My day</Link>. Otherwise give the reason below and ask Admin to resolve.</p>)}

      {!['missing_rate', 'salary_missing'].includes(t.kind) && <>
        <label className="field">{t.category === 'miss' ? 'Reason for the miss and what was done' : 'Note'}<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <div className="row">
          <button className="btn" disabled={busy || !note.trim()} onClick={() => run(() => rpc('task_reply', { p_task: t.id, p_note: note }), 'Reply saved.', true)}>Save reason</button>
          {!isAdmin && t.status !== 'resolution_requested' && <button className="btn primary" disabled={busy || !note.trim()} onClick={() => run(() => request(note), '', true)}>Ask Admin to mark resolved</button>}
        </div></>}

      {isAdmin && <div className="row" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <b className="small">Admin decision</b><span className="spacer" />
        <button className="btn primary" disabled={busy} onClick={() => decide('resolve')}>Resolve now</button>
        <button className="btn" disabled={busy || !note.trim()} onClick={() => decide('ask_info')}>Ask for details</button>
        <button className="btn danger" disabled={busy || !note.trim()} onClick={() => decide('deny')}>Deny</button></div>}
      <ErrorBox error={err} />{ok && <div className="banner ok" role="status">{ok}</div>}
    </div>
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
