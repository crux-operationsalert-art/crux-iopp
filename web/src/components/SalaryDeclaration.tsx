import { useEffect, useState } from 'react';
import { Me, rpc } from '../lib/api';
import { label, money, time } from '../lib/format';
import { Card, ErrorBox, Loading, useLoad } from './ui';

export type Calc = { gross: number; basic: number; hra: number; special: number; pf_wage: number; pf_employee: number; pf_employer: number; pf_admin: number;
  esi_employee: number; esi_employer: number; pt: number; pt_known: boolean; in_hand: number; pf_cap: number; esi_limit: number; mode: string; amount: number;
  pf: boolean; pf_forced: boolean; plb: boolean; plb_pct: number; fixed_annual: number; plb_annual: number; ctc_annual: number; in_hand_annual: number;
  pt_state: string; notes: string[]; pf_optout_allowed: boolean };
const ST: Record<string, string> = { proposed: 'warn', approved: 'ok', rejected: 'bad', withdrawn: 'neutral' };

/** The full salary break-up, monthly and yearly (D-93). */
export function Breakup({ c }: { c: Calc }) {
  const row = (l: string, m: number | null, y: number | null, cls = '', hint?: string) => <tr className={cls}><td>{l}{hint && <div className="small muted">{hint}</div>}</td>
    <td className="num">{m == null ? '—' : money(m)}</td><td className="num">{y == null ? '—' : money(y)}</td></tr>;
  const pf = c.pf_employee + c.pf_employer + c.pf_admin, esi = c.esi_employee + c.esi_employer;
  return (
    <div className="tablewrap" tabIndex={0}><table className="small">
      <thead><tr><th>Component</th><th className="num">Monthly</th><th className="num">Yearly</th></tr></thead>
      <tbody>
        {row('Basic', c.basic, c.basic * 12, '', '50% of fixed pay — the "wages" under the labour codes (at least 50%)')}
        {row('HRA', c.hra, c.hra * 12, '', '40% of basic')}
        {row('Special allowance', c.special, c.special * 12, '', 'the rest of fixed pay')}
        {row('Fixed pay (gross)', c.gross, c.gross * 12, 'b')}
        {c.plb && row(`Performance linked bonus (${c.plb_pct}% of CTC)`, null, c.plb_annual, '', 'paid on performance, not in the monthly salary')}
        {row('CTC (cost to company)', null, c.ctc_annual, 'b')}
        <tr><th colSpan={3}>Deductions from fixed pay</th></tr>
        {c.pf ? <>{row('PF — your share (12%)', c.pf_employee, c.pf_employee * 12, '', `on ${money(c.pf_wage)} (basic, up to the ₹${c.pf_cap.toLocaleString('en-IN')} PF wage ceiling)`)}
          {row('PF — employer share (12%, part of CTC)', c.pf_employer + c.pf_admin, (c.pf_employer + c.pf_admin) * 12)}</>
          : row('PF', 0, 0, '', 'not opted (allowed only above the PF wage ceiling)')}
        {esi > 0 ? <>{row('ESI — your share (0.75%)', c.esi_employee, c.esi_employee * 12)}{row('ESI — employer share (3.25%, part of CTC)', c.esi_employer, c.esi_employer * 12)}</>
          : row('ESI', 0, 0, '', `not applicable (fixed pay above ₹${c.esi_limit.toLocaleString('en-IN')})`)}
        {row(`Professional tax (${c.pt_state})`, c.pt, c.pt_state === 'MH' && c.pt === 200 ? 2500 : c.pt * 12, '', c.pt_state === 'MH' && c.pt === 200 ? '₹300 in February' : !c.pt_known ? 'not set up for this state — HR adds it' : undefined)}
        {row('In hand (paid to your account)', c.in_hand, null, 'b', 'before income tax (TDS), if any; varies with unpaid days')}
      </tbody></table>
      <p className="small muted">PF {money(pf)} and ESI {money(esi)} a month in total. {c.notes.join(' ')}</p></div>
  );
}

/** My salary: current record, last declarations, and the declaration form (D-92). */
export function SalaryCard({ me }: { me: Me }) {
  const d = useLoad(() => rpc<any>('my_salary'), [me.person_id]);
  const [open, setOpen] = useState(false);
  if (d.loading) return <Card title="My salary"><Loading rows={2} /></Card>;
  if (d.error) return <Card title="My salary"><ErrorBox error={d.error} retry={d.reload} /></Card>;
  const s = d.data; if (!s?.eligible) return null;
  const pending = (s.declarations ?? []).find((x: any) => x.status === 'proposed');
  const last = (s.declarations ?? [])[0];
  return (
    <Card title="My salary" action={s.self_service && !open ? <button className="btn sm primary" onClick={() => setOpen(true)}>{s.current || pending ? 'Update' : 'Declare my salary'}</button> : undefined}>
      <div className="stack">
        <div>{s.current ? <>Monthly fixed pay on record: <b>{money(s.current.monthly_gross)}</b> <span className="muted small">from {s.current.effective_from}</span></> : <span className="muted">No salary on record yet.</span>}</div>
        {last && <div className="small">Your last declaration ({time(last.created_at)}): {last.mode === 'ctc' ? `CTC ${money(last.amount)} a year` : `in-hand ${money(last.amount)} a month`} ·
          <span className={`pill ${ST[last.status] ?? 'neutral'} small`}>{last.status === 'proposed' ? 'waiting for HR' : label(last.status)}</span>{last.note ? ` — ${last.note}` : ''}</div>}
        {!s.self_service && <p className="small muted">Salaries are entered by HR.</p>}
        {open && <DeclareForm me={me} defaults={{ plb: s.plb_default_pct, pf: s.pf_opted ?? true }} pending={!!pending} onDone={() => { setOpen(false); d.reload(); }} onCancel={() => setOpen(false)} />}
        <p className="small muted">Visible only to you, HR and Admin.</p>
      </div>
    </Card>
  );
}

function DeclareForm({ defaults, pending, onDone, onCancel }: { me: Me; defaults: { plb: number; pf: boolean }; pending: boolean; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ mode: 'ctc', amount: '', pf: defaults.pf, plb: false, plb_pct: String(defaults.plb), from: new Date().toISOString().slice(0, 7) });
  const [c, setC] = useState<Calc | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const args = () => ({ mode: f.mode, amount: Number(f.amount), pf: f.pf, plb: f.plb, plb_pct: Number(f.plb_pct || 0), month: f.from + '-01' });
  useEffect(() => {
    if (!(Number(f.amount) > 0)) { setC(null); return; }
    const t = window.setTimeout(async () => { try { setErr(null); setC(await rpc<Calc>('salary_preview', { p: args() })); } catch (e) { setErr(e); setC(null); } }, 400);
    return () => window.clearTimeout(t);
  }, [f.mode, f.amount, f.pf, f.plb, f.plb_pct, f.from]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <div className="row" role="radiogroup" aria-label="What do you know">
        {([['ctc', 'Annual CTC'], ['inhand', 'Monthly in-hand (what reaches my account)']] as const).map(([k, l]) =>
          <label key={k} className="row small" style={{ gap: 6 }}><input type="radio" name="mode" checked={f.mode === k} onChange={() => setF({ ...f, mode: k })} style={{ width: 'auto', minHeight: 0 }} />{l}</label>)}
      </div>
      <div className="grid two">
        <label className="field">{f.mode === 'ctc' ? 'Annual CTC (₹)' : 'Monthly in-hand (₹)'}<input type="number" inputMode="numeric" min={1} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
        <label className="field">From month<input type="month" value={f.from} onChange={(e) => e.target.value && setF({ ...f, from: e.target.value })} /></label>
      </div>
      <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={f.pf} onChange={(e) => setF({ ...f, pf: e.target.checked })} style={{ width: 20, height: 20 }} />
        PF (provident fund) — yes {c && !c.pf_optout_allowed && <span className="muted">(compulsory when basic is ₹{c.pf_cap.toLocaleString('en-IN')} a month or less)</span>}</label>
      <div className="row small" style={{ gap: 8 }}>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={f.plb} onChange={(e) => setF({ ...f, plb: e.target.checked })} style={{ width: 20, height: 20 }} />Performance linked bonus (PLB), part of CTC</label>
        {f.plb && <label className="row" style={{ gap: 6 }}>%<input type="number" min={0} max={99} value={f.plb_pct} onChange={(e) => setF({ ...f, plb_pct: e.target.value })} style={{ width: 80 }} aria-label="PLB percent of CTC" /></label>}
      </div>
      <ErrorBox error={err} />
      {c && <Breakup c={c} />}
      {pending && <p className="small muted">Saving replaces the declaration that is waiting for HR.</p>}
      <div className="row"><button className="btn primary" disabled={!c || busy} onClick={async () => { setBusy(true); setErr(null);
        try { await rpc('declare_salary', { p: { ...args(), effective_from: f.from + '-01' } }); onDone(); } catch (e) { setErr(e); } finally { setBusy(false); } }}>{busy ? 'Sending…' : 'Send to HR for approval'}</button>
        <button className="btn" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}
