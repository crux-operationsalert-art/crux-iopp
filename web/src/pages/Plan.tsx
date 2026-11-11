import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Me, rpc } from '../lib/api';
import { Card, ErrorBox, Loading, useLoad } from '../components/ui';
import { HelpTip } from '../components/HelpTip';
import { Icon } from '../components/Icon';
import { CommitmentMeter, TeamCommitment } from '../components/Commitment';

const time = (s?: string | null) => (s ? new Date(s).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '');

/** Check-in & plan (D-113, D-115): check in IS your plan for the day — what and how much you will do.
 *  Your output is the My day update; Commitment % = what you did out of what you planned. */
export default function Plan({ me }: { me: Me }) {
  const d = useLoad(() => rpc<any>('my_plan', {}), []);
  const manager = me.manages_operations;
  return (
    <div className="stack">
      <div className="topbar"><div><h1>Check in &amp; plan<HelpTip k="my plan" /></h1>
        <div className="small muted">Checking in is your plan for the day — what and how much you will do. At day's end your My&nbsp;day figures are the output, and Commitment&nbsp;% is what you did out of what you planned.</div></div></div>
      {d.loading ? <Loading rows={4} /> : d.error ? <ErrorBox error={d.error} retry={d.reload} /> : d.data && <PlanBody p={d.data} onChange={d.reload} />}
      {manager && <TeamCommitment />}
    </div>
  );
}

function PlanBody({ p, onChange }: { p: any; onChange: () => void }) {
  const [plan, setPlan] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(p.plan ?? {}).map(([k, v]) => [k, String(v)])));
  const [note, setNote] = useState(p.plan_note ?? '');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const lines = (p.lines ?? []) as { client_location_id: string; client: string; location: string }[];
  const plannedTotal = useMemo(() => Object.values(plan).reduce((a, v) => a + (Number(v) || 0), 0), [plan]);
  const actual = (p.actual ?? {}) as Record<string, number>;
  const pct = p.commitment_pct;
  const checkedIn = !!p.checked_in_at;

  // One action: save the plan AND mark at-work.
  async function checkIn() {
    setBusy('in'); setErr(null);
    try {
      await rpc('save_plan', { p_work_date: p.work_date, p_planned: plannedTotal || null,
        p_plan: Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, Number(v) || 0]).filter(([, v]) => (v as number) > 0)), p_note: note.trim() || null });
      if (!checkedIn) await rpc('self_check_in', { p_note: null });
      onChange();
    } catch (e) { setErr(e); } finally { setBusy(''); }
  }

  return (
    <>
      <Card title="Check in & plan your day" help="Put the number you aim to do on each client and a short note, then check in. This is your commitment for the day — you can update it any time.">
        {checkedIn && <div className="banner ok row" style={{ marginBottom: 10 }}><Icon name="check" size={14} />
          <span>Checked in at {time(p.checked_in_at)} — you are marked at work today.</span></div>}
        {lines.length === 0 ? <p className="muted">You have no client lines to plan today.</p> : (
          <div className="stack">
            <div className="planlines">
              {lines.map((l) => <label key={l.client_location_id} className="planline">
                <span className="pl-name">{l.client} <span className="muted">· {l.location}</span></span>
                <input type="number" inputMode="numeric" min={0} value={plan[l.client_location_id] ?? ''} placeholder="0"
                  onChange={(e) => setPlan({ ...plan, [l.client_location_id]: e.target.value })} className="num" style={{ width: 90 }} />
                {actual[l.client_location_id] != null && <span className="small muted">done {actual[l.client_location_id]}</span>}
              </label>)}
            </div>
            <div className="row"><b>Planned total: {plannedTotal}</b><span className="spacer" /><span className="muted small">done so far: {p.actual_total}</span></div>
            <label className="field">Note — what and how much will you do today?<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. clear the SBI Pune backlog, then start fresh allocations" /></label>
            <div className="row"><button className="btn primary" disabled={busy === 'in'} onClick={checkIn}>
              {busy === 'in' ? 'Saving…' : checkedIn ? 'Update my plan' : "I'm at work — check in & save plan"}</button>
              {p.committed_at && <span className="muted small">planned at {time(p.committed_at)}</span>}</div>
          </div>)}
      </Card>

      <Card title="How I'm doing" help="Commitment % is what you did out of what you planned. It is one of your KPIs. Your 'done' comes from your My day figures.">
        <div className="commit-wrap">
          <CommitmentMeter pct={pct} label={pct == null ? 'Plan your day to start' : `${pct}% of plan`} big />
          <div className="commit-nums">
            <div><div className="muted small">Planned</div><div className="display" style={{ fontSize: '1.5rem' }}>{p.planned_total}</div></div>
            <div><div className="muted small">Done</div><div className="display" style={{ fontSize: '1.5rem' }}>{p.actual_total}</div></div>
          </div>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <span className="muted small">Record what you actually did in your daily update.</span><span className="spacer" />
          <Link className="btn sm" to="/productivity">Open My day</Link></div>
      </Card>
      {err ? <ErrorBox error={err} /> : null}
    </>
  );
}
