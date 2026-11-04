import { useEffect, useState } from 'react';
import { Fn, Me, rpc } from '../lib/api';
import { num, time } from '../lib/format';
import { Card, ErrorBox, Loading, useLoad } from '../components/ui';

type Blocker = { full_name: string; person_id?: string; is_manager?: boolean; status?: string };
const M = ['entry', 'closure', 'cancelled'] as const;

/** Manager certification: team roll-up and own figures side by side; any figure that differs needs a reason (SOW 5.4, D-06). */
export function Certify({ me, date, fn, blockers, existing, onDone }: { me: Me; date: string; fn: Fn; blockers: Blocker[]; existing?: any; onDone: () => void }) {
  const team = useLoad(() => fn === 'operations' ? rpc<any[]>('day_report', { p_date: date, p_scope: 'team' }) : Promise.resolve([]), [date, fn, existing?.id]);
  const own = useLoad(() => fn === 'operations' ? rpc<any[]>('day_report', { p_date: date, p_scope: 'me' }) : Promise.resolve([]), [date, fn, existing?.id]);
  const sum = (rs: any[] | null, k: string) => (rs ?? []).reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const T = Object.fromEntries(M.map((k) => [k, sum(team.data, k)])) as Record<string, number>;
  const O = Object.fromEntries(M.map((k) => [k, sum(own.data, k)])) as Record<string, number>;
  const [val, setVal] = useState<Record<string, string>>({});
  const [money, setMoney] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setVal({}); setReason(''); }, [date, fn]);

  if (existing) {
    const d = existing.certified_detail;
    return (
      <Card title="Team certified">
        <div className="tablewrap" tabIndex={0}><table>
          <thead><tr><th></th><th className="num">Team roll-up</th><th className="num">My own</th><th className="num">Calculated</th><th className="num">Certified</th></tr></thead>
          <tbody>{fn === 'operations' ? M.map((k) => {
            const calc = Number(existing.team_totals?.[k] ?? 0) + Number(existing.own_totals?.[k] ?? 0);
            const c = d?.[k] != null ? Number(d[k]) : calc;
            return <tr key={k}><td>{({ entry: 'Received', closure: 'Closed', cancelled: 'Cancelled' } as const)[k]}</td><td className="num">{num(existing.team_totals?.[k])}</td><td className="num">{num(existing.own_totals?.[k])}</td>
              <td className="num">{num(calc)}</td><td className="num"><b className={c !== calc ? 'bad' : ''}>{num(c)}</b></td></tr>;
          }) : <tr><td>Collected ₹</td><td className="num">{num(existing.team_totals?.received)}</td><td className="num">{num(existing.own_totals?.received)}</td>
              <td className="num">{num(existing.calculated_total)}</td><td className="num"><b>{num(existing.certified_value ?? existing.calculated_total)}</b></td></tr>}</tbody>
        </table></div>
        <p className="small muted">Certified by {me.full_name.split(' ')[0]} {time(existing.certified_at)}{existing.late ? ' · late' : ''}{existing.reason ? ` · Reason: ${existing.reason}` : ''}</p>
      </Card>);
  }

  const diffs = fn === 'operations' ? M.filter((k) => val[k] !== undefined && val[k] !== '' && Number(val[k]) !== T[k] + O[k]) : [];
  const moneyDiff = fn === 'collections' && money !== '';
  const needReason = diffs.length > 0 || moneyDiff;
  async function go() {
    setBusy(true); setErr(null);
    try {
      const p = fn === 'operations' ? Object.fromEntries(M.map((k) => [k, val[k] === undefined || val[k] === '' ? T[k] + O[k] : Number(val[k])]))
        : money === '' ? null : { received: Number(money) };
      await rpc('certify_team_detail', { p_work_date: date, p_function: fn, p_certified: p, p_reason: reason || null });
      onDone();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Card title="Certify my team">
      {blockers.length > 0 && <div className="banner warn stack" style={{ gap: 6 }}>
        <div>You can certify once everyone is resolved. Still waiting on:</div>
        <Blockers date={date} fn={fn} rows={blockers} onDone={onDone} />
      </div>}
      {(team.loading || own.loading) ? <Loading rows={2} /> : (
        <div className="stack">
          {fn === 'operations' ? (
            <div className="tablewrap" tabIndex={0}><table>
              <thead><tr><th></th><th className="num">Team roll-up</th><th className="num">+ My own</th><th className="num">= Calculated</th><th className="num">I certify</th></tr></thead>
              <tbody>{M.map((k) => (
                <tr key={k}><td>{({ entry: 'Received', closure: 'Closed', cancelled: 'Cancelled' } as const)[k]}</td><td className="num">{num(T[k])}</td><td className="num">{num(O[k])}</td><td className="num"><b>{num(T[k] + O[k])}</b></td>
                  <td className="num"><input type="number" inputMode="numeric" min={0} style={{ width: 90 }} aria-label={`Certified ${k}`} placeholder={String(T[k] + O[k])}
                    value={val[k] ?? ''} onChange={(e) => setVal({ ...val, [k]: e.target.value })} /></td></tr>))}
                <tr><td title="Received − Cancelled: the revenue basis">Billable</td><td className="num">{num(T.entry - T.cancelled)}</td><td className="num">{num(O.entry - O.cancelled)}</td>
                  <td className="num"><b>{num(T.entry - T.cancelled + O.entry - O.cancelled)}</b></td><td /></tr>
              </tbody></table></div>
          ) : <label className="field">Collected ₹ — leave blank to certify the calculated team + own total; enter a figure only if it differs
                <input type="number" inputMode="decimal" value={money} onChange={(e) => setMoney(e.target.value)} /></label>}
          <p className="small muted">Leave a box empty to certify the calculated figure. If you enter something different from the roll-up, explain why (for example a case reported on WhatsApp but not yet entered). The difference and reason are recorded and visible to your manager.</p>
          {needReason && <div className="banner warn">Your figure differs from the roll-up{diffs.length ? ` for ${diffs.join(', ')}` : ''}. A reason is required.</div>}
          <label className="field">Reason {needReason ? '(required)' : '(optional)'}<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <ErrorBox error={err} />
          <button className="btn primary" disabled={busy || blockers.length > 0 || (needReason && !reason.trim())} onClick={go}>{busy ? 'Certifying…' : 'Certify team'}</button>
        </div>)}
    </Card>
  );
}

const AWAY = ['absent', 'on_leave'];
/** Who is holding up certification, with the fix next to each: mark absent / on leave, or — for a manager who is away — act for them (D-60). */
function Blockers({ date, fn, rows, onDone, depth = 0 }: { date: string; fn: Fn; rows: Blocker[]; onDone: () => void; depth?: number }) {
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [why, setWhy] = useState<Record<string, string>>({});
  async function mark(b: Blocker, status: string) {
    setErr(null);
    try { await rpc('set_member_status', { p_person: b.person_id, p_work_date: date, p_status: status, p_reason: why[b.person_id!] || (status === 'absent' ? 'Absent' : 'On leave'), p_function: fn }); onDone(); }
    catch (e) { setErr(e); }
  }
  return (
    <div className="stack" style={{ gap: 4, marginLeft: depth ? 14 : 0 }}>
      {rows.map((b) => { const away = AWAY.includes(b.status ?? ''); return (
        <div key={b.person_id ?? b.full_name} className="stack" style={{ gap: 4 }}>
          <div className="row small" style={{ gap: 6 }}>
            <b>{b.full_name}</b> <span className="muted">{b.is_manager ? (away ? `${b.status === 'absent' ? 'absent' : 'on leave'} — team not certified` : 'team not certified') : (b.status ?? 'pending').replace('_', ' ')}</span>
            <span className="spacer" />
            {b.person_id && !away && <><input placeholder="Reason" value={why[b.person_id] ?? ''} onChange={(e) => setWhy({ ...why, [b.person_id!]: e.target.value })} style={{ width: 140 }} aria-label={`Reason for ${b.full_name}`} />
              <button className="btn sm" onClick={() => mark(b, 'absent')}>Mark absent</button><button className="btn sm" onClick={() => mark(b, 'on_leave')}>On leave</button></>}
            {b.person_id && b.is_manager && away && <button className="btn sm primary" onClick={() => setOpen(open === b.person_id ? null : b.person_id!)}>{open === b.person_id ? 'Close' : `Act for ${b.full_name.split(' ')[0]}`}</button>}
          </div>
          {open === b.person_id && <ActFor date={date} fn={fn} manager={b} onDone={onDone} depth={depth + 1} />}
        </div>); })}
      <ErrorBox error={err} />
    </div>
  );
}

function ActFor({ date, fn, manager, onDone, depth }: { date: string; fn: Fn; manager: Blocker; onDone: () => void; depth: number }) {
  const st = useLoad(() => rpc<any[]>('team_status', { p_work_date: date, p_function: fn, p_manager: manager.person_id }), [date, manager.person_id]);
  const [err, setErr] = useState<unknown>(null);
  const [reason, setReason] = useState('');
  const open = (st.data ?? []).filter((r) => !r.resolved);
  async function certify() { setErr(null); try { await rpc('certify_for', { p_manager: manager.person_id, p_work_date: date, p_function: fn, p_reason: reason || null }); st.reload(); onDone(); } catch (e) { setErr(e); } }
  return (
    <div className="card stack" style={{ padding: 10, marginLeft: 14, gap: 6 }}>
      <div className="small">Acting for <b>{manager.full_name}</b> (away). Their team today:</div>
      {st.loading ? <Loading rows={1} /> : <ErrorBox error={st.error} />}
      {st.data && <table><tbody>{st.data.map((r) => <tr key={r.person_id}><td>{r.full_name}</td><td className="small">{r.resolved ? '✓ ' : ''}{String(r.status).replace('_', ' ')}</td>
        <td className="num small">R {num(r.entry)} · C {num(r.closure)} · X {num(r.cancelled)}</td></tr>)}</tbody></table>}
      {open.length > 0 ? <Blockers date={date} fn={fn} rows={open} onDone={() => { st.reload(); onDone(); }} depth={depth} />
        : <div className="row"><input placeholder="Note (optional)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Note" />
            <button className="btn primary sm" onClick={certify}>Certify for {manager.full_name.split(' ')[0]}</button></div>}
      <p className="small muted">Entries for their people can be made from My team; the certification is recorded as yours on {manager.full_name.split(' ')[0]}'s behalf and they are told.</p>
      <ErrorBox error={err} />
    </div>
  );
}
