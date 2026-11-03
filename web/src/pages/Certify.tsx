import { useEffect, useState } from 'react';
import { Fn, Me, rpc } from '../lib/api';
import { num, time } from '../lib/format';
import { Card, ErrorBox, Loading, useLoad } from '../components/ui';

type Blocker = { full_name: string };
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
        <div className="tablewrap"><table>
          <thead><tr><th></th><th className="num">Team roll-up</th><th className="num">My own</th><th className="num">Calculated</th><th className="num">Certified</th></tr></thead>
          <tbody>{fn === 'operations' ? M.map((k) => {
            const calc = Number(existing.team_totals?.[k] ?? 0) + Number(existing.own_totals?.[k] ?? 0);
            const c = d?.[k] != null ? Number(d[k]) : calc;
            return <tr key={k}><td>{k[0].toUpperCase() + k.slice(1)}</td><td className="num">{num(existing.team_totals?.[k])}</td><td className="num">{num(existing.own_totals?.[k])}</td>
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
      {blockers.length > 0 && <div className="banner warn">You can certify once everyone is resolved. Still waiting on: {blockers.map((b) => b.full_name).join(', ')}.</div>}
      {(team.loading || own.loading) ? <Loading rows={2} /> : (
        <div className="stack">
          {fn === 'operations' ? (
            <div className="tablewrap"><table>
              <thead><tr><th></th><th className="num">Team roll-up</th><th className="num">+ My own</th><th className="num">= Calculated</th><th className="num">I certify</th></tr></thead>
              <tbody>{M.map((k) => (
                <tr key={k}><td>{k[0].toUpperCase() + k.slice(1)}</td><td className="num">{num(T[k])}</td><td className="num">{num(O[k])}</td><td className="num"><b>{num(T[k] + O[k])}</b></td>
                  <td className="num"><input type="number" inputMode="numeric" min={0} style={{ width: 90 }} aria-label={`Certified ${k}`} placeholder={String(T[k] + O[k])}
                    value={val[k] ?? ''} onChange={(e) => setVal({ ...val, [k]: e.target.value })} /></td></tr>))}
                <tr><td>Net</td><td className="num">{num(T.entry + T.closure - T.cancelled)}</td><td className="num">{num(O.entry + O.closure - O.cancelled)}</td>
                  <td className="num"><b>{num(T.entry + T.closure - T.cancelled + O.entry + O.closure - O.cancelled)}</b></td><td /></tr>
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
