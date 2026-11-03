import { useSearchParams } from 'react-router-dom';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Me, rpc, select } from '../lib/api';
import { addDays, label, money, nice, num, time } from '../lib/format';
import { Card, Countdown, Empty, ErrorBox, Loading, Pill, useLoad } from '../components/ui';
import { MyAttendance } from './Attendance';
import { ClientPicker } from '../components/ClientPicker';
import DayMessage from './DayMessage';
import { Certify } from './Certify';

const B = [['tat_0_1', '0–1 d', 'Received today, pending'], ['tat_1_2', '1–2 d', ''], ['tat_2_4', '2–4 d', ''], ['tat_4_7', '4–7 d', ''], ['tat_7_15', '7–15 d', ''], ['tat_15p', '15+ d', '']] as const;
type BK = (typeof B)[number][0];
type K = 'entry' | 'closure' | 'cancelled' | BK;
type Row = { client_location_id: string; client: string; location: string; process: string; rate: number | null; billable_event: string | null;
  source: string | null; opening_pending: number | null; tat_note: string | null } & Record<K, number | null>;
type DK = 'bill_count' | 'bill_amount' | 'rcv_lt30' | 'rcv_30_90' | 'rcv_90_180' | 'rcv_gt180' | 'rec_lt30' | 'rec_30_90' | 'rec_90_180' | 'rec_gt180';
type AK = 'ar_lt30' | 'ar_30_90' | 'ar_90_180' | 'ar_gt180';
type Money = { branch_id: string; branch: string; client_id: string; client: string; target: number | null; mtd: any; saved: any;
  ar: Record<AK, number | null>; arInfo: any; arDirty?: boolean } & Record<DK, number | null>;
const AGES: [string, string][] = [['lt30', '< 30 d'], ['30_90', '30–90 d'], ['90_180', '3–6 m'], ['gt180', '> 6 m']];
const AKS = AGES.map(([k]) => ('ar_' + k) as AK);
const DKS: DK[] = ['bill_count', 'bill_amount', ...AGES.map(([k]) => ('rcv_' + k) as DK), ...AGES.map(([k]) => ('rec_' + k) as DK)];
const cashGap = (c: Money) => DKS.some((k) => c[k] == null) || AKS.some((k) => c.ar[k] == null);
const toMoney = (x: any): Money => ({ branch_id: x.branch_id, branch: x.branch, client_id: x.client_id, client: x.client, target: x.target, mtd: x.mtd ?? {}, saved: x.day ?? {},
  ar: Object.fromEntries(AKS.map((k) => [k, x.ar?.[k] ?? null])) as Record<AK, number | null>, arInfo: x.ar,
  ...(Object.fromEntries(DKS.map((k) => [k, x.day?.[k] ?? null])) as Record<DK, number | null>) });
const sumv = (o: any, ks: string[]) => ks.reduce((t, k) => t + (Number(o?.[k] ?? 0) || 0), 0);
type Save = 'idle' | 'saving' | 'saved' | 'error';

const pendingOf = (r: Row) => B.reduce((a, [k]) => a + (r[k] ?? 0), 0);
const allBuckets = (r: Row) => B.every(([k]) => r[k] != null);
const expectedOf = (r: Row) => (r.opening_pending == null ? null : r.opening_pending + (r.entry ?? 0) - (r.closure ?? 0) - (r.cancelled ?? 0));
const rowComplete = (r: Row) => r.entry != null && r.closure != null && r.cancelled != null && allBuckets(r);
const rowTallies = (r: Row) => { const e = expectedOf(r); return e == null || pendingOf(r) === e || !!(r.tat_note ?? '').trim(); };

export default function Productivity({ me }: { me: Me }) {
  const [sp] = useSearchParams();
  const [date, setDate] = useState(() => { const d = sp.get('date'); return d && d <= me.today ? d : me.today; });
  const day = useLoad(() => rpc('my_day', { p_work_date: date }), [date]);
  const tg = useLoad(() => rpc<any>('my_targets', { p_date: date }), [date]);
  const [rows, setRows] = useState<Row[]>([]);
  const [cash, setCash] = useState<Money[]>([]);
  const [save, setSave] = useState<Save>('idle');
  const [err, setErr] = useState<unknown>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number>();
  const dirty = useRef({ lines: false, cash: false });
  const rsRef = useRef<Row[]>([]); const csRef = useRef<Money[]>([]);
  useEffect(() => { if (day.data) { setRows(day.data.rows); setCash((day.data.money ?? []).map(toMoney)); } }, [day.data]);
  useEffect(() => { rsRef.current = rows; }, [rows]);
  useEffect(() => { csRef.current = cash; }, [cash]);

  const mgr = me.manages_operations;
  const team = useLoad(() => mgr ? rpc<any[]>('team_lines', { p_date: date }) : Promise.resolve([]), [date]);
  const tstat = useLoad(() => mgr ? rpc<any[]>('team_status', { p_work_date: date }) : Promise.resolve([]), [date]);
  const cert = useLoad(() => mgr ? select('certifications', '*', (b) => b.eq('manager_id', me.person_id).eq('work_date', date).eq('function', 'operations')) : Promise.resolve([]), [date]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const tl = (team.data ?? []) as any[];
  const teamBy = (cl: string) => tl.filter((t) => t.client_location_id === cl);
  const teamOnly = [...new Set(tl.map((t) => t.client_location_id))].filter((cl) => !rows.some((r) => r.client_location_id === cl));

  const st: string = day.data?.status?.status ?? 'pending';
  const locked = !!day.data && ((st !== 'pending' && st !== 'draft') || day.data.window === 'closed' || day.data.window === 'future') && !day.data.reopened;

  function schedule() { setSave('saving'); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => persist(), 900); }
  function change(i: number, k: K, v: string) {
    const n = v === '' ? null : Math.max(0, Math.floor(Number(v)));
    setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: n === null || Number.isFinite(n) ? n : x[k] } : x)));
    dirty.current.lines = true; schedule();
  }
  function note(i: number, v: string) { setRows((r) => r.map((x, j) => (j === i ? { ...x, tat_note: v } : x))); dirty.current.lines = true; schedule(); }
  function changeCash(i: number, k: DK, v: string) {
    const n = v === '' ? null : Math.max(0, Number(v));
    setCash((c) => c.map((x, j) => (j === i ? { ...x, [k]: n } : x))); dirty.current.cash = true; schedule();
  }
  function changeAr(i: number, k: AK, v: string) {
    const n = v === '' ? null : Math.max(0, Number(v));
    setCash((c) => c.map((x, j) => (j === i ? { ...x, ar: { ...x.ar, [k]: n }, arDirty: true } : x))); dirty.current.cash = true; schedule();
  }
  async function persist() {
    try {
      setErr(null);
      if (dirty.current.lines) {
        const rs = rsRef.current;
        const lines = rs.filter((r) => r.entry != null || r.closure != null || r.cancelled != null)
          .map((r) => ({ client_location_id: r.client_location_id, entry: r.entry ?? 0, closure: r.closure ?? 0, cancelled: r.cancelled ?? 0 }));
        if (lines.length) await rpc('save_productivity', { p_work_date: date, p_rows: lines });
        const pend = rs.filter((r) => B.some(([k]) => r[k] != null) || (r.tat_note ?? '') !== '')
          .map((r) => ({ client_location_id: r.client_location_id, ...Object.fromEntries(B.map(([k]) => [k, r[k]])), tat_note: r.tat_note }));
        if (pend.length) await rpc('save_pending', { p_work_date: date, p_rows: pend });
        dirty.current.lines = false; tg.reload();
      }
      if (dirty.current.cash) {
        const cs = csRef.current;
        const ar = cs.filter((c) => c.arDirty && c.arInfo?.status !== 'revised' && AKS.every((k) => c.ar[k] != null));
        if (ar.length) { await rpc('save_ar', { p_month: date.slice(0, 7) + '-01', p_rows: ar.map((c) => ({ branch_id: c.branch_id, client_id: c.client_id, ...c.ar })) });
          setCash((x) => x.map((c) => (ar.some((a) => a.branch_id === c.branch_id && a.client_id === c.client_id) ? { ...c, arDirty: false } : c))); }
        const full = cs.filter((c) => DKS.every((k) => c[k] != null));
        if (full.length) await rpc('save_collection_day', { p_date: date, p_rows: full.map((c) => ({ branch_id: c.branch_id, client_id: c.client_id, ...Object.fromEntries(DKS.map((k) => [k, c[k]])) })) });
        if (cs.every((c) => !cashGap(c))) dirty.current.cash = false;
      }
      setSave('saved'); return true;
    } catch (e) { setErr(e); setSave('error'); return false; }
  }
  async function submit() {
    setBusy(true); setErr(null);
    try {
      dirty.current = { lines: true, cash: cash.length > 0 };
      if (!(await persist())) return;
      await rpc('submit_day', { p_work_date: date });
      setConfirm(false); day.reload(); team.reload();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }

  const tot = rows.reduce((a, r) => ({ e: a.e + (r.entry ?? 0), c: a.c + (r.closure ?? 0), x: a.x + (r.cancelled ?? 0), p: a.p + pendingOf(r),
    rev: a.rev + (r.rate ? r.rate * (r.billable_event === 'entry' ? (r.entry ?? 0) - (r.cancelled ?? 0) : r.billable_event === 'closure' ? r.closure ?? 0 : (r.entry ?? 0) + (r.closure ?? 0) - (r.cancelled ?? 0)) : 0) }),
    { e: 0, c: 0, x: 0, p: 0, rev: 0 });
  const incomplete = rows.filter((r) => !rowComplete(r));
  const untallied = rows.filter((r) => rowComplete(r) && !rowTallies(r));
  const cashMissing = cash.filter(cashGap);
  const ready = rows.length > 0 && !incomplete.length && !untallied.length && !cashMissing.length;

  return (
    <div className="stack">
      <div className="topbar">
        <div><h1>My day — daily entry</h1><div className="muted">Every box is required (type 0 where there was nothing). Pending cases by age must add up to yesterday's pending + entry − closure − cancelled.</div></div>
        <div className="row">
          <button className="btn sm" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">‹</button>
          <input type="date" value={date} max={me.today} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ width: 160 }} aria-label="Work date" />
          <button className="btn sm" disabled={date >= me.today} onClick={() => setDate(addDays(date, 1))} aria-label="Next day">›</button>
        </div>
      </div>
      {tg.data && <MoneyTargets t={tg.data} />}

      {date === me.today && <Card><MyAttendance me={me} compact /></Card>}
      {date === me.today && day.data && (
        <Card><details open={day.data.rows.length === 0}>
          <summary style={{ cursor: 'pointer' }}><b>My clients</b> <span className="muted small">— tick the clients you work on ({day.data.rows.length} active today). Tap to {day.data.rows.length ? 'change' : 'choose'}.</span></summary>
          <div style={{ marginTop: 10 }}><ClientPicker compact onChanged={() => day.reload()} /></div>
        </details></Card>)}
      {day.loading && <Loading rows={4} />}
      <ErrorBox error={day.error} retry={day.reload} />
      {day.data && (
        <>
          <div className="row">
            <Pill status={st} text={st === 'pending' ? 'Not submitted' : undefined} />
            {day.data.status?.late && <Pill status="exception" text="Late" />}
            {day.data.window === 'open' && !locked && <span className="muted"><Countdown to={day.data.deadline} prefix="Closes at midnight · " /></span>}
            {day.data.window === 'grace' && !locked && <span className="pill warn">Late window until 10:00 · <Countdown to={day.data.grace_deadline} /></span>}
            {day.data.window === 'closed' && !day.data.reopened && <span className="pill bad">Reporting closed for {nice(date)}. Only an Admin can reopen it.</span>}
            {day.data.reopened && <span className="pill info">Reopened by Admin — you can correct and resubmit</span>}
            <span className="spacer" />
            {!locked && <span className="small muted" aria-live="polite">{save === 'saving' ? 'Saving…' : save === 'saved' ? 'Draft saved' : save === 'error' ? 'Not saved' : ''}</span>}
          </div>
          {st === 'manager_entered' && <div className="banner info">Your manager entered these figures for you. Reason: {day.data.status.reason}</div>}
          {['absent', 'on_leave', 'non_operational', 'exception'].includes(st) && <div className="banner info">You are marked {label(st)} for this day. Reason: {day.data.status.reason}</div>}
          <ErrorBox error={err} />

          <Card>
            {rows.length === 0 ? <Empty>No clients are active for you on {nice(date)}. Tick the ones you work on under “My clients” above.</Empty> : (
              <div role="table" aria-label="Daily figures">
                <div className="entry-row entry-head" role="row"><span>Client · location</span><span className="num">Entry</span><span className="num">Closure</span><span className="num">Cancelled</span><span className="num">Net</span></div>
                {rows.map((r, i) => {
                  const net = (r.entry ?? 0) + (r.closure ?? 0) - (r.cancelled ?? 0);
                  const exp = expectedOf(r), pend = pendingOf(r), tallies = exp == null || pend === exp;
                  const tm = teamBy(r.client_location_id);
                  return (
                    <div className="entry-row" role="row" key={r.client_location_id}>
                      <div className="who"><b>{r.client}</b> <span className="muted">· {r.location}</span><div className="small muted">{r.process}{r.source === 'on_behalf' ? ' · entered by manager' : ''}</div>
                        <TargetLine t={tg.data} cl={r.client_location_id} /></div>
                      {(['entry', 'closure', 'cancelled'] as const).map((k) => (
                        <label key={k}><span className="cap" aria-hidden>{label(k)}</span><span className="sr">{label(k)} for {r.client} {r.location}</span>
                          <input type="number" inputMode="numeric" min={0} step={1} disabled={locked} className={r[k] == null && !locked ? 'need' : ''}
                            value={r[k] ?? ''} onChange={(e) => change(i, k, e.target.value)} onBlur={() => persist()} /></label>))}
                      <div className="derived small"><b>{num(net)}</b> net</div>
                      <div className="buckets" style={{ gridColumn: '1 / -1' }}>
                        <span className="small"><b>Pending by age</b></span>
                        {B.map(([k, l, h]) => <label key={k} title={h || undefined}><span className="cap">{l}</span>
                          <input type="number" inputMode="numeric" min={0} step={1} disabled={locked} className={r[k] == null && !locked ? 'need' : ''}
                            aria-label={`Pending ${l} for ${r.client} ${r.location}`} value={r[k] ?? ''} onChange={(e) => change(i, k, e.target.value)} onBlur={() => persist()} /></label>)}
                        <span className={`small ${allBuckets(r) && !tallies ? 'bad-text' : 'muted'}`}>
                          = <b>{num(pend)}</b> pending{exp == null ? ' (first day — sets your starting pending)' : tallies ? ' ✓ tallies' : ` · expected ${num(exp)} (prev ${num(r.opening_pending)} + ${num(r.entry ?? 0)} − ${num(r.closure ?? 0)} − ${num(r.cancelled ?? 0)})`}</span>
                      </div>
                      {exp != null && allBuckets(r) && !tallies && (
                        <label className="field small" style={{ gridColumn: '1 / -1' }}>Why doesn't it tally? (required — your manager sees this as a miss)
                          <input value={r.tat_note ?? ''} disabled={locked} onChange={(e) => note(i, e.target.value)} onBlur={() => persist()} placeholder="e.g. 2 cases transferred to Nashik" /></label>)}
                      {mgr && (
                        <div className="small" style={{ gridColumn: '1 / -1' }}>
                          <button className="linklike" onClick={() => { const s = new Set(open); s.has(r.client_location_id) ? s.delete(r.client_location_id) : s.add(r.client_location_id); setOpen(s); }} aria-expanded={open.has(r.client_location_id)}>
                            {open.has(r.client_location_id) ? '▾' : '▸'} Team roll-up here: {tm.length ? `E ${num(tm.reduce((a, t) => a + t.entry, 0))} · C ${num(tm.reduce((a, t) => a + t.closure, 0))} · X ${num(tm.reduce((a, t) => a + t.cancelled, 0))} · pending ${num(tm.reduce((a, t) => a + (t.pending ?? 0), 0))} (${tm.length} people)` : 'nothing entered by the team yet'}</button>
                          {open.has(r.client_location_id) && <TeamLines me={me} date={date} lines={tm} onDone={team.reload} />}
                        </div>)}
                    </div>
                  );
                })}
                <div className="entry-row" style={{ borderBottom: 0 }}><b className="who">Total</b><b className="num">{num(tot.e)}</b><b className="num">{num(tot.c)}</b><b className="num">{num(tot.x)}</b>
                  <div className="derived small"><b>{num(tot.e + tot.c - tot.x)}</b> net<br /><span className="muted">{num(tot.p)} pending · {money(tot.rev)} est. revenue</span></div></div>
              </div>)}
          </Card>

          {cash.length > 0 && (
            <Card title="Collections" action={<span className="small muted">for the clients you head · totals per client · 0 if none</span>}>
              <div role="table" aria-label="Collections entry">
                {cash.map((c, i) => {
                  const arT = sumv(c.ar, AKS);
                  const today = sumv(c, AGES.map(([k]) => 'rcv_' + k)), todayRec = sumv(c, AGES.map(([k]) => 'rec_' + k));
                  const mtd = sumv(c.mtd, ['r1', 'r2', 'r3', 'r4']) - sumv(c.saved, AGES.map(([k]) => 'rcv_' + k)) + today;
                  const revised = c.arInfo?.status === 'revised';
                  const box = (k: DK, l: string, int = false) => <label key={k}><span className="cap" aria-hidden>{l}</span>
                    <input type="number" inputMode={int ? 'numeric' : 'decimal'} min={0} step={int ? 1 : 'any'} disabled={locked} className={c[k] == null && !locked ? 'need' : ''}
                      aria-label={`${l} ${c.client} ${c.branch}`} value={c[k] ?? ''} onChange={(e) => changeCash(i, k, e.target.value)} onBlur={() => persist()} /></label>;
                  const ages = (pre: 'rcv' | 'rec') => AGES.map(([k, l]) => box(`${pre}_${k}` as DK, l));
                  return (
                    <div className="entry-row" role="row" key={c.branch_id + c.client_id}>
                      <div className="who"><b>{c.client}</b> <span className="muted">· {c.branch}</span>
                        <div className="small">Collection target: <b>{c.target != null ? money(c.target) : 'not set'}</b> <span className="muted">(set by your manager)</span></div></div>
                      {box('bill_count', 'Bills raised (no.)', true)}{box('bill_amount', 'Bills raised ₹')}
                      <div className="derived small">Collected this month <b>{money(mtd)}</b>{c.target ? <><br />{((mtd / c.target) * 100).toFixed(1)}% of target</> : null}<br />Balance <b>{money(arT - mtd)}</b></div>
                      <div className="buckets" style={{ gridColumn: '1 / -1' }}><span className="small"><b>Receivables this month</b><br /><span className="muted">once a month · total {money(arT)}</span></span>
                        {AKS.map((k, j) => <label key={k}><span className="cap">{AGES[j][1]}</span>
                          <input type="number" min={0} step="any" inputMode="decimal" disabled={locked || revised} className={c.ar[k] == null && !locked ? 'need' : ''}
                            aria-label={`Receivables ${AGES[j][1]} ${c.client} ${c.branch}`} value={c.ar[k] ?? ''} onChange={(e) => changeAr(i, k, e.target.value)} onBlur={() => persist()} /></label>)}</div>
                      {revised && <div className="small banner warn" style={{ gridColumn: '1 / -1' }}>Changed by the Collections Head: {c.arInfo.review_note}{c.arInfo.original ? ` (your figure ${money(sumv(c.arInfo.original, AKS))})` : ''}</div>}
                      <div className="buckets" style={{ gridColumn: '1 / -1' }}><span className="small"><b>Received today</b><br /><span className="muted">{money(today)}</span></span>{ages('rcv')}</div>
                      <div className="buckets" style={{ gridColumn: '1 / -1' }}><span className="small"><b>Reconciled today</b><br /><span className="muted">{money(todayRec)}</span></span>{ages('rec')}</div>
                    </div>);
                })}
              </div>
            </Card>)}
          {(day.data?.money_others ?? []).length > 0 && <p className="small muted">Collections for {(day.data.money_others as any[]).map((o) => `${o.client} · ${o.branch} are reported by ${o.by ?? 'the location head'}`).join('; ')}.</p>}

          {!locked && rows.length > 0 && (
            <div className="stack">
              {!ready && <div className="banner warn">
                {incomplete.length > 0 && <div>{incomplete.length} row(s) still have empty boxes: {incomplete.slice(0, 4).map((r) => r.client).join(', ')}{incomplete.length > 4 ? '…' : ''}.</div>}
                {untallied.length > 0 && <div>{untallied.length} row(s) don't tally — correct the figures or write why.</div>}
                {cashMissing.length > 0 && <div>Collections incomplete for {cashMissing.length} client(s): {cashMissing.slice(0, 3).map((c) => c.client).join(', ')}.</div>}
              </div>}
              {!confirm && <button className="btn primary" disabled={!ready} onClick={() => setConfirm(true)}>Review and submit</button>}
            </div>)}
          {confirm && (
            <Card title="Submit these figures?">
              <p>{nice(date)}: Entry <b>{num(tot.e)}</b>, Closure <b>{num(tot.c)}</b>, Cancelled <b>{num(tot.x)}</b> → Net <b>{num(tot.e + tot.c - tot.x)}</b>; pending <b>{num(tot.p)}</b> across {rows.length} row(s).</p>
              <p className="muted small">After you submit, the figures are locked; your manager can correct them with a note, and only an Admin can reopen the day. Submitting also marks your attendance.</p>
              <div className="row"><button className="btn primary" disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit'}</button><button className="btn" onClick={() => setConfirm(false)}>Back</button></div>
            </Card>)}
          {(st === 'submitted' || st === 'manager_entered') && <div className="banner ok">Submitted {day.data.status.submitted_at ? time(day.data.status.submitted_at) : ''}. Waiting for your manager's review.</div>}
          {mgr && teamOnly.length > 0 && (
            <Card title="Team figures on clients you don't enter yourself">
              {teamOnly.map((cl) => { const tm = teamBy(cl); return (
                <Fragment key={cl}>
                  <button className="linklike" onClick={() => { const s = new Set(open); s.has(cl) ? s.delete(cl) : s.add(cl); setOpen(s); }} aria-expanded={open.has(cl)}>
                    {open.has(cl) ? '▾' : '▸'} <b>{tm[0].client}</b> · {tm[0].location}: E {num(tm.reduce((a, t) => a + t.entry, 0))} · C {num(tm.reduce((a, t) => a + t.closure, 0))} · X {num(tm.reduce((a, t) => a + t.cancelled, 0))} · pending {num(tm.reduce((a, t) => a + (t.pending ?? 0), 0))} ({tm.length})</button>
                  {open.has(cl) && <TeamLines me={me} date={date} lines={tm} onDone={team.reload} />}
                </Fragment>); })}
            </Card>)}
          {mgr && tstat.data && tstat.data.length > 0 && (
            <Certify me={me} date={date} fn="operations" blockers={tstat.data.filter((t: any) => !t.resolved)} existing={cert.data?.[0]} onDone={() => { cert.reload(); tstat.reload(); }} />)}
          {(st !== 'pending' && st !== 'draft' || (mgr && rows.length === 0)) && (
            <DayMessage me={me} date={date} wip={Object.fromEntries(rows.map((r) => [r.client_location_id, pendingOf(r)]))} />)}
          {(st === 'pending' || st === 'draft') && rows.length > 0 && <p className="small muted">After you submit, a ready-to-paste WhatsApp message with all your numbers appears here.</p>}
        </>
      )}
    </div>
  );
}

/** Per-person lines under a manager, with Edit / Remove (a note is required and the person is told). */
function TeamLines({ me, date, lines, onDone }: { me: Me; date: string; lines: any[]; onDone: () => void }) {
  const [ed, setEd] = useState<{ p: any; e: string; c: string; x: string; note: string; remove: boolean } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  async function go() {
    if (!ed) return; setErr(null);
    try {
      await rpc('correct_team_line', { p_person: ed.p.person_id, p_date: date, p_client_location: ed.p.client_location_id, p_entry: Number(ed.e || 0),
        p_closure: Number(ed.c || 0), p_cancelled: Number(ed.x || 0), p_note: ed.note, p_remove: ed.remove });
      setEd(null); onDone();
    } catch (e) { setErr(e); }
  }
  void me;
  return (
    <div className="stack" style={{ margin: '6px 0 6px 14px' }}>
      <table><tbody>{lines.map((t) => (
        <tr key={t.person_id + t.client_location_id}><td>{t.full_name}<div className="small muted">{t.status ? label(t.status) : 'not submitted'}{t.source === 'on_behalf' && t.reason ? ` · ${t.reason}` : ''}</div></td>
          <td className="num">E {t.entry}</td><td className="num">C {t.closure}</td><td className="num">X {t.cancelled}</td><td className="num">P {t.pending ?? '—'}</td>
          <td><div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn sm" onClick={() => setEd({ p: t, e: String(t.entry), c: String(t.closure), x: String(t.cancelled), note: '', remove: false })}>Edit</button>
            <button className="btn sm" onClick={() => setEd({ p: t, e: '0', c: '0', x: '0', note: '', remove: true })}>Remove</button></div></td></tr>))}</tbody></table>
      {ed && <div className="banner info stack">
        <b>{ed.remove ? `Remove ${ed.p.full_name}'s entry for ${ed.p.client}` : `Correct ${ed.p.full_name}'s ${ed.p.client} entry`}</b>
        {!ed.remove && <div className="row">{(['e', 'c', 'x'] as const).map((k) => <label key={k} className="field">{{ e: 'Entry', c: 'Closure', x: 'Cancelled' }[k]}
          <input type="number" min={0} style={{ width: 90 }} value={ed[k]} onChange={(v) => setEd({ ...ed, [k]: v.target.value })} /></label>)}</div>}
        <label className="field">Note (required — the person is told; old figures stay in the audit log)<input value={ed.note} onChange={(v) => setEd({ ...ed, note: v.target.value })} /></label>
        <ErrorBox error={err} />
        <div className="row"><button className="btn primary sm" disabled={!ed.note.trim()} onClick={go}>{ed.remove ? 'Remove' : 'Save'}</button><button className="btn sm" onClick={() => setEd(null)}>Cancel</button></div>
      </div>}
    </div>
  );
}

/** Read-only target the manager assigned, with progress. Uses the person's own client target, else the location target. */
/** My month in money: the targets my manager set (read only) against what is done so far. */
function MoneyTargets({ t }: { t: any }) {
  const rt = t.revenue?.target, ct = t.collection?.target;
  if (rt == null && ct == null) return <div className="banner info small">No revenue or collection target assigned to you for this month yet.</div>;
  const left = Math.max(1, Number(t.wd_total) - Number(t.wd_done) + 1);
  const box = (lbl: string, tgt: number | null, done: number) => tgt == null ? null : (
    <div className="kpi"><div className="small muted">{lbl}</div><b>{money(done)}</b> <span className="small">of {money(tgt)} · {tgt ? ((done / Number(tgt)) * 100).toFixed(0) : 0}%</span>
      <div className="small muted">need {money(Math.max(0, (Number(tgt) - done) / left))} / working day</div></div>);
  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="row small"><b>My targets this month</b><span className="spacer" /><span className="muted">set by {t.set_by ?? 'your manager'} · read only{t.style === 'total' ? ' · you decide the client mix' : ''}</span></div>
      <div className="grid two" style={{ marginTop: 6 }}>{box('Revenue', rt, Number(t.revenue?.mtd ?? 0))}{box('Collection', ct, Number(t.collection?.mtd ?? 0))}</div>
    </div>
  );
}

function TargetLine({ t, cl }: { t: any; cl: string }) {
  const r = (t?.rows ?? []).find((x: any) => x.client_location_id === cl);
  if (!r) return null;
  const m = r.mine ?? {}, done = Number(r.my_mtd?.revenue ?? 0);
  if (m.revenue != null || m.cases != null || m.collection != null) {
    const tgt = Number(m.revenue ?? 0);
    return <div className="small"><span className="pill info">Your target {m.revenue != null ? money(m.revenue) : ''}{m.cases != null ? ` (${num(m.cases)} cases)` : ''}{m.collection != null ? ` · collect ${money(m.collection)}` : ''}</span>
      {' '}done {money(done)}{tgt ? ` (${((done / tgt) * 100).toFixed(0)}%)` : ''}</div>;
  }
  if (r.location?.cases != null) {
    const ld = Number(r.location_mtd?.revenue ?? 0), lt = Number(r.location.revenue ?? 0);
    return <div className="small"><span className="pill neutral">Location target {lt ? money(lt) : `${num(r.location.cases)} cases`}</span> location done {money(ld)}{lt ? ` (${((ld / lt) * 100).toFixed(0)}%)` : ''}</div>;
  }
  return <div className="small muted">No client target{t.style === 'total' ? ' — your target is a monthly total' : ' assigned yet'}</div>;
}
