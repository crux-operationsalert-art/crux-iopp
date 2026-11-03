import { useEffect, useRef, useState } from 'react';
import { Me, rpc } from '../lib/api';
import { addDays, label, money, nice, num, time } from '../lib/format';
import { Card, Countdown, Empty, ErrorBox, Loading, Pill, useLoad } from '../components/ui';

type Row = { client_location_id: string; client: string; location: string; process: string; entry: number | null;
  closure: number | null; cancelled: number | null; rate: number | null; billable_event: string | null;
  opening_wip: number; wip_seeded: boolean; source: string | null };
type Save = 'idle' | 'saving' | 'saved' | 'error';

export default function Productivity({ me }: { me: Me }) {
  const [date, setDate] = useState(me.today);
  const day = useLoad(() => rpc('my_day', { p_work_date: date }), [date]);
  const [rows, setRows] = useState<Row[]>([]);
  const [save, setSave] = useState<Save>('idle');
  const [err, setErr] = useState<unknown>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number>();
  const dirty = useRef(false);

  useEffect(() => { if (day.data) setRows(day.data.rows); }, [day.data]);

  const st: string = day.data?.status?.status ?? 'pending';
  const locked = !!day.data && ((st !== 'pending' && st !== 'draft') || day.data.window === 'closed' || day.data.window === 'future') && !day.data.reopened;
  const reopenedEdit = day.data?.reopened;

  function change(i: number, k: 'entry' | 'closure' | 'cancelled', v: string) {
    const n = v === '' ? null : Math.max(0, Math.floor(Number(v)));
    setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: Number.isFinite(n as number) || n === null ? n : x[k] } : x)));
    dirty.current = true; setSave('saving');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => persist(), 900);
  }

  async function persist(rs = rows) {
    if (!dirty.current) return true;
    try {
      setSave('saving'); setErr(null);
      const payload = (rsRef.current ?? rs).filter((r) => r.entry !== null || r.closure !== null || r.cancelled !== null)
        .map((r) => ({ client_location_id: r.client_location_id, entry: r.entry ?? 0, closure: r.closure ?? 0, cancelled: r.cancelled ?? 0 }));
      await rpc('save_productivity', { p_work_date: date, p_rows: payload });
      dirty.current = false; setSave('saved'); return true;
    } catch (e) { setErr(e); setSave('error'); return false; }
  }
  const rsRef = useRef<Row[]>();
  useEffect(() => { rsRef.current = rows; }, [rows]);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      // Blank rows become explicit zeros on submit (present with zero work is a valid answer).
      const filled = rows.map((r) => ({ ...r, entry: r.entry ?? 0, closure: r.closure ?? 0, cancelled: r.cancelled ?? 0 }));
      setRows(filled); rsRef.current = filled; dirty.current = true;
      if (!(await persist(filled))) return;
      await rpc('submit_day', { p_work_date: date });
      setConfirm(false); day.reload();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }

  const tot = rows.reduce((a, r) => ({ e: a.e + (r.entry ?? 0), c: a.c + (r.closure ?? 0), x: a.x + (r.cancelled ?? 0),
    rev: a.rev + (r.rate ? r.rate * (r.billable_event === 'entry' ? r.entry ?? 0 : r.billable_event === 'closure' ? r.closure ?? 0 : (r.entry ?? 0) + (r.closure ?? 0) - (r.cancelled ?? 0)) : 0) }),
    { e: 0, c: 0, x: 0, rev: 0 });

  return (
    <div className="stack">
      <div className="topbar">
        <div><h1>My day</h1><div className="muted">Enter today's figures for each client and location you work on.</div></div>
        <div className="row">
          <button className="btn sm" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">‹</button>
          <input type="date" value={date} max={me.today} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ width: 160 }} aria-label="Work date" />
          <button className="btn sm" disabled={date >= me.today} onClick={() => setDate(addDays(date, 1))} aria-label="Next day">›</button>
        </div>
      </div>

      {day.loading && <Loading rows={4} />}
      <ErrorBox error={day.error} retry={day.reload} />
      {day.data && (
        <>
          <div className="row">
            <Pill status={st} text={st === 'pending' ? 'Not submitted' : undefined} />
            {day.data.status?.late && <Pill status="exception" text="Late" />}
            {day.data.window === 'open' && !locked && <span className="muted"><Countdown to={day.data.deadline} prefix="Closes at midnight · " /></span>}
            {day.data.window === 'grace' && !locked && <span className="pill warn">Late window until 10:00 · <Countdown to={day.data.grace_deadline} /></span>}
            {day.data.window === 'closed' && !reopenedEdit && <span className="pill bad">Reporting closed for {nice(date)}. Only an Admin can reopen it.</span>}
            {reopenedEdit && <span className="pill info">Reopened by Admin — you can correct and resubmit</span>}
            <span className="spacer" />
            {!locked && <span className="small muted" aria-live="polite">{save === 'saving' ? 'Saving…' : save === 'saved' ? 'Draft saved' : save === 'error' ? 'Not saved' : ''}</span>}
          </div>
          {st === 'manager_entered' && <div className="banner info">Your manager entered these figures for you. Reason: {day.data.status.reason}</div>}
          {['absent', 'on_leave', 'non_operational', 'exception'].includes(st) && <div className="banner info">You are marked {label(st)} for this day. Reason: {day.data.status.reason}</div>}
          <ErrorBox error={err} />

          <Card>
            {rows.length === 0 ? <Empty>No clients or locations are assigned to you on {nice(date)}. Your manager assigns them.</Empty> : (
              <div role="table" aria-label="Daily figures">
                <div className="entry-row entry-head" role="row"><span>Client · location</span><span className="num">Entry</span><span className="num">Closure</span><span className="num">Cancelled</span><span className="num">Net · WIP</span></div>
                {rows.map((r, i) => {
                  const net = (r.entry ?? 0) + (r.closure ?? 0) - (r.cancelled ?? 0);
                  const wip = r.opening_wip + (r.entry ?? 0) - (r.closure ?? 0) - (r.cancelled ?? 0);
                  return (
                    <div className="entry-row" role="row" key={r.client_location_id}>
                      <div className="who"><b>{r.client}</b> <span className="muted">· {r.location}</span><div className="small muted">{r.process}{r.source === 'on_behalf' ? ' · entered by manager' : ''}</div></div>
                      {(['entry', 'closure', 'cancelled'] as const).map((k) => (
                        <label key={k}><span className="cap" aria-hidden>{label(k)}</span><span className="sr">{label(k)} for {r.client} {r.location}</span>
                          <input type="number" inputMode="numeric" min={0} step={1} placeholder="0" disabled={locked}
                            value={r[k] ?? ''} onChange={(e) => change(i, k, e.target.value)} onBlur={() => persist()} /></label>
                      ))}
                      <div className="derived small"><b>{num(net)}</b> net<br /><span className="muted" title="System-calculated, provisional until Operations confirms the WIP rule">WIP {num(wip)}{r.wip_seeded ? '' : '*'}</span></div>
                    </div>
                  );
                })}
                <div className="entry-row" style={{ borderBottom: 0 }}><b className="who">Total</b><b className="num">{num(tot.e)}</b><b className="num">{num(tot.c)}</b><b className="num">{num(tot.x)}</b>
                  <div className="derived small"><b>{num(tot.e + tot.c - tot.x)}</b> net<br /><span className="muted">{money(tot.rev)} est. revenue</span></div></div>
                <p className="small muted">Net = Entry + Closure − Cancelled (calculated by the system). * WIP has no opening balance yet, so it starts from 0. Leave a box empty or 0 if there was no work.</p>
              </div>)}
          </Card>

          {!locked && rows.length > 0 && !confirm && <button className="btn primary" onClick={() => setConfirm(true)}>Review and submit</button>}
          {confirm && (
            <Card title="Submit these figures?">
              <p>{nice(date)}: Entry <b>{num(tot.e)}</b>, Closure <b>{num(tot.c)}</b>, Cancelled <b>{num(tot.x)}</b> → Net <b>{num(tot.e + tot.c - tot.x)}</b> across {rows.length} row(s). Empty boxes are submitted as 0.</p>
              <p className="muted small">After you submit, the figures are locked. Your manager can see them, and only an Admin can reopen the day.</p>
              <div className="row"><button className="btn primary" disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit'}</button><button className="btn" onClick={() => setConfirm(false)}>Back</button></div>
            </Card>
          )}
          {(st === 'submitted' || st === 'manager_entered') && (
            <div className="banner ok">Submitted {day.data.status.submitted_at ? time(day.data.status.submitted_at) : ''}. Waiting for your manager's review.</div>
          )}
        </>
      )}
    </div>
  );
}
