import { useState } from 'react';
import { has, Me, rpc } from '../lib/api';
import { label, money, time } from '../lib/format';
import { Card, Empty, ErrorBox, Loading, useLoad } from './ui';

/** Employment details a manager or HR keeps for a person: joining date, PF applicable / opted, UAN (last 4). */
export function EmploymentCard({ personId, onSaved }: { personId: string; onSaved?: () => void }) {
  const d = useLoad(() => rpc<any>('employment_info', { p_person: personId }), [personId]);
  const [f, setF] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const [ok, setOk] = useState('');
  const v = f ?? d.data ?? {};
  const yn = (k: string, l: string, dis = false) => <label className="field">{l}<select value={v[k] == null ? '' : v[k] ? 'yes' : 'no'} disabled={dis}
    onChange={(e) => setF({ ...v, [k]: e.target.value === '' ? null : e.target.value === 'yes', ...(k === 'pf_applicable' && e.target.value === 'no' ? { pf_opted: false } : {}) })}>
    <option value="">Not set</option><option value="yes">Yes</option><option value="no">No</option></select></label>;
  return (
    <Card title="Employment details">
      {d.loading ? <Loading rows={2} /> : <ErrorBox error={d.error} />}
      {d.data && <div className="stack">
        {d.data.resource_type === 'partner' && <div className="banner info small">Business Associate (partner): paid by agreement, not payroll. PF is the partner's own.</div>}
        <div className="grid two">
          <label className="field">Joining / association date<input type="date" value={v.joined_on ?? ''} onChange={(e) => setF({ ...v, joined_on: e.target.value })} /></label>
          {yn('pf_applicable', 'PF applicable')}
          {yn('pf_opted', 'PF accepted (opted in)', v.pf_applicable === false)}
          <label className="field">UAN (last 4 digits)<input inputMode="numeric" maxLength={4} value={v.uan_last4 ?? ''} onChange={(e) => setF({ ...v, uan_last4: e.target.value.replace(/\D/g, '') })} /></label>
          <label className="field">Note<input value={v.note ?? ''} onChange={(e) => setF({ ...v, note: e.target.value })} /></label>
        </div>
        <ErrorBox error={err} />{ok && <div className="banner ok small" role="status">{ok}</div>}
        <div><button className="btn primary sm" disabled={!f} onClick={async () => { setErr(null); setOk('');
          try { await rpc('set_employment', { p_person: personId, p: { joined_on: v.joined_on || null, pf_applicable: v.pf_applicable, pf_opted: v.pf_opted, uan_last4: v.uan_last4 || null, note: v.note || null } });
            setF(null); setOk('Saved.'); d.reload(); onSaved?.(); } catch (e) { setErr(e); } }}>Save</button></div>
        {d.data.pf_applicable == null && <p className="small muted">PF applicable / accepted must be set before payroll; until then PF is not deducted and the pay sheet flags it.</p>}
      </div>}
    </Card>
  );
}

/** Salary history with every change and its reason; HR / Admin record joining salary, increments and corrections. */
export function SalaryHistory({ me, personId, partner }: { me: Me; personId: string; partner?: boolean }) {
  const hr = has(me, 'admin', 'hr_admin');
  const d = useLoad(() => rpc<any[]>('salary_history', { p_person: personId }), [personId]);
  const [f, setF] = useState({ gross: '', from: me.today.slice(0, 8) + '01', kind: 'increment', reason: '' });
  const [err, setErr] = useState<unknown>(null);
  if (partner) return <Card title="Salary"><p className="small muted">Business Associates are paid by agreement (see the partner checklist), not salary.</p></Card>;
  const cur = (d.data ?? [])[0];
  return (
    <Card title="Salary history">
      {d.loading ? <Loading rows={2} /> : <ErrorBox error={d.error} />}
      {d.data && (d.data.length === 0 ? <Empty>No salary recorded yet.</Empty> :
        <div className="tablewrap" tabIndex={0}><table className="small"><thead><tr><th>From</th><th className="num">Monthly gross</th><th className="num">Change</th><th>Type</th><th>Reason</th><th>By</th></tr></thead>
          <tbody>{d.data.map((r: any, i: number) => <tr key={i}><td>{r.effective_from}</td><td className="num"><b>{money(r.monthly_gross)}</b></td>
            <td className="num">{r.change_pct != null ? `${r.change_pct > 0 ? '+' : ''}${r.change_pct}%` : ''}</td><td>{label(r.kind)}</td><td>{r.reason ?? ''}</td><td className="muted">{r.set_by ?? ''} · {time(r.created_at)}</td></tr>)}</tbody></table></div>)}
      {hr && <div className="stack" style={{ marginTop: 10 }}>
        <div className="grid two">
          <label className="field">New monthly gross ₹<input type="number" min={1} value={f.gross} placeholder={cur ? String(cur.monthly_gross) : ''} onChange={(e) => setF({ ...f, gross: e.target.value })} /></label>
          <label className="field">Effective from<input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
          <label className="field">Type<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{['joining', 'increment', 'revision', 'correction'].map((k) => <option key={k} value={k}>{label(k)}</option>)}</select></label>
          <label className="field">Reason (required)<input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Annual increment 8% (letter dated …)" /></label>
        </div>
        {cur && Number(f.gross) > 0 && <div className="small muted">Change: {money(Number(f.gross) - Number(cur.monthly_gross))} ({(((Number(f.gross) / Number(cur.monthly_gross)) - 1) * 100).toFixed(1)}%)</div>}
        <ErrorBox error={err} />
        <div><button className="btn primary sm" disabled={!(Number(f.gross) > 0) || !f.reason.trim()} onClick={async () => { setErr(null);
          try { await rpc('set_compensation', { p_person: personId, p_gross: Number(f.gross), p_from: f.from, p_kind: f.kind, p_reason: f.reason }); setF({ ...f, gross: '', reason: '' }); d.reload(); }
          catch (e) { setErr(e); } }}>Save salary change</button></div>
      </div>}
      {!hr && <p className="small muted">To propose an increment, use Payroll → Propose → Increment; HR approves it.</p>}
    </Card>
  );
}
