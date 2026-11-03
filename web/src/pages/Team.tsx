import { Fragment, useState } from 'react';
import { Certify } from './Certify';
import TeamPeople from './TeamPeople';
import { Tabs } from '../components/ui';
import { Fn, Me, rpc, select } from '../lib/api';
import { label, nice, num } from '../lib/format';
import { Card, Empty, ErrorBox, Loading, Pill, useLoad } from '../components/ui';
import { ActivationBanner } from '../components/Onboarding';

type T = { person_id: string; full_name: string; designation: string | null; is_manager: boolean; status: string; reason: string | null;
  late: boolean; submitted_at: string | null; certified: boolean; resolved: boolean; entry: number; closure: number; cancelled: number; net: number };

function TodayView({ me }: { me: Me }) {
  const [date, setDate] = useState(me.today);
  const [fn, setFn] = useState<Fn>(me.manages_operations ? 'operations' : 'collections');
  const [path, setPath] = useState<{ id: string; name: string }[]>([]);
  const mgr = path.at(-1)?.id ?? null;
  const team = useLoad(() => rpc<T[]>('team_status', { p_work_date: date, p_function: fn, p_manager: mgr }), [date, fn, mgr]);
  const cert = useLoad(() => select('certifications', '*', (b) => b.eq('manager_id', me.person_id).eq('work_date', date).eq('function', fn)), [date, fn]);
  const [open, setOpen] = useState<string | null>(null);
  const [act, setAct] = useState<{ p: T; kind: 'status' | 'behalf' } | null>(null);
  const viewingOwn = mgr === null;
  const [codeInfo, setCodeInfo] = useState<any>(null);
  const [codeErr, setCodeErr] = useState<unknown>(null);

  const rows = team.data ?? [];
  const blockers = rows.filter((r) => !r.resolved);
  const roll = rows.reduce((a, r) => ({ e: a.e + Number(r.entry), c: a.c + Number(r.closure), x: a.x + Number(r.cancelled), n: a.n + Number(r.net) }), { e: 0, c: 0, x: 0, n: 0 });

  return (
    <div className="stack">
      <div className="topbar">
        <div className="muted">Unresolved people are listed first. Tap a person to see their client-wise figures.</div>
        <div className="row">
          {me.manages_operations && me.manages_collections && (
            <div className="chips" role="group" aria-label="Function">{(['operations', 'collections'] as Fn[]).map((f) =>
              <button key={f} className={`chip ${fn === f ? 'on' : ''}`} onClick={() => { setFn(f); setPath([]); }}>{label(f)}</button>)}</div>)}
          <input type="date" value={date} max={me.today} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ width: 160 }} aria-label="Work date" />
        </div>
      </div>
      {path.length > 0 && <div className="crumbs"><button onClick={() => setPath([])}>My team</button>{path.map((p, i) =>
        <span key={p.id}>› <button onClick={() => setPath(path.slice(0, i + 1))}>{p.name}</button></span>)}</div>}

      {codeInfo && <ActivationBanner a={codeInfo} sender={me.full_name} reset onClose={() => setCodeInfo(null)} />}
      <ErrorBox error={codeErr} />
      {team.loading && <Loading rows={4} />}
      <ErrorBox error={team.error} retry={team.reload} />
      {team.data && (
        <Card title={`${nice(date)} — ${rows.length - blockers.length} of ${rows.length} resolved`}>
          {rows.length === 0 ? <Empty>No direct reports on this date. Use the <b>People</b> tab to add your team members.</Empty> : (
            <div className="tablewrap" tabIndex={0}><table>
              <thead><tr><th>Person</th><th>Status</th>{fn === 'operations' && <><th className="num">Entry</th><th className="num">Closure</th><th className="num">Cancelled</th><th className="num">Net</th></>}<th></th></tr></thead>
              <tbody>{rows.map((r) => (
                <Fragment key={r.person_id}>
                  <tr className="click" onClick={() => setOpen(open === r.person_id ? null : r.person_id)}>
                    <td><b>{r.full_name}</b><div className="small muted">{r.designation}{r.is_manager ? ' · manages a team' : ''}</div></td>
                    <td>{r.is_manager ? <Pill status={r.certified ? 'certified' : 'pending'} text={r.certified ? 'Team certified' : 'Team not certified'} /> : <Pill status={r.status} />}
                      {r.late && <> <Pill status="exception" text="Late" /></>}
                      {r.reason && <div className="small muted">{r.reason}</div>}</td>
                    {fn === 'operations' && <><td className="num">{num(r.entry)}</td><td className="num">{num(r.closure)}</td><td className="num">{num(r.cancelled)}</td><td className="num"><b>{num(r.net)}</b></td></>}
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        {r.is_manager && <button className="btn sm" onClick={() => setPath([...path, { id: r.person_id, name: r.full_name }])}>Their team ›</button>}
                        {viewingOwn && <button className="btn sm" title="Give this code to the person to set or reset their password"
                          onClick={async () => { setCodeErr(null); try { setCodeInfo(await rpc('issue_activation', { p_person: r.person_id })); } catch (x) { setCodeErr(x); } }}>Activation code</button>}
                        {viewingOwn && !r.is_manager && !r.resolved && <>
                          {fn === 'operations' && <button className="btn sm" onClick={() => setAct({ p: r, kind: 'behalf' })}>Enter for them</button>}
                          <button className="btn sm" onClick={() => setAct({ p: r, kind: 'status' })}>Set status</button></>}
                      </div>
                    </td>
                  </tr>
                  {open === r.person_id && <tr><td colSpan={7}><PersonDetail person={r.person_id} date={date} fn={fn} name={r.full_name} /></td></tr>}
                </Fragment>))}</tbody>
              {fn === 'operations' && <tfoot><tr><th>Team roll-up</th><th></th><th className="num">{num(roll.e)}</th><th className="num">{num(roll.c)}</th><th className="num">{num(roll.x)}</th><th className="num">{num(roll.n)}</th><th></th></tr></tfoot>}
            </table></div>)}
        </Card>)}

      {act && <ActionPanel me={me} act={act} date={date} fn={fn} onDone={() => { setAct(null); team.reload(); }} />}
      {viewingOwn && team.data && rows.length > 0 && <Certify me={me} date={date} fn={fn} blockers={blockers} existing={cert.data?.[0]} onDone={() => { cert.reload(); team.reload(); }} />}
    </div>
  );
}

function PersonDetail({ person, date, fn, name }: { person: string; date: string; fn: Fn; name: string }) {
  const d = useLoad(() => fn === 'operations'
    ? select('productivity_lines', 'client_location_id,entry,closure,cancelled,source,reason,client_locations(clients(name),locations(name))', (b) => b.eq('person_id', person).eq('work_date', date))
    : select('collection_entries', 'amount_received,amount_reconciled,recon_status,reference,clients(name)', (b) => b.eq('person_id', person).eq('collection_date', date)), [person, date, fn]);
  const [ed, setEd] = useState<{ cl: string; e: string; c: string; x: string; note: string; remove: boolean } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  async function save() {
    if (!ed) return; setErr(null);
    try {
      await rpc('correct_team_line', { p_person: person, p_date: date, p_client_location: ed.cl, p_entry: Number(ed.e || 0), p_closure: Number(ed.c || 0),
        p_cancelled: Number(ed.x || 0), p_note: ed.note, p_remove: ed.remove });
      setEd(null); d.reload();
    } catch (e) { setErr(e); }
  }
  if (d.loading) return <Loading rows={1} />;
  if (d.error) return <ErrorBox error={d.error} />;
  if (!d.data?.length) return <Empty>No figures recorded for this date.</Empty>;
  return (
    <div className="stack">
      <table><tbody>{d.data.map((x: any, i) => fn === 'operations'
        ? <tr key={i}><td>{x.client_locations?.clients?.name} · {x.client_locations?.locations?.name}{x.source === 'on_behalf' && <div className="small muted">{x.reason}</div>}</td>
            <td className="num">E {x.entry}</td><td className="num">C {x.closure}</td><td className="num">X {x.cancelled}</td><td className="num"><b>{x.entry + x.closure - x.cancelled}</b></td>
            <td><div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn sm" onClick={() => setEd({ cl: x.client_location_id, e: String(x.entry), c: String(x.closure), x: String(x.cancelled), note: '', remove: false })}>Edit</button>
              <button className="btn sm" onClick={() => setEd({ cl: x.client_location_id, e: '0', c: '0', x: '0', note: '', remove: true })}>Remove</button></div></td></tr>
        : <tr key={i}><td>{x.clients?.name}</td><td className="num">₹{num(x.amount_received)}</td><td className="num">₹{num(x.amount_reconciled)}</td><td><Pill status={x.recon_status} /></td></tr>)}</tbody></table>
      {ed && (
        <div className="banner info stack">
          <b>{ed.remove ? `Remove this entry for ${name}` : `Correct ${name}'s entry`}</b>
          {!ed.remove && <div className="row">{(['e', 'c', 'x'] as const).map((k) => <label key={k} className="field">{{ e: 'Entry', c: 'Closure', x: 'Cancelled' }[k]}
            <input type="number" min={0} inputMode="numeric" style={{ width: 90 }} value={ed[k]} onChange={(ev) => setEd({ ...ed, [k]: ev.target.value })} /></label>)}</div>}
          <label className="field">Note (required — {name.split(' ')[0]} is told, old figures stay in the audit log)
            <input value={ed.note} onChange={(ev) => setEd({ ...ed, note: ev.target.value })} placeholder={ed.remove ? 'e.g. wrong client selected' : 'e.g. 2 cases were duplicates'} /></label>
          <ErrorBox error={err} />
          <div className="row"><button className="btn primary" disabled={!ed.note.trim()} onClick={save}>{ed.remove ? 'Remove entry' : 'Save correction'}</button>
            <button className="btn" onClick={() => setEd(null)}>Cancel</button></div>
        </div>)}
    </div>
  );
}

function ActionPanel({ me, act, date, fn, onDone }: { me: Me; act: { p: T; kind: 'status' | 'behalf' }; date: string; fn: Fn; onDone: () => void }) {
  const [status, setStatus] = useState('absent');
  const [reason, setReason] = useState('');
  const [vals, setVals] = useState<Record<string, { entry: string; closure: string; cancelled: string }>>({});
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const allocs = useLoad(() => act.kind === 'behalf'
    ? select('allocations', 'client_location_id,valid,client_locations(clients(name),locations(name))', (b) => b.eq('person_id', act.p.person_id).eq('function', 'operations'))
    : Promise.resolve([]), [act.p.person_id]);
  const active = (allocs.data ?? []).filter((a: any) => { const m = /\[(.*?),(.*?)\)/.exec(a.valid); return m && m[1] <= date && (!m[2] || date < m[2]); });

  async function go() {
    setBusy(true); setErr(null);
    try {
      if (act.kind === 'status') await rpc('set_member_status', { p_person: act.p.person_id, p_work_date: date, p_status: status, p_reason: reason, p_function: fn });
      else {
        const rows = active.map((a: any) => ({ client_location_id: a.client_location_id, entry: Number(vals[a.client_location_id]?.entry || 0),
          closure: Number(vals[a.client_location_id]?.closure || 0), cancelled: Number(vals[a.client_location_id]?.cancelled || 0) }));
        await rpc('save_productivity', { p_work_date: date, p_rows: rows, p_person: act.p.person_id, p_reason: reason });
        await rpc('submit_day', { p_work_date: date, p_person: act.p.person_id, p_reason: reason });
      }
      onDone();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }

  return (
    <Card title={act.kind === 'status' ? `Set status for ${act.p.full_name}` : `Enter figures for ${act.p.full_name}`}>
      <div className="stack">
        {act.kind === 'status' ? (
          <div className="chips" role="radiogroup" aria-label="Status">{['absent', 'on_leave', 'non_operational', 'exception'].map((s) =>
            <button key={s} role="radio" aria-checked={status === s} className={`chip ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>{label(s)}</button>)}</div>
        ) : allocs.loading ? <Loading rows={2} /> : active.length === 0 ? <Empty>This person has no allocations on {nice(date)}.</Empty> : active.map((a: any) => (
          <div key={a.client_location_id} className="entry-row">
            <div className="who"><b>{a.client_locations?.clients?.name}</b> · {a.client_locations?.locations?.name}</div>
            {(['entry', 'closure', 'cancelled'] as const).map((k) => <label key={k}><span className="small muted">{label(k)}</span>
              <input type="number" inputMode="numeric" min={0} step={1} value={vals[a.client_location_id]?.[k] ?? ''}
                onChange={(e) => setVals({ ...vals, [a.client_location_id]: { ...{ entry: '', closure: '', cancelled: '' }, ...vals[a.client_location_id], [k]: e.target.value } })} /></label>)}
            <div />
          </div>))}
        <label className="field">Reason (required, visible to {act.p.full_name.split(' ')[0]} and your manager)
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        {act.kind === 'behalf' && <p className="small muted">This will be recorded as entered by {me.full_name} on behalf of {act.p.full_name}, and they will be notified.</p>}
        <ErrorBox error={err} />
        <div className="row"><button className="btn primary" disabled={busy || !reason.trim()} onClick={go}>{busy ? 'Saving…' : 'Save'}</button><button className="btn" onClick={onDone}>Cancel</button></div>
      </div>
    </Card>
  );
}


export default function Team({ me }: { me: Me }) {
  const manages = me.manages_operations || me.manages_collections;
  const [tab, setTab] = useState<'today' | 'people'>(manages ? 'today' : 'people');
  return (
    <div className="stack">
      <div className="topbar"><div><h1>My team</h1><div className="muted">Daily review and certification · add and set up team members</div></div></div>
      <Tabs tabs={[['today', "Today's review"], ['people', 'People · add member']]} value={tab} onChange={setTab} />
      {tab === 'today' ? (manages ? <TodayView me={me} /> : <Empty>Nobody reports to you yet. Add your first team member in the People tab.</Empty>) : <TeamPeople me={me} />}
    </div>
  );
}
