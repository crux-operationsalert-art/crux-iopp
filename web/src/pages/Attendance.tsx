import { useState } from 'react';
import { Me, rpc, select } from '../lib/api';
import { label, monthStart, nice, time } from '../lib/format';
import { Card, Empty, ErrorBox, Kpi, Loading, Tabs, useLoad } from '../components/ui';

type S = { person_id: string; full_name: string; scheduled: number; present: number; late: number; half_day: number; early_leave: number;
  absent: number; planned_leave: number; unplanned_leave: number; not_marked: number; shrinkage_pct: number | null;
  unplanned_streak: number; today_status: string | null; today_in: string | null; today_out: string | null };
const hm = (s?: string | null) => (s ? new Date(s).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : '—');
const STATUSES = ['present', 'late', 'half_day', 'early_leave', 'absent', 'planned_leave', 'unplanned_leave', 'weekly_off', 'holiday', 'sunday_work'];
const tone = (s?: string | null) => !s ? 'neutral' : ['present', 'sunday_work'].includes(s) ? 'ok' : ['late', 'half_day', 'early_leave'].includes(s) ? 'warn'
  : ['absent', 'unplanned_leave'].includes(s) ? 'bad' : 'info';

/** My attendance card — also embedded at the top of My day. */
export function MyAttendance({ me, compact }: { me: Me; compact?: boolean }) {
  const d = useLoad(() => select('attendance', '*', (b) => b.eq('person_id', me.person_id).eq('work_date', me.today)), []);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const a: any = d.data?.[0];
  async function go(fn: 'check_in' | 'check_out') {
    setBusy(true); setErr(null);
    try { await rpc(fn); d.reload(); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const body = (
    <div className="row">
      <span className={`pill ${tone(a?.status)}`}>{a ? label(a.status) : 'Not checked in'}</span>
      {a?.check_in && <span className="small muted">In {hm(a.check_in)}{a.minutes_late > 0 ? ` (${a.minutes_late} min after start)` : ''}{a.check_out ? ` · Out ${hm(a.check_out)}` : ''}</span>}
      <span className="spacer" />
      {!a?.check_in && !['planned_leave', 'unplanned_leave', 'holiday', 'weekly_off'].includes(a?.status) && <button className="btn primary sm" disabled={busy} onClick={() => go('check_in')}>Check in</button>}
      {a?.check_in && !a?.check_out && <button className="btn sm" disabled={busy} onClick={() => go('check_out')}>Check out</button>}
      {a?.reason && a.source !== 'self' && <span className="small muted">Marked by manager: {a.reason}</span>}
    </div>);
  if (compact) return <div className="stack"><b className="small">Attendance today</b>{d.loading ? <Loading rows={1} /> : body}<ErrorBox error={err ?? d.error} /></div>;
  return <Card title={`Today · ${nice(me.today)}`}>{d.loading ? <Loading rows={1} /> : body}<ErrorBox error={err ?? d.error} /></Card>;
}

export default function Attendance({ me }: { me: Me }) {
  const manages = me.manages_operations || me.manages_collections;
  const [tab, setTab] = useState<'me' | 'team'>('me');
  return (
    <div className="stack">
      <div className="topbar"><div><h1>Attendance & leave</h1><div className="muted">Check in when you start, check out when you leave. Shift and grace times are set by HR.</div></div></div>
      {manages && <Tabs tabs={[['me', 'Me'], ['team', 'My team']]} value={tab} onChange={setTab} />}
      {tab === 'me' ? <Mine me={me} /> : <TeamAtt me={me} />}
    </div>
  );
}

function Mine({ me }: { me: Me }) {
  const from = monthStart(me.today);
  const sum = useLoad(() => rpc<S[]>('attendance_summary', { p_from: from, p_to: me.today }), []);
  const leaves = useLoad(() => select('leave_requests', '*', (b) => b.eq('person_id', me.person_id).order('from_date', { ascending: false }).limit(20)), []);
  const s = sum.data?.find((x) => x.person_id === me.person_id);
  const [f, setF] = useState({ from: me.today, to: me.today, type: 'planned', category: 'personal', reason: '' });
  const [err, setErr] = useState<unknown>(null);
  const [ok, setOk] = useState('');
  async function req() {
    setErr(null); setOk('');
    try { const l = await rpc('request_leave', { p_from: f.from, p_to: f.to, p_type: f.type, p_category: f.category, p_reason: f.reason });
      setOk(`Leave requested${l.short_notice ? ' (short notice — less than 7 days ahead)' : ''}. Your manager has been notified.`); setF({ ...f, reason: '' }); leaves.reload(); }
    catch (e) { setErr(e); }
  }
  return (
    <div className="stack">
      <MyAttendance me={me} />
      {sum.loading ? <Loading rows={1} /> : <ErrorBox error={sum.error} />}
      {s && <div className="grid kpis">
        <Kpi label="Present this month" value={`${s.present + s.late}/${s.scheduled}`} sub={`${s.late} late · ${s.half_day} half day`} />
        <Kpi label="Leave" value={s.planned_leave + s.unplanned_leave} sub={`${s.planned_leave} planned · ${s.unplanned_leave} unplanned`} />
        <Kpi label="Absent / not marked" value={`${s.absent} / ${s.not_marked}`} />
        <Kpi label="MTD shrinkage" value={s.shrinkage_pct == null ? '—' : `${s.shrinkage_pct}%`} sub="(absent + leave + ½ half days) ÷ working days" />
      </div>}
      <Card title="Request leave">
        <div className="stack">
          <div className="grid two">
            <label className="field">From<input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, to: e.target.value > f.to ? e.target.value : f.to })} /></label>
            <label className="field">To<input type="date" value={f.to} min={f.from} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
            <label className="field">Type<select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="planned">Planned (applied in advance)</option><option value="unplanned">Unplanned (sudden / already taken)</option></select></label>
            <label className="field">Category<select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{['personal', 'sick', 'emergency', 'natural_calamity', 'other'].map((c) => <option key={c} value={c}>{label(c)}</option>)}</select></label>
          </div>
          <label className="field">Reason<input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
          <ErrorBox error={err} />{ok && <div className="banner ok">{ok}</div>}
          <div><button className="btn primary" disabled={!f.reason.trim()} onClick={req}>Request leave</button></div>
          <p className="small muted">No leave balances are shown until HR provides the leave policy. Sundays and holidays inside the range are not counted.</p>
        </div>
      </Card>
      <Card title="My leave requests">
        {leaves.data && (leaves.data.length === 0 ? <Empty>No requests.</Empty> : <div className="tablewrap"><table><tbody>{leaves.data.map((l: any) => (
          <tr key={l.id}><td>{nice(l.from_date)}{l.to_date !== l.from_date ? ` – ${nice(l.to_date)}` : ''}</td><td>{label(l.leave_type)} · {label(l.category)}</td><td className="small">{l.reason}</td>
            <td><span className={`pill ${l.status === 'approved' ? 'ok' : l.status === 'rejected' ? 'bad' : l.status === 'pending' ? 'warn' : 'neutral'}`}>{label(l.status)}</span>{l.decision_note && <div className="small muted">{l.decision_note}</div>}</td>
            <td>{l.status === 'pending' && <button className="btn sm" onClick={async () => { try { await rpc('cancel_leave', { p_id: l.id }); leaves.reload(); } catch (e) { setErr(e); } }}>Cancel</button>}</td></tr>))}</tbody></table></div>)}
      </Card>
    </div>
  );
}

function TeamAtt({ me }: { me: Me }) {
  const [from, setFrom] = useState(monthStart(me.today));
  const [to, setTo] = useState(me.today);
  const sum = useLoad(() => rpc<S[]>('attendance_summary', { p_from: from, p_to: to, p_manager: me.person_id }), [from, to]);
  const pend = useLoad(() => select('leave_requests', 'id,person_id,from_date,to_date,leave_type,category,reason,short_notice,created_at,persons!leave_requests_person_id_fkey(full_name)',
    (b) => b.eq('status', 'pending').neq('person_id', me.person_id).order('from_date')), []);
  const [mark, setMark] = useState<S | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const rows = sum.data ?? [];
  const t = rows.reduce((a, r) => ({ sch: a.sch + r.scheduled, lost: a.lost + r.absent + r.planned_leave + r.unplanned_leave + r.half_day / 2 }), { sch: 0, lost: 0 });
  const todayIn = rows.filter((r) => ['present', 'late', 'half_day', 'early_leave', 'sunday_work'].includes(r.today_status ?? '')).length;
  async function decide(id: string, ok: boolean) {
    setErr(null);
    try { await rpc('decide_leave', { p_id: id, p_approve: ok, p_note: note[id] || (ok ? 'Approved' : null) }); pend.reload(); sum.reload(); } catch (e) { setErr(e); }
  }
  return (
    <div className="stack">
      <div className="row"><label className="field">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field">To<input type="date" value={to} max={me.today} onChange={(e) => setTo(e.target.value)} /></label></div>
      <div className="grid kpis">
        <Kpi label="In today" value={`${todayIn}/${rows.length}`} />
        <Kpi label="Team shrinkage" value={t.sch ? `${(t.lost / t.sch * 100).toFixed(1)}%` : '—'} sub={`${nice(from)} – ${nice(to)}`} />
        <Kpi label="Unplanned streak > 3 days" value={rows.filter((r) => r.unplanned_streak > 3).length} sub="HR follow-up needed" />
        <Kpi label="Leave to decide" value={pend.data?.length ?? '…'} />
      </div>
      <ErrorBox error={err} />
      {(pend.data?.length ?? 0) > 0 && <Card title="Leave requests waiting for you">
        <div className="tablewrap"><table><tbody>{pend.data!.map((l: any) => (
          <tr key={l.id}><td><b>{l.persons?.full_name}</b><div className="small muted">asked {time(l.created_at)}</div></td>
            <td>{nice(l.from_date)}{l.to_date !== l.from_date ? ` – ${nice(l.to_date)}` : ''}<div className="small muted">{label(l.leave_type)} · {label(l.category)}{l.short_notice ? ' · short notice' : ''}</div></td>
            <td className="small">{l.reason}</td>
            <td><input placeholder="Note (needed to reject)" value={note[l.id] ?? ''} onChange={(e) => setNote({ ...note, [l.id]: e.target.value })} /></td>
            <td><div className="row"><button className="btn sm primary" onClick={() => decide(l.id, true)}>Approve</button><button className="btn sm" onClick={() => decide(l.id, false)}>Reject</button></div></td></tr>))}</tbody></table></div>
        <p className="small muted">Only the person's direct manager (or HR/Admin) can decide. Approving marks the working days as leave.</p>
      </Card>}
      {mark && <MarkPanel me={me} p={mark} onDone={() => { setMark(null); sum.reload(); }} />}
      <Card title="Team attendance">
        {sum.loading ? <Loading rows={3} /> : <ErrorBox error={sum.error} retry={sum.reload} />}
        {sum.data && (rows.length === 0 ? <Empty>No team members.</Empty> : <div className="tablewrap"><table>
          <thead><tr><th>Person</th><th>Today</th><th className="num">Present</th><th className="num">Late</th><th className="num">Half</th><th className="num">Absent</th><th className="num">Leave P/U</th><th className="num">Not marked</th><th className="num">Shrinkage</th><th></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.person_id}><td><b>{r.full_name}</b>{r.unplanned_streak > 3 && <div><span className="pill bad">{r.unplanned_streak} working days unplanned in a row</span></div>}</td>
              <td><span className={`pill ${tone(r.today_status)}`}>{r.today_status ? label(r.today_status) : 'Not marked'}</span><div className="small muted">{r.today_in ? `${hm(r.today_in)}${r.today_out ? '–' + hm(r.today_out) : ''}` : ''}</div></td>
              <td className="num">{r.present}</td><td className="num">{r.late}</td><td className="num">{r.half_day}</td><td className="num">{r.absent}</td>
              <td className="num">{r.planned_leave}/{r.unplanned_leave}</td><td className="num">{r.not_marked}</td><td className="num">{r.shrinkage_pct == null ? '—' : `${r.shrinkage_pct}%`}</td>
              <td><button className="btn sm" onClick={() => setMark(r)}>Mark</button></td></tr>))}</tbody></table></div>)}
        <p className="small muted">Working days exclude Sundays and holidays. Shrinkage = (absent + leave + ½ half days) ÷ working days.</p>
      </Card>
    </div>
  );
}

function MarkPanel({ me, p, onDone }: { me: Me; p: S; onDone: () => void }) {
  const [date, setDate] = useState(me.today);
  const [status, setStatus] = useState('absent');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<unknown>(null);
  async function go() {
    setErr(null);
    try { await rpc('set_attendance', { p_person: p.person_id, p_date: date, p_status: status, p_reason: reason }); onDone(); } catch (e) { setErr(e); }
  }
  return (
    <Card title={`Mark attendance for ${p.full_name}`}>
      <div className="stack">
        <div className="grid two">
          <label className="field">Date<input type="date" value={date} max={me.today} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field">Status<select value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></label>
        </div>
        <label className="field">Reason (required — recorded with your name)<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <ErrorBox error={err} />
        <div className="row"><button className="btn primary" disabled={!reason.trim()} onClick={go}>Save</button><button className="btn" onClick={onDone}>Cancel</button></div>
        <p className="small muted">You can mark your direct reports for up to 31 days back; older corrections go through HR.</p>
      </div>
    </Card>
  );
}
