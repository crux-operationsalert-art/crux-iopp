import { useState } from 'react';
import { has, Me, rpc } from '../lib/api';
import { label, money, num, time } from '../lib/format';
import { Card, Empty, ErrorBox, Kpi, Loading, Tabs, useLoad } from '../components/ui';
import { Modal } from './Tasks';

type Line = { person_id: string; full_name: string; designation: string | null; manager: string | null; location: string | null; status: string | null; gross: number;
  days_in_month: number; day_rate: number; present_days: number; paid_leave_days: number; off_days: number; unpaid_days: number; not_employed_days: number;
  unpaid_override: number | null; override_reason: string | null; attendance_deduction: number; earned_gross: number; basic: number; pf_applicable: boolean;
  pf_employee: number; incentives: number; arrears: number; other_deductions: number; net_pay: number; flags: string[]; pending_adjustments: number;
  bank: string | null; ifsc: string | null; account_last4: string | null };
type Adj = { id: string; person_id: string; full_name: string; kind: string; amount: number; reason: string; purpose: string | null; period_from: string | null;
  period_to: string | null; status: string; proposed_by: string | null; proposed_at: string; decided_by: string | null; decision_note: string | null };
const n = (v: unknown) => Number(v ?? 0) || 0;
const ST: Record<string, [string, string]> = { draft: ['warn', 'Draft — HR preparing'], review: ['info', 'With managers for review'], approved: ['ok', 'Approved and locked'], sent: ['ok', 'Sent to Accounts'] };
const KIND: Record<string, string> = { incentive: 'Incentive', arrear: 'Arrears', deduction: 'Deduction', increment: 'Increment (salary change)' };

/** Monthly payroll: HR prepares from salary + attendance + approved adjustments; managers review their team and propose;
 *  HR / Admin approve, lock, download and mark sent to Accounts. The app pays nothing. */
export default function Payroll({ me }: { me: Me }) {
  const hr = has(me, 'admin', 'hr_admin');
  const [month, setMonth] = useState(() => { const d = new Date(me.today + 'T12:00:00'); d.setDate(1); if (Number(me.today.slice(8)) < 20) d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 8) + '01'; });
  const [tab, setTab] = useState<'sheet' | 'adjust' | 'rules'>('sheet');
  const sheet = useLoad(() => rpc<Line[]>('payroll_sheet', { p_month: month }), [month]);
  const adj = useLoad(() => rpc<Adj[]>('payroll_adjustments_list', { p_month: month }), [month]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [ok, setOk] = useState('');
  const [open, setOpen] = useState<Line | null>(null);
  const [propose, setPropose] = useState<string | null>(null);
  const rows = (sheet.data ?? []) as Line[];
  const status = rows[0]?.status ?? null;
  const locked = status === 'approved' || status === 'sent';
  const pend = ((adj.data ?? []) as Adj[]).filter((a) => a.status === 'proposed');
  const tot = rows.reduce((a, r) => ({ g: a.g + n(r.gross), e: a.e + n(r.earned_gross), d: a.d + n(r.attendance_deduction), pf: a.pf + n(r.pf_employee), i: a.i + n(r.incentives),
    ar: a.ar + n(r.arrears), o: a.o + n(r.other_deductions), net: a.net + n(r.net_pay) }), { g: 0, e: 0, d: 0, pf: 0, i: 0, ar: 0, o: 0, net: 0 });
  const reload = () => { sheet.reload(); adj.reload(); };
  const act = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); setErr(null); setOk(''); try { await fn(); setOk(msg); reload(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  const mine = !hr && rows.length === 1 && rows[0].person_id === me.person_id;
  const monLabel = new Date(month + 'T12:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  return (
    <div className="stack">
      <div className="topbar"><div><h1>Payroll</h1><div className="muted">{hr ? 'Prepare from salary, attendance and approved adjustments → managers review → approve → download for Accounts. The app does not pay anyone.'
        : mine ? 'Your pay statement for the month, once HR has approved it.' : 'Review your team\'s pay for the month and propose incentives, deductions, arrears or increments with a reason. HR approves.'}</div></div>
        <label className="field">Month<input type="month" value={month.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value + '-01')} /></label></div>
      {status && <div className={`banner ${ST[status]?.[0] ?? 'info'}`}>{monLabel}: <b>{ST[status]?.[1] ?? label(status)}</b>{hr && pend.length > 0 ? ` · ${pend.length} proposal(s) waiting for you` : ''}</div>}
      <ErrorBox error={err} />{ok && <div className="banner ok" role="status">{ok}</div>}
      {hr && <div className="row">
        {!locked && <button className="btn primary" disabled={busy} onClick={() => act(() => rpc('payroll_prepare', { p_month: month }), 'Prepared from the latest salaries, attendance and approved adjustments.')}>{status ? 'Refresh from attendance' : `Prepare ${monLabel}`}</button>}
        {status === 'draft' && <button className="btn" disabled={busy} onClick={() => act(() => rpc('payroll_set_status', { p_month: month, p_status: 'review' }), 'Sent to managers for review; they have been notified.')}>Send to managers for review</button>}
        {(status === 'draft' || status === 'review') && <button className="btn" disabled={busy || pend.some((a) => a.kind !== 'increment')} title={pend.length ? 'Decide the waiting proposals first' : ''}
          onClick={() => window.confirm(`Approve and lock ${monLabel} payroll (net ${money(tot.net)})? It is recalculated once more, then locked.`) && act(() => rpc('payroll_set_status', { p_month: month, p_status: 'approved' }), 'Approved and locked. Everyone can see their pay statement.')}>Approve and lock</button>}
        {status === 'approved' && <button className="btn" disabled={busy} onClick={() => { const note = window.prompt('Note for the record (e.g. "Emailed to Accounts on 3 Dec")'); if (note !== null) act(() => rpc('payroll_set_status', { p_month: month, p_status: 'sent', p_note: note || 'Sent to Accounts' }), 'Marked as sent to Accounts.'); }}>Mark sent to Accounts</button>}
        {locked && has(me, 'admin') && <button className="btn danger" disabled={busy} onClick={() => { const r = window.prompt('Reason for reopening this approved payroll'); if (r) act(() => rpc('payroll_set_status', { p_month: month, p_status: 'draft', p_note: r }), 'Reopened as draft.'); }}>Reopen (Admin)</button>}
        {rows.length > 0 && <button className="btn" onClick={() => download(rows, month, hr)}>Download for Accounts (Excel)</button>}
      </div>}
      {!hr && !mine && rows.length > 0 && <div className="row"><button className="btn" onClick={() => download(rows, month, false)}>Download my team (Excel)</button></div>}
      <Tabs tabs={[['sheet', mine ? 'My statement' : 'Pay sheet'], ['adjust', `Incentives, deductions, arrears${pend.length ? ` (${pend.length} waiting)` : ''}`], ['rules', 'How it is worked out']]} value={tab} onChange={setTab} />
      {tab === 'sheet' && <>
        {sheet.loading ? <Loading rows={4} /> : <ErrorBox error={sheet.error} retry={sheet.reload} />}
        {sheet.data && (rows.length === 0 ? <Card><Empty>{hr ? `No payroll for ${monLabel} yet. Tap Prepare.` : mine ? 'Your statement appears once HR approves the month.' : `HR has not prepared ${monLabel} yet, or nobody in your team is on payroll.`}</Empty></Card> : <>
          {!mine && <div className="grid kpis">
            <Kpi label="People" value={num(rows.length)} sub={`${rows.filter((r) => r.flags?.length).length} need attention`} />
            <Kpi label="Gross (salary)" value={money(tot.g)} sub={`− attendance ${money(tot.d)} = earned ${money(tot.e)}`} />
            <Kpi label="Additions" value={money(tot.i + tot.ar)} sub={`incentives ${money(tot.i)} · arrears ${money(tot.ar)}`} />
            <Kpi label="Net pay to deposit" value={money(tot.net)} sub={`after PF ${money(tot.pf)} and deductions ${money(tot.o)}`} />
          </div>}
          <Card>
            <div className="tablewrap" tabIndex={0}><table>
              <thead><tr><th>Person</th><th className="num">Gross</th><th className="num" title="Present · paid leave · weekly off · unpaid">Days P · L · O · U</th><th className="num">Attendance deduction</th>
                <th className="num">Earned</th><th className="num">PF</th><th className="num">Incentive</th><th className="num">Arrears</th><th className="num">Deductions</th><th className="num">In hand</th><th /></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.person_id}>
                <td><b>{r.full_name}</b><div className="small muted">{r.designation ?? ''}{r.manager ? ` · ${r.manager}` : ''}</div>
                  {r.flags?.map((f) => <span key={f} className="pill warn small">{f}</span>)}{r.pending_adjustments > 0 && <span className="pill info small">{r.pending_adjustments} proposal(s)</span>}</td>
                <td className="num">{money(r.gross)}</td>
                <td className="num small">{num(r.present_days)} · {num(r.paid_leave_days)} · {num(r.off_days)} · <b className={n(r.unpaid_days) ? 'bad-text' : ''}>{num(r.unpaid_days)}</b>{r.unpaid_override != null ? ' ✎' : ''}{r.not_employed_days ? <div className="muted">{r.not_employed_days} d not employed</div> : null}</td>
                <td className="num">{money(r.attendance_deduction)}</td><td className="num">{money(r.earned_gross)}</td>
                <td className="num">{r.pf_applicable ? money(r.pf_employee) : <span className="muted small">n/a</span>}</td>
                <td className="num">{money(r.incentives)}</td><td className="num">{money(r.arrears)}</td><td className="num">{money(r.other_deductions)}</td>
                <td className="num"><b>{money(r.net_pay)}</b></td>
                <td><div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn sm" onClick={() => setOpen(r)}>Details</button>
                  {!mine && !locked && <button className="btn sm" onClick={() => setPropose(r.person_id)}>{hr ? 'Add' : 'Propose'}</button>}</div></td></tr>)}
                {!mine && <tr><th>Total</th><th className="num">{money(tot.g)}</th><th /><th className="num">{money(tot.d)}</th><th className="num">{money(tot.e)}</th><th className="num">{money(tot.pf)}</th>
                  <th className="num">{money(tot.i)}</th><th className="num">{money(tot.ar)}</th><th className="num">{money(tot.o)}</th><th className="num">{money(tot.net)}</th><th /></tr>}</tbody></table></div>
            <p className="small muted">In hand = earned gross + incentives + arrears − employee PF − deductions. Earned gross = gross − (unpaid days + days not employed) × one day's pay.</p>
          </Card></>)}
      </>}
      {tab === 'adjust' && <Adjustments me={me} hr={hr} month={month} list={(adj.data ?? []) as Adj[]} loading={adj.loading} locked={locked} onChange={reload} onAdd={() => setPropose('')} />}
      {tab === 'rules' && <Rules />}
      {open && <Modal title={`${open.full_name} — ${monLabel}`} onClose={() => setOpen(null)}><Statement r={open} hr={hr} month={month} locked={locked} onDone={() => { setOpen(null); reload(); }} /></Modal>}
      {propose !== null && <Modal title={hr ? 'Add an incentive, deduction, arrears or increment' : 'Propose to HR'} onClose={() => setPropose(null)}>
        <ProposeForm hr={hr} month={month} person={propose || null} onDone={(m) => { setPropose(null); setOk(m); reload(); }} /></Modal>}
    </div>
  );
}

function Statement({ r, hr, month, locked, onDone }: { r: Line; hr: boolean; month: string; locked: boolean; onDone: () => void }) {
  const [u, setU] = useState(r.unpaid_override != null ? String(r.unpaid_override) : '');
  const [why, setWhy] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const L = (a: string, b: React.ReactNode, strong = false) => <tr><td>{a}</td><td className="num">{strong ? <b>{b}</b> : b}</td></tr>;
  return (
    <div className="stack">
      <table className="small"><tbody>
        {L('Monthly gross', money(r.gross))}
        {L(`One day's pay`, `${money(r.day_rate)}`)}
        {L('Days: present · paid leave · weekly off / holiday', `${num(r.present_days)} · ${num(r.paid_leave_days)} · ${num(r.off_days)}`)}
        {L('Unpaid days' + (r.unpaid_override != null ? ` (set by HR: ${r.override_reason})` : ''), num(r.unpaid_days))}
        {r.not_employed_days ? L('Days before joining / after leaving', num(r.not_employed_days)) : null}
        {L('Attendance deduction', `− ${money(r.attendance_deduction)}`)}
        {L('Earned gross', money(r.earned_gross), true)}
        {L('Basic (for PF)', money(r.basic))}
        {L('Employee PF', r.pf_applicable ? `− ${money(r.pf_employee)}` : 'not applicable')}
        {L('Incentives', `+ ${money(r.incentives)}`)}{L('Arrears', `+ ${money(r.arrears)}`)}{L('Other deductions', `− ${money(r.other_deductions)}`)}
        {L('In hand (to be deposited)', money(r.net_pay), true)}
        {hr && L('Bank', r.bank ? `${r.bank} · ${r.ifsc ?? ''} · a/c ending ${r.account_last4 ?? '—'}` : 'not in profile')}
      </tbody></table>
      {hr && !locked && <div className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <b className="small">Correct unpaid days (only when attendance is wrong and cannot be fixed there)</b>
        <div className="row" style={{ alignItems: 'end' }}><label className="field">Unpaid days<input type="number" min={0} step={0.5} value={u} onChange={(e) => setU(e.target.value)} placeholder={String(r.unpaid_days)} /></label>
          <label className="field" style={{ flex: 1 }}>Reason<input value={why} onChange={(e) => setWhy(e.target.value)} /></label></div>
        <ErrorBox error={err} />
        <div className="row"><button className="btn sm primary" disabled={u === '' || !why.trim()} onClick={async () => { try { await rpc('payroll_override', { p_month: month, p_person: r.person_id, p_unpaid_days: Number(u), p_reason: why }); onDone(); } catch (e) { setErr(e); } }}>Save</button>
          {r.unpaid_override != null && <button className="btn sm" onClick={async () => { try { await rpc('payroll_override', { p_month: month, p_person: r.person_id, p_unpaid_days: null, p_reason: null }); onDone(); } catch (e) { setErr(e); } }}>Back to attendance</button>}</div>
      </div>}
    </div>
  );
}

function ProposeForm({ hr, month, person, onDone }: { hr: boolean; month: string; person: string | null; onDone: (msg: string) => void }) {
  const ppl = useLoad(() => rpc<any[]>('payroll_people'), []);
  const [f, setF] = useState({ person: person ?? '', kind: 'incentive', amount: '', reason: '', purpose: '', from: '', to: '' });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const arrear = f.kind === 'arrear';
  return (
    <div className="stack">
      <div className="grid two">
        <label className="field">Person<select value={f.person} onChange={(e) => setF({ ...f, person: e.target.value })}><option value="">Choose…</option>
          {(ppl.data ?? []).map((p: any) => <option key={p.person_id} value={p.person_id}>{p.full_name}{p.designation ? ` · ${p.designation}` : ''}</option>)}</select></label>
        <label className="field">What<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field">{f.kind === 'increment' ? 'Increase in monthly gross ₹' : 'Amount ₹'}<input type="number" min={1} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
        <label className="field">Reason (required)<input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder={f.kind === 'deduction' ? 'e.g. Advance recovery 2 of 4' : f.kind === 'increment' ? 'e.g. Annual review, 10%' : 'e.g. Highest closures in the zone'} /></label>
        {arrear && <><label className="field">What the arrears are for (required)<input value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder="e.g. Increment due from September not paid" /></label>
          <label className="field">Period from<input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
          <label className="field">Period to<input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label></>}
      </div>
      <p className="small muted">{hr ? (f.kind === 'increment' ? 'An increment changes the salary from this month (it appears in the salary history).' : 'Added by HR: counts in this month\'s pay straight away.') : 'HR approves or rejects it; you are told either way. Nothing changes until then.'}</p>
      <ErrorBox error={err} />
      <button className="btn primary" disabled={busy || !f.person || !(Number(f.amount) > 0) || !f.reason.trim() || (arrear && (!f.purpose.trim() || !f.from))} onClick={async () => {
        setBusy(true); setErr(null);
        try { await rpc('payroll_adjust', { p_month: month, p_person: f.person, p_kind: f.kind, p_amount: Number(f.amount), p_reason: f.reason, p_purpose: f.purpose || null, p_from: f.from || null, p_to: f.to || null });
          onDone(hr && f.kind !== 'increment' ? 'Added.' : 'Sent to HR for approval.'); }
        catch (e) { setErr(e); } finally { setBusy(false); }
      }}>{hr && f.kind !== 'increment' ? 'Add' : 'Send to HR'}</button>
    </div>
  );
}

function Adjustments({ me, hr, month, list, loading, locked, onChange, onAdd }: { me: Me; hr: boolean; month: string; list: Adj[]; loading: boolean; locked: boolean; onChange: () => void; onAdd: () => void }) {
  const [err, setErr] = useState<unknown>(null);
  void me;
  const decide = async (a: Adj, ok: boolean) => {
    const note = ok ? null : window.prompt('Why is it not approved? (the proposer is told)');
    if (!ok && !note) return;
    const from = ok && a.kind === 'increment' ? window.prompt('Increment effective from (YYYY-MM-DD)', month) : null;
    try { await rpc('payroll_decide', { p_id: a.id, p_approve: ok, p_note: note, p_effective_from: from || null }); onChange(); } catch (e) { setErr(e); }
  };
  return (
    <Card title="Incentives, deductions, arrears and increments" action={!locked && <button className="btn sm primary" onClick={onAdd}>{hr ? '+ Add' : '+ Propose'}</button>}>
      <ErrorBox error={err} />
      {loading ? <Loading rows={2} /> : list.length === 0 ? <Empty>Nothing for this month.</Empty> :
        <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Person</th><th>What</th><th className="num">Amount</th><th>Reason</th><th>Status</th><th /></tr></thead>
          <tbody>{list.map((a) => <tr key={a.id}><td>{a.full_name}</td><td>{KIND[a.kind] ?? a.kind}</td><td className="num">{money(a.amount)}</td>
            <td className="small">{a.reason}{a.purpose ? <div className="muted">For: {a.purpose}{a.period_from ? ` (${a.period_from}${a.period_to ? ` to ${a.period_to}` : ''})` : ''}</div> : null}
              <div className="muted">by {a.proposed_by ?? '—'} · {time(a.proposed_at)}</div></td>
            <td><span className={`pill ${a.status === 'approved' ? 'ok' : a.status === 'rejected' ? 'bad' : 'warn'}`}>{label(a.status)}</span>{a.decision_note ? <div className="small muted">{a.decision_note}</div> : null}</td>
            <td>{hr && a.status === 'proposed' && <div className="row"><button className="btn sm primary" onClick={() => decide(a, true)}>Approve</button><button className="btn sm" onClick={() => decide(a, false)}>Reject</button></div>}</td></tr>)}</tbody></table></div>}
    </Card>
  );
}

function Rules() {
  return (
    <Card title="How the pay sheet is worked out">
      <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
        <li><b>Gross</b>: the monthly gross in force on the last day of the month (HR repository → person → Salary history).</li>
        <li><b>One day's pay</b> = gross ÷ days in the month (Settings → Payroll can change this to ÷ 26 or ÷ working days).</li>
        <li><b>Unpaid days</b> = days marked Absent or Unplanned leave in the attendance the managers confirmed (a half day counts ½). Days before joining or after leaving are not paid. Days still ahead in the month count as worked.</li>
        <li><b>Earned gross</b> = gross − unpaid days × one day's pay.</li>
        <li><b>Basic</b> = 50% of earned gross. <b>Employee PF</b> = 12% of basic, on basic up to ₹15,000 (so at most ₹1,800), only when PF is applicable and opted (set in the person's employment details).</li>
        <li><b>In hand</b> = earned gross + approved incentives + approved arrears − PF − approved deductions.</li>
        <li>Business Associates (partners) are paid by their agreement, not through payroll.</li>
        <li>Flow: HR prepares → sends to managers for review → managers propose (with reason) → HR approves the proposals → HR / Admin approve and lock → download for Accounts → mark sent. Every step is in the activity log.</li>
      </ol>
      <p className="small muted">Employer PF, ESI, professional tax and TDS are not calculated; HR adds them as deductions with a reason until those rules are set.</p>
    </Card>
  );
}

async function download(rows: Line[], month: string, hr: boolean) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Payroll ' + month.slice(0, 7));
  const cols = ['Name', 'Designation', 'Manager', 'Gross', 'Days in month', 'Present', 'Paid leave', 'Weekly off', 'Unpaid days', 'Not employed', 'Attendance deduction', 'Earned gross',
    'Basic', 'PF', 'Incentives', 'Arrears', 'Deductions', 'In hand', ...(hr ? ['Bank', 'IFSC', 'A/c last 4'] : [])];
  ws.addRow(cols).font = { bold: true };
  rows.forEach((r) => ws.addRow([r.full_name, r.designation ?? '', r.manager ?? '', n(r.gross), r.days_in_month, n(r.present_days), n(r.paid_leave_days), n(r.off_days), n(r.unpaid_days),
    r.not_employed_days, n(r.attendance_deduction), n(r.earned_gross), n(r.basic), n(r.pf_employee), n(r.incentives), n(r.arrears), n(r.other_deductions), n(r.net_pay),
    ...(hr ? [r.bank ?? '', r.ifsc ?? '', r.account_last4 ?? ''] : [])]));
  const last = rows.length + 1;
  const tr = ws.addRow(['Total']); tr.font = { bold: true };
  ['D', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R'].forEach((c) => { ws.getCell(`${c}${last + 1}`).value = { formula: `SUM(${c}2:${c}${last})` } as any; });
  ['D', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R'].forEach((c) => { ws.getColumn(c).numFmt = '₹#,##0'; });
  ws.columns.forEach((c, i) => { c.width = i < 3 ? 24 : 13; });
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const el = document.createElement('a'); el.href = url; el.download = `CRUX_payroll_${month.slice(0, 7)}.xlsx`; el.click(); URL.revokeObjectURL(url);
}
