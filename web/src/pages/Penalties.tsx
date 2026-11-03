import { FormEvent, useState } from 'react';
import { has, Me, rpc, select } from '../lib/api';
import { money, nice } from '../lib/format';
import { Card, Empty, ErrorBox, Loading, Pill, useLoad } from '../components/ui';

export default function Penalties({ me }: { me: Me }) {
  const list = useLoad(() => select('penalty_ledger', '*,penalty_rules(code,description),persons!penalty_ledger_person_id_fkey(full_name)', (b) => b.order('event_date', { ascending: false }).limit(100)), []);
  const rules = useLoad(() => select('penalty_rules', 'code,description,amount,active,financial_enabled', (b) => b.eq('active', true)), []);
  const team = useLoad(() => me.manages_operations ? rpc<any[]>('team_status', { p_work_date: me.today }) : Promise.resolve([]), []);
  const decider = has(me, 'admin', 'hr_admin');
  const [f, setF] = useState({ person: '', rule: '', date: me.today, reason: '' });
  const [err, setErr] = useState<unknown>(null);

  async function propose(e: FormEvent) {
    e.preventDefault(); setErr(null);
    try { await rpc('propose_penalty', { p_person: f.person, p_rule_code: f.rule, p_event_date: f.date, p_reason: f.reason }); setF({ ...f, reason: '' }); list.reload(); }
    catch (x) { setErr(x); }
  }
  async function act(fn: string, args: Record<string, unknown>) {
    setErr(null);
    try { await rpc(fn, args); list.reload(); } catch (x) { setErr(x); }
  }

  return (
    <div className="stack">
      <div className="topbar"><div><h1>Penalty ledger</h1><div className="muted">A compliance record only. Nothing here changes pay unless HR and Legal approve a policy.</div></div></div>
      <ErrorBox error={err} />
      {me.manages_operations && (
        <Card title="Record a compliance event for a direct report">
          {rules.data?.length === 0 ? <Empty>No penalty rules are active. Admin configures rules after HR/Legal approval.</Empty> :
          <form className="row" style={{ alignItems: 'end' }} onSubmit={propose}>
            <label className="field">Person<select required value={f.person} onChange={(e) => setF({ ...f, person: e.target.value })}><option value="">Choose…</option>{(team.data ?? []).map((p) => <option key={p.person_id} value={p.person_id}>{p.full_name}</option>)}</select></label>
            <label className="field">Rule<select required value={f.rule} onChange={(e) => setF({ ...f, rule: e.target.value })}><option value="">Choose…</option>{(rules.data ?? []).map((r: any) => <option key={r.code} value={r.code}>{r.description}</option>)}</select></label>
            <label className="field">Date<input type="date" value={f.date} max={me.today} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
            <label className="field">Reason<input required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
            <button className="btn primary">Record</button>
          </form>}
        </Card>)}
      <Card title="Records">
        {list.loading ? <Loading /> : <ErrorBox error={list.error} retry={list.reload} />}
        {list.data && (list.data.length === 0 ? <Empty>No penalty records.</Empty> : <div className="tablewrap"><table>
          <thead><tr><th>Date</th><th>Person</th><th>Rule</th><th>Reason</th><th className="num">Amount</th><th>Status</th><th></th></tr></thead>
          <tbody>{list.data.map((p: any) => <tr key={p.id}><td>{nice(p.event_date)}</td><td>{p.persons?.full_name}</td><td>{p.penalty_rules?.description}</td>
            <td className="small">{p.reason}{p.appeal_text && <div className="muted">Appeal: {p.appeal_text}</div>}{p.decision_reason && <div className="muted">Decision: {p.decision_reason}</div>}</td>
            <td className="num">{p.amount == null ? 'Not set' : money(p.amount)}</td><td><Pill status={p.status} /></td>
            <td><div className="row">
              {p.person_id === me.person_id && !p.acknowledged_at && <button className="btn sm" onClick={() => act('respond_penalty', { p_id: p.id, p_acknowledge: true })}>Acknowledge</button>}
              {p.person_id === me.person_id && !p.appeal_text && <button className="btn sm" onClick={() => { const t = window.prompt('Explain why you dispute this'); if (t) act('respond_penalty', { p_id: p.id, p_acknowledge: false, p_appeal_text: t }); }}>Dispute</button>}
              {decider && ['proposed', 'disputed'].includes(p.status) && ['approved', 'waived'].map((s) => <button key={s} className="btn sm" onClick={() => { const t = window.prompt(`Reason to mark ${s}`); if (t) act('decide_penalty', { p_id: p.id, p_status: s, p_reason: t }); }}>{s === 'approved' ? 'Approve' : 'Waive'}</button>)}
            </div></td></tr>)}</tbody></table></div>)}
      </Card>
    </div>
  );
}
