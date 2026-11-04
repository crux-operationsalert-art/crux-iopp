import { useSearchParams } from 'react-router-dom';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Me, rpc, select } from '../lib/api';
import { addDays, iso, label, money, nice, num, time } from '../lib/format';
import { Card, Countdown, Empty, ErrorBox, Loading, Pill, useLoad } from '../components/ui';
import { MyAttendance } from './Attendance';
import { recon } from './Collections';
import { ClientPicker } from '../components/ClientPicker';
import DayMessage from './DayMessage';
import { Certify } from './Certify';

const OPS_LABEL = { entry: 'Received', logged: 'Entry', closure: 'Closed', cancelled: 'Cancelled' } as const;
const B = [['tat_0_1', '0–1 d', 'Received today, pending'], ['tat_1_2', '1–2 d', ''], ['tat_2_4', '2–4 d', ''], ['tat_4_7', '4–7 d', ''], ['tat_7_15', '7–15 d', ''], ['tat_15p', '15+ d', '']] as const;
type BK = (typeof B)[number][0];
type K = 'entry' | 'logged' | 'closure' | 'cancelled' | BK;
type Row = { client_location_id: string; client: string; location: string; process: string; rate: number | null; billable_event: string | null;
  source: string | null; opening_pending: number | null; tat_note: string | null } & Record<K, number | null>;
type DK = 'bill_count' | 'bill_amount' | 'rcv_lt30' | 'rcv_30_90' | 'rcv_90_180' | 'rcv_gt180' | 'rec_lt30' | 'rec_30_90' | 'rec_90_180' | 'rec_gt180';
type AK = 'ar_lt30' | 'ar_30_90' | 'ar_90_180' | 'ar_gt180';
type Money = { branch_id: string; branch: string; client_id: string; client: string; target: number | null; mtd: any; saved: any; prev: any; isHead: boolean; head: string | null; enteredBy: string | null;
  ar: Record<AK, number | null>; arInfo: any; arDirty?: boolean; carried?: boolean } & Record<DK, number | null>;
const AGES: [string, string][] = [['lt30', '< 30 d'], ['30_90', '30–90 d'], ['90_180', '3–6 m'], ['gt180', '> 6 m']];
const AKS = AGES.map(([k]) => ('ar_' + k) as AK);
const DKS: DK[] = ['bill_count', 'bill_amount', ...AGES.map(([k]) => ('rcv_' + k) as DK), ...AGES.map(([k]) => ('rec_' + k) as DK)];
const cashGap = (c: Money) => c.isHead && (DKS.some((k) => c[k] == null) || AKS.some((k) => c.ar[k] == null) || (!!c.carried && !c.arInfo && !c.arDirty));   // only the location head must fill them
const toMoney = (x: any): Money => ({ branch_id: x.branch_id, branch: x.branch, client_id: x.client_id, client: x.client, target: x.target, mtd: x.mtd ?? {}, saved: x.day ?? {}, prev: x.prev ?? {}, isHead: x.is_head !== false, head: x.head ?? null, enteredBy: x.day?.entered_by ?? null,
  ar: Object.fromEntries(AKS.map((k) => [k, x.ar?.[k] ?? null])) as Record<AK, number | null>, arInfo: x.ar,
  ...(Object.fromEntries(DKS.map((k) => [k, x.day?.[k] ?? null])) as Record<DK, number | null>) });
const sumv = (o: any, ks: string[]) => ks.reduce((t, k) => t + (Number(o?.[k] ?? 0) || 0), 0);
type Save = 'idle' | 'saving' | 'saved' | 'error';

const pendingOf = (r: Row) => B.reduce((a, [k]) => a + (r[k] ?? 0), 0);
const allBuckets = (r: Row) => B.every(([k]) => r[k] != null);
const expectedOf = (r: Row) => (r.opening_pending == null ? null : r.opening_pending + (r.entry ?? 0) - (r.closure ?? 0) - (r.cancelled ?? 0));
const rowComplete = (r: Row) => r.entry != null && r.logged != null && r.closure != null && r.cancelled != null && allBuckets(r);
/** What is wrong with a row's counts (never saved while wrong): Entry ≤ Received; Closed + Cancelled ≤ Rollover + Received. */
const rowError = (r: Row) => {
  if (r.logged != null && r.logged > (r.entry ?? 0)) return `Entry (${r.logged}) cannot be more than Received (${r.entry ?? 0}).`;
  if (r.opening_pending != null && (r.closure ?? 0) + (r.cancelled ?? 0) > r.opening_pending + (r.entry ?? 0))
    return `Closed + Cancelled (${(r.closure ?? 0) + (r.cancelled ?? 0)}) cannot be more than Rollover + Received (${r.opening_pending + (r.entry ?? 0)}).`;
  return null;
};
/** Net pendency = Rollover + Received − Closed − Cancelled (null on the first day, when there is no rollover yet). */
const netPendency = (r: Row) => expectedOf(r);
const rowTallies = (r: Row) => { const e = expectedOf(r); return e == null || pendingOf(r) === e || !!(r.tat_note ?? '').trim(); };

export default function Productivity({ me }: { me: Me }) {
  const [sp] = useSearchParams();
  const [date, setDate] = useState(() => { const d = sp.get('date'); return d && d <= me.today ? d : me.today; });
  const day = useLoad(() => rpc('my_day', { p_work_date: date }), [date]);
  const tg = useLoad(() => rpc<any>('my_targets', { p_date: date }), [date]);
  const carry = useLoad(() => rpc<any[]>('ar_carry', { p_month: date.slice(0, 7) + '-01' }).catch(() => []), [date.slice(0, 7)]);
  const [rows, setRows] = useState<Row[]>([]);
  const [cash, setCash] = useState<Money[]>([]);
  const [save, setSave] = useState<Save>('idle');
  const [err, setErr] = useState<unknown>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number>();
  const dirty = useRef({ lines: false, cash: false });
  const rsRef = useRef<Row[]>([]); const csRef = useRef<Money[]>([]);
  useEffect(() => { if (day.data) { setRows(day.data.rows); setCash((day.data.money ?? []).map(toMoney).map((c: Money) => {
    // no receivables yet this month: offer last month's closing, carried forward, to check and confirm
    const k = (carry.data ?? []).find((x: any) => x.branch_id === c.branch_id && x.client_id === c.client_id);
    return !c.arInfo && k ? { ...c, ar: Object.fromEntries(AKS.map((a) => [a, Number(k[a] ?? 0)])) as Record<AK, number | null>, carried: true } : c; })); } }, [day.data, carry.data]);
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
        const lines = rs.filter((r) => (r.entry != null || r.logged != null || r.closure != null || r.cancelled != null) && !rowError(r))
          .map((r) => ({ client_location_id: r.client_location_id, entry: r.entry ?? 0, logged: r.logged, closure: r.closure ?? 0, cancelled: r.cancelled ?? 0 }));
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
          setCash((x) => x.map((c) => (ar.some((a) => a.branch_id === c.branch_id && a.client_id === c.client_id) ? { ...c, arDirty: false, carried: false, arInfo: c.arInfo ?? { entered_at: new Date().toISOString() } } : c))); }
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

  const tot = rows.reduce((a, r) => ({ e: a.e + (r.entry ?? 0), l: a.l + (r.logged ?? 0), o: a.o + (r.opening_pending ?? 0), c: a.c + (r.closure ?? 0), x: a.x + (r.cancelled ?? 0), p: a.p + pendingOf(r),
    rev: a.rev + (r.rate ? r.rate * (r.billable_event === 'entry' ? (r.entry ?? 0) - (r.cancelled ?? 0) : r.billable_event === 'closure' ? r.closure ?? 0 : (r.entry ?? 0) + (r.closure ?? 0) - (r.cancelled ?? 0)) : 0) }),
    { e: 0, l: 0, o: 0, c: 0, x: 0, p: 0, rev: 0 });
  const incomplete = rows.filter((r) => !rowComplete(r));
  const wrong = rows.filter((r) => rowError(r));
  const untallied = rows.filter((r) => rowComplete(r) && !rowTallies(r));
  const cashMissing = cash.filter(cashGap);
  const ready = rows.length > 0 && !incomplete.length && !wrong.length && !untallied.length && !cashMissing.length;

  return (
    <div className="stack">
      <div className="topbar">
        <div><h1>My day — daily entry</h1><div className="muted">Every box is required (type 0 where there was nothing). Net pendency = Rollover + Received − Closed − Cancelled, and pending by age must add up to it. Entry can never be more than Received.</div></div>
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
              <div>
                <div className="entry-row ops entry-head"><span>Client · location</span><span className="num" title="Yesterday's net pending — carried forward, not editable">Rollover</span>
                  <span className="num" title="Cases received from the client today">Received</span><span className="num" title="Of today's received, how many were logged in the client portal (never more than received)">Entry</span>
                  <span className="num">Closed</span><span className="num">Cancelled</span><span className="num">Net pendency</span></div>
                {rows.map((r, i) => {
                  const exp = expectedOf(r), pend = pendingOf(r), tallies = exp == null || pend === exp;
                  const bad = rowError(r), np = netPendency(r);
                  const tm = teamBy(r.client_location_id);
                  return (
                    <div className="entry-row ops" key={r.client_location_id}>
                      <div className="who"><b>{r.client}</b> <span className="muted">· {r.location}</span><div className="small muted">{r.process}{r.source === 'on_behalf' ? ' · entered by manager' : ''}</div>
                        <TargetLine t={tg.data} cl={r.client_location_id} /><RowMtd t={tg.data} r={r} /></div>
                      <div className="rollover" title="Yesterday's net pending — carried forward automatically"><span className="cap" aria-hidden>Rollover</span>
                        <span className="ro">{r.opening_pending == null ? '—' : num(r.opening_pending)}</span></div>
                      {(['entry', 'logged', 'closure', 'cancelled'] as const).map((k) => { const l = OPS_LABEL[k]; return (
                        <label key={k}><span className="cap" aria-hidden>{l}</span><span className="sr">{l} for {r.client} {r.location}</span>
                          <input type="number" inputMode="numeric" min={0} step={1} disabled={locked} className={(r[k] == null && !locked ? 'need' : '') + (bad && (k === 'logged' ? r.logged != null && r.logged > (r.entry ?? 0) : k !== 'entry') ? ' bad' : '')}
                            max={k === 'logged' ? r.entry ?? undefined : undefined} value={r[k] ?? ''} onChange={(e) => change(i, k, e.target.value)} onBlur={() => persist()} /></label>); })}
                      <div className="derived small">{np == null ? <span className="muted">first day — set by pending below</span> : <><b className={np < 0 ? 'bad-text' : ''}>{num(np)}</b> pending</>}
                        {r.entry != null && r.logged != null && r.entry > r.logged ? <div className="muted">{num(r.entry - r.logged)} not yet entered</div> : null}</div>
                      {bad && <div className="banner bad small" role="alert" style={{ gridColumn: '1 / -1' }}>{bad} Not saved until corrected.</div>}
                      <div className="buckets" style={{ gridColumn: '1 / -1' }}>
                        <span className="small"><b>Pending by age</b></span>
                        {B.map(([k, l, h]) => <label key={k} title={h || undefined}><span className="cap">{l}</span>
                          <input type="number" inputMode="numeric" min={0} step={1} disabled={locked} className={r[k] == null && !locked ? 'need' : ''}
                            aria-label={`Pending ${l} for ${r.client} ${r.location}`} value={r[k] ?? ''} onChange={(e) => change(i, k, e.target.value)} onBlur={() => persist()} /></label>)}
                        <span className={`small ${allBuckets(r) && !tallies ? 'bad-text' : 'muted'}`}>
                          = <b>{num(pend)}</b> pending{exp == null ? ' (first day — sets your starting pending)' : tallies ? ' ✓ matches net pendency' : ` · net pendency is ${num(exp)} (rollover ${num(r.opening_pending)} + received ${num(r.entry ?? 0)} − closed ${num(r.closure ?? 0)} − cancelled ${num(r.cancelled ?? 0)})`}</span>
                      </div>
                      {exp != null && allBuckets(r) && !tallies && (
                        <label className="field small" style={{ gridColumn: '1 / -1' }}>Why doesn't it tally? (required — your manager sees this as a miss)
                          <input value={r.tat_note ?? ''} disabled={locked} onChange={(e) => note(i, e.target.value)} onBlur={() => persist()} placeholder="e.g. 2 cases transferred to Nashik" /></label>)}
                      {mgr && (
                        <div className="small" style={{ gridColumn: '1 / -1' }}>
                          <button className="linklike" onClick={() => { const s = new Set(open); s.has(r.client_location_id) ? s.delete(r.client_location_id) : s.add(r.client_location_id); setOpen(s); }} aria-expanded={open.has(r.client_location_id)}>
                            {open.has(r.client_location_id) ? '▾' : '▸'} Team roll-up here: {tm.length ? `Received ${num(tm.reduce((a, t) => a + t.entry, 0))} · Closed ${num(tm.reduce((a, t) => a + t.closure, 0))} · Cancelled ${num(tm.reduce((a, t) => a + t.cancelled, 0))} · pending ${num(tm.reduce((a, t) => a + (t.pending ?? 0), 0))} (${tm.length} people)` : 'nothing entered by the team yet'}</button>
                          {open.has(r.client_location_id) && <TeamLines me={me} date={date} lines={tm} onDone={team.reload} />}
                        </div>)}
                    </div>
                  );
                })}
                <div className="entry-row ops" style={{ borderBottom: 0 }}><b className="who">Total</b><b className="num">{num(tot.o)}</b><b className="num">{num(tot.e)}</b><b className="num">{num(tot.l)}</b><b className="num">{num(tot.c)}</b><b className="num">{num(tot.x)}</b>
                  <div className="derived small"><b>{num(tot.o + tot.e - tot.c - tot.x)}</b> pending<br /><span className="muted">{money(tot.rev)} est. revenue</span></div>
                  <MtdTotal t={tg.data} rows={rows} /></div>
              </div>)}
          </Card>

          {cash.length > 0 && (
            <Card title="Collections" action={<span className="small muted">one figure per client · location per day · 0 if none</span>}>
              <div>
                {cash.map((c, i) => {
                  const arT = sumv(c.ar, AKS);
                  const today = sumv(c, AGES.map(([k]) => 'rcv_' + k)), todayRec = sumv(c, AGES.map(([k]) => 'rec_' + k));
                  const mtd = sumv(c.mtd, ['r1', 'r2', 'r3', 'r4']) - sumv(c.saved, AGES.map(([k]) => 'rcv_' + k)) + today;
                  const revised = c.arInfo?.status === 'revised';
                  // one entry a month: editable on the day it is first entered, then fixed (the Collections Head can still revise it)
                  const arFixed = revised || (!!c.arInfo?.entered_at && iso(new Date(c.arInfo.entered_at)) < me.today);
                  const billedMtd = sumv(c.mtd, ['ba']) - Number(c.saved?.bill_amount ?? 0) + Number(c.bill_amount ?? 0);
                  const outstanding = arT + billedMtd - mtd;
                  const box = (k: DK, l: string, int = false) => <label key={k}><span className="cap" aria-hidden>{l}</span>
                    <input type="number" inputMode={int ? 'numeric' : 'decimal'} min={0} step={int ? 1 : 'any'} disabled={locked} className={c[k] == null && !locked ? 'need' : ''}
                      aria-label={`${l} ${c.client} ${c.branch}`} value={c[k] ?? ''} onChange={(e) => changeCash(i, k, e.target.value)} onBlur={() => persist()} /></label>;
                  const ages = (pre: 'rcv' | 'rec') => AGES.map(([k, l]) => box(`${pre}_${k}` as DK, l));
                  return (
                    <div className="entry-row showcap" key={c.branch_id + c.client_id}>
                      <div className="who"><b>{c.client}</b> <span className="muted">· {c.branch}</span>
                        <div className="small">{c.isHead ? <span className="pill info">You are the location head — required</span> : <span className="muted">Optional: {c.head ?? 'the location head'} is responsible; you can also enter or correct it{c.enteredBy ? ` (last entered by ${c.enteredBy})` : ''}</span>}</div>
                        <div className="small">Collection target: <b>{c.target != null ? money(c.target) : 'not set'}</b> <span className="muted">(set by your manager)</span></div></div>
                      {box('bill_count', 'Bills raised today (number)', true)}{box('bill_amount', 'Bills raised today (₹ total)')}
                      <div className="derived small">{(() => { const rec = sumv(c.mtd, ['c1', 'c2', 'c3', 'c4']) - sumv(c.saved, AGES.map(([k]) => 'rec_' + k)) + todayRec; const [k, t] = recon(mtd, rec);
                        return <><span className={`pill ${k}`}>{t}</span> reconciled {money(rec)}<br /></>; })()}Collected this month <b>{money(mtd)}</b>{c.target ? <><br />{((mtd / c.target) * 100).toFixed(1)}% of target</> : null}<br />Outstanding now <b>{money(outstanding)}</b></div>
                      <div className="buckets" style={{ gridColumn: '1 / -1' }}><span className="small"><b>Receivables at the start of the month</b><br /><span className="muted">{arFixed ? `fixed for the month · total ${money(arT)}` : `one entry a month · total ${money(arT)}`}</span></span>
                        {AKS.map((k, j) => <label key={k}><span className="cap">{AGES[j][1]}</span>
                          <input type="number" min={0} step="any" inputMode="decimal" disabled={locked || arFixed} className={c.ar[k] == null && !locked ? 'need' : ''}
                            aria-label={`Receivables ${AGES[j][1]} ${c.client} ${c.branch}`} value={c.ar[k] ?? ''} onChange={(e) => changeAr(i, k, e.target.value)} onBlur={() => persist()} /></label>)}</div>
                      {c.carried && !c.arInfo && <div className="small banner info row" style={{ gridColumn: '1 / -1' }}>Carried forward from last month's closing (last month's bills now under 30 days; unpaid under-30 moved to 30–90). Check, correct if needed, then confirm — it is fixed after today.
                        {!locked && <button className="btn sm" onClick={() => { setCash((x) => x.map((y, j) => (j === i ? { ...y, arDirty: true } : y))); dirty.current.cash = true; schedule(); }}>Confirm these</button>}</div>}
                      {c.isHead || c.arInfo ? <div className="small" style={{ gridColumn: '1 / -1' }}><b>Tally</b>: receivables {money(arT)} + bills raised this month {money(billedMtd)} − collected {money(mtd)} = <b>outstanding {money(outstanding)}</b>{outstanding < 0 ? <span className="bad-text"> — collected more than receivables + bills: check the receivables or the age split</span> : null}</div> : null}
                      {revised && <div className="small banner warn" style={{ gridColumn: '1 / -1' }}>Changed by the Collections Head: {c.arInfo.review_note}{c.arInfo.original ? ` (your figure ${money(sumv(c.arInfo.original, AKS))})` : ''}</div>}
                      <div className="small" style={{ gridColumn: '1 / -1' }}><b>Opening balance today</b> by age (receivables − collected till yesterday): {AGES.map(([, l], j) => `${l} ${money(Number(c.ar[AKS[j]] ?? 0) - Number(c.prev?.['r' + (j + 1)] ?? 0))}`).join(' · ')}
                        {' '}= <b>{money(arT - sumv(c.prev, ['r1', 'r2', 'r3', 'r4']))}</b>
                        <div className="muted">Month to date before today: collected {money(sumv(c.prev, ['r1', 'r2', 'r3', 'r4']))} · reconciled {money(sumv(c.prev, ['c1', 'c2', 'c3', 'c4']))} · bills {num(c.prev?.bc ?? 0)} for {money(c.prev?.ba ?? 0)}</div></div>
                      <div className="buckets" style={{ gridColumn: '1 / -1' }}><span className="small"><b>Received today</b><br /><span className="muted">{money(today)}</span></span>{ages('rcv')}</div>
                      <div className="buckets" style={{ gridColumn: '1 / -1' }}><span className="small"><b>Reconciled today</b><br /><span className="muted">{money(todayRec)}</span></span>{ages('rec')}</div>
                    </div>);
                })}
              </div>
            </Card>)}


          {!locked && rows.length > 0 && (
            <div className="stack">
              {!ready && <div className="banner warn">
                {wrong.length > 0 && <div>{wrong.length} row(s) have impossible counts: {wrong.slice(0, 3).map((r) => r.client).join(', ')}.</div>}
                {incomplete.length > 0 && <div>{incomplete.length} row(s) still have empty boxes: {incomplete.slice(0, 4).map((r) => r.client).join(', ')}{incomplete.length > 4 ? '…' : ''}.</div>}
                {untallied.length > 0 && <div>{untallied.length} row(s) don't tally — correct the figures or write why.</div>}
                {cashMissing.length > 0 && <div>Collections incomplete for {cashMissing.length} client(s): {cashMissing.slice(0, 3).map((c) => c.client).join(', ')}.</div>}
              </div>}
              {!confirm && <button className="btn primary" disabled={!ready} onClick={() => setConfirm(true)}>Review and submit</button>}
            </div>)}
          {confirm && (
            <Card title="Submit these figures?">
              <p>{nice(date)}: Rollover <b>{num(tot.o)}</b> + Received <b>{num(tot.e)}</b> − Closed <b>{num(tot.c)}</b> − Cancelled <b>{num(tot.x)}</b> = pending <b>{num(tot.p)}</b>; Entry <b>{num(tot.l)}</b> of {num(tot.e)} received; across {rows.length} row(s).</p>
              <p className="muted small">After you submit, the figures are locked; your manager can correct them with a note, and only an Admin can reopen the day. Submitting also marks your attendance.</p>
              <div className="row"><button className="btn primary" disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit'}</button><button className="btn" onClick={() => setConfirm(false)}>Back</button></div>
            </Card>)}
          {(st === 'submitted' || st === 'manager_entered') && <div className="banner ok">Submitted {day.data.status.submitted_at ? time(day.data.status.submitted_at) : ''}. Waiting for your manager's review.</div>}
          {mgr && teamOnly.length > 0 && (
            <Card title="Team figures on clients you don't enter yourself">
              {teamOnly.map((cl) => { const tm = teamBy(cl); return (
                <Fragment key={cl}>
                  <button className="linklike" onClick={() => { const s = new Set(open); s.has(cl) ? s.delete(cl) : s.add(cl); setOpen(s); }} aria-expanded={open.has(cl)}>
                    {open.has(cl) ? '▾' : '▸'} <b>{tm[0].client}</b> · {tm[0].location}: Received {num(tm.reduce((a, t) => a + t.entry, 0))} · Closed {num(tm.reduce((a, t) => a + t.closure, 0))} · Cancelled {num(tm.reduce((a, t) => a + t.cancelled, 0))} · pending {num(tm.reduce((a, t) => a + (t.pending ?? 0), 0))} ({tm.length})</button>
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
          <td className="num" title="Received">R {t.entry}</td><td className="num" title="Closed">C {t.closure}</td><td className="num" title="Cancelled">X {t.cancelled}</td><td className="num" title="Pending">P {t.pending ?? '—'}</td>
          <td><div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn sm" onClick={() => setEd({ p: t, e: String(t.entry), c: String(t.closure), x: String(t.cancelled), note: '', remove: false })}>Edit</button>
            <button className="btn sm" onClick={() => setEd({ p: t, e: '0', c: '0', x: '0', note: '', remove: true })}>Remove</button></div></td></tr>))}</tbody></table>
      {ed && <div className="banner info stack">
        <b>{ed.remove ? `Remove ${ed.p.full_name}'s entry for ${ed.p.client}` : `Correct ${ed.p.full_name}'s ${ed.p.client} entry`}</b>
        {!ed.remove && <div className="row">{(['e', 'c', 'x'] as const).map((k) => <label key={k} className="field">{{ e: 'Received', c: 'Closed', x: 'Cancelled' }[k]}
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

/** Opening pending (till yesterday) and month to date for one client row: before today + what is typed today. */
function RowMtd({ t, r }: { t: any; r: Row }) {
  const x = (t?.rows ?? []).find((y: any) => y.client_location_id === r.client_location_id)?.prev ?? { entry: 0, closure: 0, cancelled: 0, revenue: 0 };
  const e = Number(x.entry) + (r.entry ?? 0), c = Number(x.closure) + (r.closure ?? 0), k = Number(x.cancelled) + (r.cancelled ?? 0);
  const rate = Number(r.rate ?? 0), todayRev = rate * ((r.billable_event === 'closure' ? (r.closure ?? 0) : (r.entry ?? 0) - (r.cancelled ?? 0)));
  return <div className="small">
    <div className="muted">Month to date incl. today: Received {num(e)} · Closed {num(c)} · Cancelled {num(k)} · billable {num(e - k)} · {money(Number(x.revenue) + todayRev)}</div>
  </div>;
}

function MtdTotal({ t, rows }: { t: any; rows: Row[] }) {
  const m = rows.reduce((a, r) => { const x = (t?.rows ?? []).find((y: any) => y.client_location_id === r.client_location_id)?.prev ?? {};
    const rate = Number(r.rate ?? 0), today = rate * (r.billable_event === 'closure' ? (r.closure ?? 0) : (r.entry ?? 0) - (r.cancelled ?? 0));
    return { e: a.e + Number(x.entry ?? 0) + (r.entry ?? 0), c: a.c + Number(x.closure ?? 0) + (r.closure ?? 0), x: a.x + Number(x.cancelled ?? 0) + (r.cancelled ?? 0),
      o: a.o + Number(r.opening_pending ?? 0), rev: a.rev + Number(x.revenue ?? 0) + today }; }, { e: 0, c: 0, x: 0, o: 0, rev: 0 });
  return <div className="small" style={{ gridColumn: '1 / -1' }}><b>Month to date incl. today</b>: Received {num(m.e)} · Closed {num(m.c)} · Cancelled {num(m.x)} · billable (received − cancelled) {num(m.e - m.x)} · <b>{money(m.rev)}</b></div>;
}

