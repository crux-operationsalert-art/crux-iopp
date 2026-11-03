import { FormEvent, useState } from 'react';
import { has, Me, rpc, select } from '../lib/api';
import { label, money, monthStart, num, pct, time } from '../lib/format';
import { Card, Countdown, Empty, ErrorBox, Loading, Pill, Progress, useLoad } from '../components/ui';

const METRICS = ['net_actioned', 'entry', 'closure', 'revenue', 'collections_received', 'collections_reconciled', 'bill_count', 'bill_amount'];
const isMoney = (m: string) => m === 'revenue' || m === 'bill_amount' || m.startsWith('collections');
const fmt = (m: string, v: unknown) => (isMoney(m) ? money(v) : num(v));

export default function Targets({ me }: { me: Me }) {
  const [month, setMonth] = useState(monthStart(me.today));
  const lock = useLoad(() => rpc('target_lock_info', { p_month: month }), [month]);
  const mine = useLoad(() => rpc<any[]>('target_progress', { p_month: month }), [month]);
  const canStructure = has(me, 'admin', 'ops_head', 'collections_head', 'zm');
  return (
    <div className="stack">
      <div className="topbar"><div><h1>Targets</h1><div className="muted">Targets are set from the top down. Your actual figures roll up from the bottom.</div></div>
        <label className="field">Month<input type="month" value={month.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value + '-01')} /></label></div>
      {lock.data && (lock.data.locked
        ? <div className="banner info">Targets for this month locked on {time(lock.data.lock_at)}. Changes now need an Admin, with a reason.</div>
        : <div className="banner warn">Target setting closes {time(lock.data.lock_at)} (<Countdown to={lock.data.lock_at} />) — end of the 5th working day.</div>)}

      <Card title="My targets">
        {mine.loading ? <Loading /> : <ErrorBox error={mine.error} retry={mine.reload} />}
        {mine.data && (mine.data.length === 0 ? <Empty>No targets assigned to you for this month.</Empty> : <Progressions rows={mine.data} />)}
      </Card>
      {(me.manages_operations || me.manages_collections) && <TeamTargets me={me} month={month} locked={!!lock.data?.locked} />}
      {canStructure && <Structure me={me} month={month} />}
    </div>
  );
}

function Progressions({ rows }: { rows: any[] }) {
  return <div className="tablewrap"><table>
    <thead><tr><th>Measure</th><th className="num">Target</th><th className="num">Actual MTD</th><th>Achieved</th><th className="num">Remaining</th><th className="num">Needed / working day</th><th className="num">Projection*</th></tr></thead>
    <tbody>{rows.map((t) => <tr key={t.target_id}><td>{label(t.metric)}</td><td className="num">{fmt(t.metric, t.target)}</td><td className="num">{fmt(t.metric, t.actual)}</td>
      <td style={{ minWidth: 120 }}>{pct(t.achievement_pct)}<Progress value={t.achievement_pct} /></td><td className="num">{fmt(t.metric, t.remaining)}</td>
      <td className="num">{fmt(t.metric, t.required_daily_run_rate)}</td><td className="num muted">{fmt(t.metric, t.projected_month_end)}</td></tr>)}</tbody>
  </table><p className="small muted">*Projection = current pace × working days in the month. It is an estimate, not a commitment. Achievement shows N/A when no target is set.</p></div>;
}

function TeamTargets({ me, month, locked }: { me: Me; month: string; locked: boolean }) {
  const fn = me.manages_operations ? 'operations' : 'collections';
  const team = useLoad(() => rpc<any[]>('team_status', { p_work_date: me.today, p_function: fn }), []);
  const cur = useLoad(() => select('target_allocations', 'id,person_id,metric,amount,version,client_id', (b) => b.eq('month', month).eq('level', 'person').eq('is_current', true)), [month]);
  const [f, setF] = useState({ person: '', metric: fn === 'operations' ? 'net_actioned' : 'collections_received', amount: '', reason: '' });
  const [err, setErr] = useState<unknown>(null);
  async function go(e: FormEvent) {
    e.preventDefault(); setErr(null);
    try { await rpc('set_target', { p_month: month, p_metric: f.metric, p_level: 'person', p_amount: Number(f.amount), p_person_id: f.person, p_reason: f.reason || null });
      setF({ ...f, amount: '', reason: '' }); cur.reload(); } catch (x) { setErr(x); }
  }
  const byPerson = (id: string) => (cur.data ?? []).filter((t: any) => t.person_id === id);
  return (
    <Card title="Allocate to my direct team">
      {team.loading ? <Loading /> : <ErrorBox error={team.error} />}
      {team.data && (team.data.length === 0 ? <Empty>No direct reports.</Empty> : <>
        <table><tbody>{team.data.map((p) => <tr key={p.person_id}><td>{p.full_name}</td><td>{byPerson(p.person_id).length === 0 ? <Pill status="pending" text="No target" />
          : byPerson(p.person_id).map((t: any) => <span key={t.id} className="chip">{label(t.metric)}: {fmt(t.metric, t.amount)}{t.version > 1 ? ` (v${t.version})` : ''}</span>)}</td></tr>)}</tbody></table>
        <form className="row" style={{ marginTop: 12, alignItems: 'end' }} onSubmit={go}>
          <label className="field">Person<select required value={f.person} onChange={(e) => setF({ ...f, person: e.target.value })}><option value="">Choose…</option>{team.data.map((p) => <option key={p.person_id} value={p.person_id}>{p.full_name}</option>)}</select></label>
          <label className="field">Measure<select value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value })}>{METRICS.map((m) => <option key={m} value={m}>{label(m)}</option>)}</select></label>
          <label className="field">Monthly target<input required type="number" min={0} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
          {locked && <label className="field">Reason (after lock)<input required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>}
          <button className="btn primary">Save target</button>
        </form>
        <ErrorBox error={err} /></>)}
    </Card>
  );
}

function Structure({ me, month }: { me: Me; month: string }) {
  const zones = useLoad(() => select('zones', 'id,name', (b) => b.order('name')), []);
  const branches = useLoad(() => select('branches', 'id,name', (b) => b.order('name')), []);
  const chk = useLoad(() => select('v_target_allocation_check', '*', (b) => b.eq('month', month)), [month]);
  const [f, setF] = useState({ level: has(me, 'zm') && !has(me, 'admin', 'ops_head', 'collections_head') ? 'branch' : 'zone', id: '', metric: 'revenue', amount: '', reason: '' });
  const [err, setErr] = useState<unknown>(null);
  async function go(e: FormEvent) {
    e.preventDefault(); setErr(null);
    try { await rpc('set_target', { p_month: month, p_metric: f.metric, p_level: f.level, p_amount: Number(f.amount),
      p_zone_id: f.level === 'zone' ? f.id : null, p_branch_id: f.level === 'branch' ? f.id : null, p_reason: f.reason || null }); chk.reload(); setF({ ...f, amount: '' }); }
    catch (x) { setErr(x); }
  }
  const zn = (id: string) => zones.data?.find((z: any) => z.id === id)?.name ?? 'Organisation';
  return (
    <Card title="Organisation, zone and branch targets">
      <form className="row" style={{ alignItems: 'end' }} onSubmit={go}>
        <label className="field">Level<select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value, id: '' })}>
          {has(me, 'admin', 'ops_head', 'collections_head') && <><option value="org">Organisation</option><option value="zone">Zone</option></>}<option value="branch">Branch</option></select></label>
        {f.level !== 'org' && <label className="field">{label(f.level)}<select required value={f.id} onChange={(e) => setF({ ...f, id: e.target.value })}><option value="">Choose…</option>
          {(f.level === 'zone' ? zones.data : branches.data)?.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
        <label className="field">Measure<select value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value })}>{METRICS.map((m) => <option key={m} value={m}>{label(m)}</option>)}</select></label>
        <label className="field">Amount<input required type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
        <label className="field">Reason<input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
        <button className="btn primary">Save</button>
      </form>
      <ErrorBox error={err} />
      <h3 style={{ marginTop: 16 }}>Allocation check</h3>
      {chk.data && (chk.data.length === 0 ? <Empty>No organisation or zone targets yet.</Empty> : <table>
        <thead><tr><th>Parent</th><th>Measure</th><th className="num">Parent target</th><th className="num">Allocated below</th><th className="num">Unallocated</th></tr></thead>
        <tbody>{chk.data.map((c: any) => <tr key={c.parent_id}><td>{c.level === 'org' ? 'Organisation' : zn(c.zone_id)}</td><td>{label(c.metric)}</td><td className="num">{fmt(c.metric, c.parent_amount)}</td>
          <td className="num">{fmt(c.metric, c.allocated)}</td><td className="num">{Number(c.unallocated) < 0 ? <Pill status="mismatch" text={`Over by ${fmt(c.metric, -c.unallocated)}`} /> : fmt(c.metric, c.unallocated)}</td></tr>)}</tbody></table>)}
    </Card>
  );
}
