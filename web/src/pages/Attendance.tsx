import { useState } from 'react';
import { Me, rpc, select } from '../lib/api';
import { label, monthStart, nice, time } from '../lib/format';
import { Card, Empty, ErrorBox, Kpi, Loading, Tabs, useLoad } from '../components/ui';

export type B = { person_id: string; full_name: string; is_direct: boolean; scheduled: number; present: number; half_day: number; absent: number;
  planned_leave: number; unplanned_leave: number; pending: number; unconfirmed: number; shrinkage_pct: number | null; unplanned_streak: number;
  day_status: string; day_category: string; day_sub: string; day_confirmed: boolean; day_basis: string; day_reason: string | null };

// Category → sub-category → stored status (what a manager confirms).
export const CATS: Record<string, [string, string][]> = {
  Present: [['present', 'Full day'], ['half_day', 'Half day'], ['sunday_work', 'Sunday / holiday work']],
  Absent: [['planned_leave', 'Planned leave'], ['unplanned_leave', 'Unplanned leave'], ['absent', 'No show (not informed)']],
  Off: [['weekly_off', 'Weekly off'], ['holiday', 'Holiday']],
};
const tone = (c: string) => (c === 'Present' ? 'ok' : c === 'Absent' ? 'bad' : c === 'Off' ? 'info' : 'warn');

/** Today's attendance for the signed-in person — marked automatically from reporting (no check-in). */
export function MyAttendance({ me, compact }: { me: Me; compact?: boolean }) {
  const d = useLoad(() => rpc<B[]>('attendance_board', { p_from: me.today, p_to: me.today }), []);
  const a = d.data?.[0];
  const body = a ? (
    <div className="row">
      <span className={`pill ${tone(a.day_category)}`}>{a.day_category === 'Not reported yet' ? 'Not reported yet' : `${a.day_category} · ${a.day_sub}`}</span>
      <span className="small muted">{a.day_confirmed ? `Confirmed by your manager${a.day_reason ? `: ${a.day_reason}` : ''}`
        : a.day_category === 'Not reported yet' ? 'You are marked present automatically when you submit today\'s figures.' : 'Marked automatically from your reporting; your manager confirms it.'}</span>
    </div>) : null;
  if (compact) return <div className="stack"><b className="small">Attendance today</b>{d.loading ? <Loading rows={1} /> : body}<ErrorBox error={d.error} /></div>;
  return <Card title={`Today · ${nice(me.today)}`}>{d.loading ? <Loading rows={1} /> : body}<ErrorBox error={d.error} /></Card>;
}

export default function Attendance({ me }: { me: Me }) {
  const manages = me.manages_operations || me.manages_collections;
  const [tab, setTab] = useState<'team' | 'me'>(manages ? 'team' : 'me');
  return (
    <div className="stack">
      <div className="topbar"><div><h1>Attendance & leave</h1><div className="muted">No check-in needed: submitting the day's figures marks a person present; no report by the deadline marks them absent. Managers confirm the category.</div></div></div>
      {manages && <Tabs tabs={[['team', "My team"], ['me', 'Me']]} value={tab} onChange={setTab} />}
      {tab === 'me' ? <Mine me={me} /> : <TeamAtt me={me} />}
    </div>
  );
}

function Mine({ me }: { me: Me }) {
  const from = monthStart(me.today);
  const sum = useLoad(() => rpc<B[]>('attendance_board', { p_from: from, p_to: me.today }), []);
  const leaves = useLoad(() => select('leave_requests', '*', (b) => b.eq('person_id', me.person_id).order('from_date', { ascending: false }).limit(20)), []);
  const s = sum.data?.[0];
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
        <Kpi label="Present this month" value={`${s.present}/${s.scheduled}`} sub={`${s.half_day} half day(s)`} />
        <Kpi label="Leave" value={s.planned_leave + s.unplanned_leave} sub={`${s.planned_leave} planned · ${s.unplanned_leave} unplanned`} />
        <Kpi label="Absent" value={s.absent} sub={s.pending ? `${s.pending} day(s) still open for reporting` : ''} />
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
  const [date, setDate] = useState(me.today);
  const day = useLoad(() => rpc<B[]>('attendance_board', { p_from: date, p_to: date, p_manager: me.person_id }), [date]);
  const month = useLoad(() => rpc<B[]>('attendance_board', { p_from: monthStart(date), p_to: date, p_manager: me.person_id }), [date]);
  const pend = useLoad(() => select('leave_requests', 'id,person_id,from_date,to_date,leave_type,category,reason,short_notice,created_at,persons!leave_requests_person_id_fkey(full_name)',
    (b) => b.eq('status', 'pending').neq('person_id', me.person_id).order('from_date')), []);
  const [edit, setEdit] = useState<Record<string, { status: string; reason: string }>>({});
  const [err, setErr] = useState<unknown>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const rows = day.data ?? [];
  const count = (c: string) => rows.filter((r) => r.day_category === c).length;
  const toConfirm = rows.filter((r) => r.is_direct && !r.day_confirmed && r.day_category !== 'Not reported yet' && r.day_category !== 'Off');
  async function confirm(r: B, status: string, reason: string) {
    await rpc('set_attendance', { p_person: r.person_id, p_date: date, p_status: status, p_reason: reason || 'Confirmed as reported' });
  }
  async function saveOne(r: B) {
    const e = edit[r.person_id]; setErr(null);
    try { await confirm(r, e?.status ?? r.day_status, e?.reason ?? ''); setEdit((x) => { const n = { ...x }; delete n[r.person_id]; return n; }); day.reload(); month.reload(); }
    catch (x) { setErr(x); }
  }
  async function confirmAll() {
    setBusy(true); setErr(null);
    try { for (const r of toConfirm) await confirm(r, r.day_status, 'Confirmed as reported'); day.reload(); month.reload(); }
    catch (x) { setErr(x); } finally { setBusy(false); }
  }
  async function decide(id: string, ok: boolean) {
    setErr(null);
    try { await rpc('decide_leave', { p_id: id, p_approve: ok, p_note: note[id] || (ok ? 'Approved' : null) }); pend.reload(); day.reload(); month.reload(); } catch (e) { setErr(e); }
  }
  const m = month.data ?? [];
  const t = m.reduce((a, r) => ({ sch: a.sch + r.scheduled - r.pending, lost: a.lost + r.absent + r.planned_leave + r.unplanned_leave + r.half_day / 2 }), { sch: 0, lost: 0 });
  return (
    <div className="stack">
      <div className="row"><label className="field">Date<input type="date" value={date} max={me.today} onChange={(e) => e.target.value && setDate(e.target.value)} /></label></div>
      <div className="grid kpis">
        <Kpi label="Present" value={`${count('Present')}/${rows.length}`} sub={nice(date)} />
        <Kpi label="Absent / on leave" value={count('Absent')} sub={`${count('Not reported yet')} not reported yet`} />
        <Kpi label="Team shrinkage this month" value={t.sch ? `${(t.lost / t.sch * 100).toFixed(1)}%` : '—'} />
        <Kpi label="Unplanned > 3 days in a row" value={m.filter((r) => r.unplanned_streak > 3).length} sub="HR follow-up needed" />
      </div>
      <ErrorBox error={err} />
      {(pend.data?.length ?? 0) > 0 && <Card title="Leave requests waiting for you">
        <div className="tablewrap"><table><tbody>{pend.data!.map((l: any) => (
          <tr key={l.id}><td><b>{l.persons?.full_name}</b><div className="small muted">asked {time(l.created_at)}</div></td>
            <td>{nice(l.from_date)}{l.to_date !== l.from_date ? ` – ${nice(l.to_date)}` : ''}<div className="small muted">{label(l.leave_type)} · {label(l.category)}{l.short_notice ? ' · short notice' : ''}</div></td>
            <td className="small">{l.reason}</td>
            <td><input placeholder="Note (needed to reject)" value={note[l.id] ?? ''} onChange={(e) => setNote({ ...note, [l.id]: e.target.value })} /></td>
            <td><div className="row"><button className="btn sm primary" onClick={() => decide(l.id, true)}>Approve</button><button className="btn sm" onClick={() => decide(l.id, false)}>Reject</button></div></td></tr>))}</tbody></table></div>
      </Card>}
      <Card title={`Attendance · ${nice(date)}`} action={toConfirm.length > 0 && <button className="btn primary sm" disabled={busy} onClick={confirmAll}>{busy ? 'Confirming…' : `Confirm ${toConfirm.length} as shown`}</button>}>
        {day.loading ? <Loading rows={3} /> : <ErrorBox error={day.error} retry={day.reload} />}
        {day.data && (rows.length === 0 ? <Empty>No team members.</Empty> : <div className="tablewrap"><table>
          <thead><tr><th>Person</th><th>Category</th><th>Sub-category</th><th>Basis</th><th></th></tr></thead>
          <tbody>{rows.map((r) => {
            const e = edit[r.person_id];
            const cat = e ? Object.keys(CATS).find((c) => CATS[c].some(([s]) => s === e.status)) ?? 'Present' : r.day_category;
            return (
              <tr key={r.person_id}>
                <td><b>{r.full_name}</b>{!r.is_direct && <div className="small muted">in a sub-team</div>}</td>
                <td>{e ? <select value={cat} onChange={(x) => setEdit({ ...edit, [r.person_id]: { ...e, status: CATS[x.target.value][0][0] } })}>{Object.keys(CATS).map((c) => <option key={c}>{c}</option>)}</select>
                  : <span className={`pill ${tone(r.day_category)}`}>{r.day_category}</span>}</td>
                <td>{e ? <select value={e.status} onChange={(x) => setEdit({ ...edit, [r.person_id]: { ...e, status: x.target.value } })}>{(CATS[cat] ?? []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  : r.day_sub}</td>
                <td className="small">{e ? <input placeholder="Reason (optional when confirming)" value={e.reason} onChange={(x) => setEdit({ ...edit, [r.person_id]: { ...e, reason: x.target.value } })} />
                  : <>{r.day_basis}{r.day_reason && r.day_confirmed ? <div className="muted">{r.day_reason}</div> : null}</>}</td>
                <td><div className="row" style={{ justifyContent: 'flex-end' }}>{r.is_direct && (e
                  ? <><button className="btn sm primary" onClick={() => saveOne(r)}>Save</button><button className="btn sm" onClick={() => setEdit((x) => { const n = { ...x }; delete n[r.person_id]; return n; })}>Cancel</button></>
                  : <>{!r.day_confirmed && r.day_category !== 'Not reported yet' && r.day_category !== 'Off' && <button className="btn sm" onClick={() => saveOne(r)}>Confirm</button>}
                      <button className="btn sm" onClick={() => setEdit({ ...edit, [r.person_id]: { status: r.day_category === 'Not reported yet' ? 'present' : r.day_status, reason: '' } })}>Change</button></>)}</div></td>
              </tr>);
          })}</tbody></table></div>)}
        <p className="small muted">Auto rule: figures submitted (or the team certified) = Present · Full day; nothing by the 10:00 next-morning deadline = Absent · No show. Change it to half day, planned or unplanned leave, etc. Only the direct manager (or HR/Admin) can confirm.</p>
      </Card>
      <Card title={`Month to date (${nice(monthStart(date))} – ${nice(date)})`}>
        {month.loading ? <Loading rows={2} /> : month.data && <div className="tablewrap"><table>
          <thead><tr><th>Person</th><th className="num">Present</th><th className="num">Half</th><th className="num">Absent</th><th className="num">Leave P/U</th><th className="num">Awaiting confirmation</th><th className="num">Shrinkage</th></tr></thead>
          <tbody>{m.map((r) => <tr key={r.person_id}><td><b>{r.full_name}</b>{r.unplanned_streak > 3 && <div><span className="pill bad">{r.unplanned_streak} working days unplanned in a row</span></div>}</td>
            <td className="num">{r.present}</td><td className="num">{r.half_day}</td><td className="num">{r.absent}</td><td className="num">{r.planned_leave}/{r.unplanned_leave}</td>
            <td className="num">{r.unconfirmed}</td><td className="num">{r.shrinkage_pct == null ? '—' : `${r.shrinkage_pct}%`}</td></tr>)}</tbody></table></div>}
      </Card>
    </div>
  );
}
