import { useState } from 'react';
import { has, Me, rpc } from '../lib/api';
import { money, nice, num } from '../lib/format';
import { Card, Empty, ErrorBox, Kpi, Loading, useLoad } from '../components/ui';
import { Modal } from './Tasks';

export const AR: [string, string][] = [['ar_lt30', '< 30 days'], ['ar_30_90', '30–90 days'], ['ar_90_180', '3–6 months'], ['ar_gt180', '> 6 months']];
const RCV = ['r1', 'r2', 'r3', 'r4'], REC = ['c1', 'c2', 'c3', 'c4'];
const n = (v: unknown) => Number(v ?? 0) || 0;
const sumK = (o: any, ks: string[]) => ks.reduce((s, k) => s + n(o?.[k]), 0);
const arTotal = (a: any) => sumK(a, AR.map(([k]) => k));
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : '—');
/** D-57: reconciliation status for the month (reconciled may go over: earlier receipts matched this month). */
export const recon = (rcv: number, rec: number): [string, string] => rcv === 0 && rec === 0 ? ['neutral', 'Nothing yet'] : rec > rcv ? ['active', 'Reconciled (+ earlier)']
  : rec === rcv ? ['active', 'Reconciled'] : rec === 0 ? ['overdue', 'Pending'] : ['pending', 'Partly reconciled'];

type Row = { branch_id: string; client_id: string; location: string; client: string; zone: string | null; head: string | null; ar: any; target: number | null; mtd: any; cases: number };

/** Collections for the month, next to operations: receivables by age (monthly), target, received / reconciled by age (daily, summed), balance, bills. */
export default function CollectionsPerf({ me, month }: { me: Me; month: string }) {
  const v = useLoad(() => rpc<{ month: string; as_of: string; can_review: boolean; rows: Row[] }>('collections_view', { p_month: month }), [month]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [tgt, setTgt] = useState<Row | null>(null);
  const [all, setAll] = useState(false);
  const mgr = me.manages_operations || me.manages_collections || has(me, 'admin', 'ops_head', 'collections_head', 'zm', 'bm', 'ba', 'auditor', 'leadership');
  const canTarget = has(me, 'admin', 'collections_head', 'ops_head', 'zm');
  if (v.loading) return <Loading rows={3} />;
  if (v.error) return <ErrorBox error={v.error} retry={v.reload} />;
  const every = v.data?.rows ?? [];
  const active = (r: Row) => !!r.ar || r.target != null || !!r.mtd;
  const rows = all ? every : every.filter(active);
  const T = rows.reduce((t, r) => ({ ar: t.ar + arTotal(r.ar), tg: t.tg + n(r.target), rcv: t.rcv + sumK(r.mtd, RCV), rec: t.rec + sumK(r.mtd, REC),
    bc: t.bc + n(r.mtd?.bc), ba: t.ba + n(r.mtd?.ba), cs: t.cs + n(r.cases),
    b: AR.map((_, i) => t.b[i] + n(r.ar?.[AR[i][0]])), rb: RCV.map((k, i) => t.rb[i] + n(r.mtd?.[k])) }),
    { ar: 0, tg: 0, rcv: 0, rec: 0, bc: 0, ba: 0, cs: 0, b: [0, 0, 0, 0], rb: [0, 0, 0, 0] });
  return (
    <div className="stack">
      <div className="grid kpis">
        <Kpi label="Receivables (start of month)" value={money(T.ar)} sub={AR.map(([, l], i) => `${l} ${money(T.b[i])}`).join(' · ')} />
        <Kpi label="Collected this month" value={money(T.rcv)} sub={T.tg ? `of ${money(T.tg)} target · ${pct(T.rcv, T.tg)}` : 'no collection target set'} />
        <Kpi label="Balance to collect" value={money(T.ar - T.rcv)} sub={`Receivables − collected this month`} />
        <Kpi label="Reconciled this month" value={money(T.rec)} sub={`${pct(T.rec, T.rcv)} of collected · ${T.rcv - T.rec > 0 ? `${money(T.rcv - T.rec)} not yet matched` : 'fully matched'}${T.tg ? ` · ${pct(T.rec, T.tg)} of target` : ''}`} />
        <Kpi label="Bills raised" value={money(T.ba)} sub={`${num(T.bc)} bills${mgr && T.cs ? ` · ${money(T.ba / T.cs)} per case (${num(T.cs)} cases)` : ''}`} />
      </div>
      <Card title="Client-wise collections" action={<label className="row small" style={{ gap: 6 }}><input type="checkbox" style={{ width: 'auto', minHeight: 0 }} checked={all} onChange={(e) => setAll(e.target.checked)} />
        All clients served ({every.length}) · as on {v.data ? nice(v.data.as_of) : ''}</label>}>
        {rows.length === 0 ? <Empty>No receivables, collections or targets entered for this month yet. Location heads enter them in My day{canTarget ? '; tick “All clients served” to set targets' : ''}.</Empty> :
          <div className="tablewrap" tabIndex={0}><table>
            <thead>
              <tr><th rowSpan={2}>Client · location</th><th colSpan={5} className="num" style={{ textAlign: 'center' }}>Receivables (monthly)</th><th className="num" rowSpan={2}>Target</th>
                <th colSpan={5} className="num" style={{ textAlign: 'center' }}>Collected this month</th><th className="num" rowSpan={2}>Reconciled</th><th className="num" rowSpan={2}>Balance</th>
                <th className="num" rowSpan={2}>Bills</th>{mgr && <th className="num" rowSpan={2}>Billed / case</th>}<th rowSpan={2}></th></tr>
              <tr>{AR.map(([k, l]) => <th key={k} className="num small">{l}</th>)}<th className="num small">Total</th>
                {AR.map(([k, l]) => <th key={'c' + k} className="num small">{l}</th>)}<th className="num small">Total · vs tgt</th></tr>
            </thead>
            <tbody>{rows.map((r) => { const ar = arTotal(r.ar), rc = sumK(r.mtd, RCV);
              return <tr key={r.branch_id + r.client_id}>
                <td><b>{r.client}</b> <span className="muted">· {r.location}</span><div className="small muted">{r.head ?? '—'}</div>
                  {r.ar?.status === 'revised' && <div className="small" title={r.ar.review_note}><span className="pill warn">Revised by {r.ar.reviewer}</span> {r.ar.review_note}{r.ar.original ? ` (entered ${money(arTotal(r.ar.original))})` : ''}</div>}</td>
                {AR.map(([k]) => <td key={k} className="num">{r.ar ? money(r.ar[k]) : <span className="pill warn">not entered</span>}</td>)}<td className="num"><b>{money(ar)}</b></td>
                <td className="num">{r.target != null ? money(r.target) : '—'}{canTarget && <div><button className="linklike small" onClick={() => setTgt(r)}>{r.target != null ? 'change' : 'set'}</button></div>}</td>
                {RCV.map((k) => <td key={k} className="num">{money(r.mtd?.[k])}</td>)}<td className="num"><b>{money(rc)}</b><div className="small muted">{pct(rc, n(r.target))}</div></td>
                <td className="num">{money(sumK(r.mtd, REC))}{(() => { const [k, t] = recon(rc, sumK(r.mtd, REC)); return <div><span className={`pill ${k}`}>{t}</span></div>; })()}
                  <div className="small muted">{rc - sumK(r.mtd, REC) > 0 ? `${money(rc - sumK(r.mtd, REC))} to match` : ''}</div></td>
                <td className="num">{money(ar - rc)}</td>
                <td className="num">{money(r.mtd?.ba)}<div className="small muted">{num(r.mtd?.bc)} bills</div></td>
                {mgr && <td className="num">{n(r.cases) > 0 ? money(n(r.mtd?.ba) / n(r.cases)) : '—'}<div className="small muted">{num(r.cases)} cases</div></td>}
                <td>{v.data!.can_review && <button className="btn sm" onClick={() => setEdit(r)}>Dispute / change</button>}</td>
              </tr>; })}
              <tr style={{ fontWeight: 700 }}><td>Total</td>{T.b.map((x, i) => <td key={i} className="num">{money(x)}</td>)}<td className="num">{money(T.ar)}</td><td className="num">{money(T.tg)}</td>
                {T.rb.map((x, i) => <td key={i} className="num">{money(x)}</td>)}<td className="num">{money(T.rcv)}<div className="small muted">{pct(T.rcv, T.tg)}</div></td>
                <td className="num">{money(T.rec)}<div className="small muted">{pct(T.rec, T.rcv)}</div></td><td className="num">{money(T.ar - T.rcv)}</td><td className="num">{money(T.ba)}<div className="small muted">{num(T.bc)} bills</div></td>
                {mgr && <td className="num">{T.cs ? money(T.ba / T.cs) : '—'}</td>}<td /></tr>
            </tbody></table></div>}
        <p className="small muted">Receivables are entered once a month per client by the location head; the Collections Head, Operations Head or Admin can dispute and change them (the head's figure stays visible). Collected and reconciled are the month's daily entries added up. Reconciled = everything collected is matched; it may go over when earlier receipts are matched this month. A gap still open after 2 working days becomes a task for the location head. Balance = receivables − collected. Billed per case = bills raised ÷ cases actioned (incoming − cancelled).</p>
      </Card>
      {edit && <Modal title={`Receivables — ${edit.client} · ${edit.location}`} onClose={() => setEdit(null)}><ReviewAr month={v.data!.month} r={edit} onDone={() => { setEdit(null); v.reload(); }} /></Modal>}
      {tgt && <Modal title={`Collection target — ${tgt.client} · ${tgt.location}`} onClose={() => setTgt(null)}><SetTarget month={v.data!.month} r={tgt} onDone={() => { setTgt(null); v.reload(); }} /></Modal>}
    </div>
  );
}

function ReviewAr({ month, r, onDone }: { month: string; r: Row; onDone: () => void }) {
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(AR.map(([k]) => [k, r.ar?.[k] != null ? String(r.ar[k]) : ''])));
  const [note, setNote] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const ok = AR.every(([k]) => f[k] !== '') && note.trim();
  return (
    <div className="stack">
      {r.ar && <div className="small muted">Entered by the location head: {AR.map(([k, l]) => `${l} ${money((r.ar.original ?? r.ar)[k])}`).join(' · ')}</div>}
      <div className="grid two">{AR.map(([k, l]) => <label key={k} className="field">{l} ₹<input type="number" min={0} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>)}</div>
      <label className="field">Why are you changing it? (the head is notified)<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <ErrorBox error={err} />
      <button className="btn primary" disabled={!ok} onClick={async () => { try { await rpc('review_ar', { p_month: month, p_branch: r.branch_id, p_client: r.client_id,
        p_values: Object.fromEntries(AR.map(([k]) => [k, Number(f[k])])), p_note: note }); onDone(); } catch (e) { setErr(e); } }}>Save revised receivables</button>
    </div>
  );
}

function SetTarget({ month, r, onDone }: { month: string; r: Row; onDone: () => void }) {
  const [amt, setAmt] = useState(r.target != null ? String(r.target) : '');
  const [err, setErr] = useState<unknown>(null);
  return (
    <div className="stack">
      <label className="field">Amount to collect this month ₹<input type="number" min={0} value={amt} onChange={(e) => setAmt(e.target.value)} /></label>
      <ErrorBox error={err} />
      <button className="btn primary" disabled={amt === ''} onClick={async () => { try { await rpc('set_target', { p_month: month, p_metric: 'collections_received', p_level: 'branch',
        p_amount: Number(amt), p_branch_id: r.branch_id, p_client_id: r.client_id, p_reason: 'Collection target' }); onDone(); } catch (e) { setErr(e); } }}>Save target</button>
      <p className="small muted">The location head sees this target in My day; they cannot change it.</p>
    </div>
  );
}
