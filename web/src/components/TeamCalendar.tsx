import { useMemo, useState } from 'react';
import { Me, rpc } from '../lib/api';
import { label, nice } from '../lib/format';
import { Card, Empty, ErrorBox, Loading, useLoad } from './ui';

type Cell = { person_id: string; full_name: string; designation: string | null; work_date: string; status: string; final: boolean; source: string | null; reason: string | null; auto: string };
const CODE: Record<string, [string, string]> = {
  present: ['P', 'ok'], late: ['L', 'ok'], early_leave: ['E', 'ok'], half_day: ['½', 'warn'], absent: ['A', 'bad'], unplanned_leave: ['UL', 'bad'], planned_leave: ['PL', 'info'],
  weekly_off: ['WO', 'neutral'], holiday: ['H', 'neutral'], sunday_work: ['SW', 'info'], pending: ['…', 'neutral'],
};
const OPTIONS = ['present', 'half_day', 'absent', 'planned_leave', 'unplanned_leave', 'late', 'early_leave', 'weekly_off', 'holiday', 'sunday_work'];

/** Month calendar of the team's attendance. Each day starts auto-marked from the daily report (P when figures were
 *  submitted, A when not); the manager confirms the day at end of day, and any change needs a reason. */
export function TeamCalendar({ me }: { me: Me }) {
  const [month, setMonth] = useState(me.today.slice(0, 8) + '01');
  const d = useLoad(() => rpc<Cell[]>('team_attendance_month', { p_month: month }), [month]);
  const [ed, setEd] = useState<Cell | null>(null);
  const [st, setSt] = useState('present');
  const [why, setWhy] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const cells = (d.data ?? []) as Cell[];
  const people = useMemo(() => [...new Map(cells.map((c) => [c.person_id, c])).values()], [cells]);
  const days = useMemo(() => [...new Set(cells.map((c) => c.work_date))].sort(), [cells]);
  const at = (p: string, day: string) => cells.find((c) => c.person_id === p && c.work_date === day);
  const unconfirmed = (day: string) => cells.filter((c) => c.work_date === day && !c.final && c.auto !== 'pending').length;
  async function save() {
    if (!ed) return; setBusy(true); setErr(null);
    try { await rpc('set_attendance', { p_person: ed.person_id, p_date: ed.work_date, p_status: st, p_reason: st === ed.auto && !why.trim() ? 'Confirmed as reported' : why.trim() }); setEd(null); d.reload(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }
  async function confirmDay(day: string) {
    setBusy(true); setErr(null);
    try { await rpc('confirm_team_day', { p_date: day }); d.reload(); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const sum = (p: string, ks: string[]) => cells.filter((c) => c.person_id === p && ks.includes(c.status)).reduce((a, c) => a + (c.status === 'half_day' ? 0.5 : 1), 0);
  return (
    <Card title="Team attendance — month" action={<input type="month" value={month.slice(0, 7)} max={me.today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value + '-01')} aria-label="Month" style={{ width: 160 }} />}>
      <p className="small muted">Each day is marked automatically from the daily report (P = figures submitted, A = not). Confirm the day at end of day; tap a cell to change it (a reason is needed). Dashed = not confirmed yet.</p>
      <ErrorBox error={err} />
      {d.loading ? <Loading rows={4} /> : <ErrorBox error={d.error} retry={d.reload} />}
      {d.data && (people.length === 0 ? <Empty>Nobody reports to you this month.</Empty> : (
        <div className="tablewrap" tabIndex={0}><table className="cal">
          <thead><tr><th className="sticky">Person</th>{days.map((day) => <th key={day} className="num" title={nice(day)}>{Number(day.slice(8))}<div className="small muted">{nice(day).slice(0, 2)}</div></th>)}
            <th className="num" title="Present days (half day = ½)">P</th><th className="num" title="Absent + unplanned leave">A</th><th className="num" title="Planned leave">PL</th></tr></thead>
          <tbody>{people.map((p) => <tr key={p.person_id}><td className="sticky"><b>{p.full_name}</b><div className="small muted">{p.designation ?? ''}</div></td>
            {days.map((day) => { const c = at(p.person_id, day); if (!c) return <td key={day} />; const [code, tone] = CODE[c.status] ?? ['?', 'neutral'];
              return <td key={day} className="num"><button className={`pill ${tone} calcell${c.final ? '' : ' faded'}`} title={`${nice(day)}: ${label(c.status)}${c.final ? ' (confirmed)' : ' (auto)'}${c.reason ? ` — ${c.reason}` : ''}`}
                onClick={() => { setEd(c); setSt(c.status === 'pending' ? 'present' : c.status); setWhy(''); }}>{code}</button></td>; })}
            <td className="num"><b>{sum(p.person_id, ['present', 'late', 'early_leave', 'half_day', 'sunday_work'])}</b></td>
            <td className="num">{sum(p.person_id, ['absent', 'unplanned_leave'])}</td><td className="num">{sum(p.person_id, ['planned_leave'])}</td></tr>)}
            <tr><td className="sticky small muted">Confirm day</td>{days.map((day) => <td key={day} className="num">{unconfirmed(day) > 0
              ? <button className="btn sm" disabled={busy} title={`Confirm ${unconfirmed(day)} as reported`} onClick={() => confirmDay(day)}>✓{unconfirmed(day)}</button> : <span className="small muted">✓</span>}</td>)}<td colSpan={3} /></tr>
          </tbody></table></div>))}
      <div className="small muted" style={{ marginTop: 6 }}>{Object.entries(CODE).filter(([k]) => k !== 'pending').map(([k, [c]]) => `${c} ${label(k)}`).join(' · ')}</div>
      {ed && <div className="banner info stack" style={{ marginTop: 10 }}>
        <b>{ed.full_name} · {nice(ed.work_date)}</b>
        <div className="small">Auto from the daily report: <b>{label(ed.auto)}</b>{ed.final ? ` · confirmed as ${label(ed.status)}${ed.reason ? ` (${ed.reason})` : ''}` : ''}</div>
        <div className="row" style={{ alignItems: 'end' }}>
          <label className="field">Final<select value={st} onChange={(e) => setSt(e.target.value)}>{OPTIONS.map((o) => <option key={o} value={o}>{label(o)}</option>)}</select></label>
          <label className="field" style={{ flex: 1 }}>{st === ed.auto ? 'Note (optional)' : 'Reason for the change (required)'}<input value={why} onChange={(e) => setWhy(e.target.value)} /></label></div>
        <div className="row"><button className="btn primary sm" disabled={busy || (st !== ed.auto && !why.trim())} onClick={save}>Save</button><button className="btn sm" onClick={() => setEd(null)}>Cancel</button></div>
      </div>}
    </Card>
  );
}
export default TeamCalendar;
