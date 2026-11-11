import { useMemo, useState } from 'react';
import { Me, rpc } from '../lib/api';
import { Card, ErrorBox, Loading, useLoad } from '../components/ui';
import { HelpTip } from '../components/HelpTip';
import { Icon } from '../components/Icon';
import { CommitmentMeter, TeamCommitment } from '../components/Commitment';

const time = (s?: string | null) => (s ? new Date(s).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '');

/** My plan (D-113): check in, plan the day on my KPI lines with a note, and at day's end record what I did → Commitment %. */
export default function Plan({ me }: { me: Me }) {
  const d = useLoad(() => rpc<any>('my_plan', {}), []);
  const manager = me.manages_operations;
  return (
    <div className="stack">
      <div className="topbar"><div><h1>My plan<HelpTip k="my plan" /></h1>
        <div className="small muted">Check in, say what you will do today, and see how it went. Commitment % is what you did out of what you planned.</div></div></div>
      {d.loading ? <Loading rows={4} /> : d.error ? <ErrorBox error={d.error} retry={d.reload} /> : d.data && <PlanBody p={d.data} onChange={d.reload} />}
      {manager && <TeamCommitment />}
    </div>
  );
}

function PlanBody({ p, onChange }: { p: any; onChange: () => void }) {
  const [plan, setPlan] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(p.plan ?? {}).map(([k, v]) => [k, String(v)])));
  const [note, setNote] = useState(p.plan_note ?? '');
  const [done, setDone] = useState(p.done_note ?? '');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const lines = (p.lines ?? []) as { client_location_id: string; client: string; location: string }[];
  const plannedTotal = useMemo(() => Object.values(plan).reduce((a, v) => a + (Number(v) || 0), 0), [plan]);
  const actual = (p.actual ?? {}) as Record<string, number>;
  const pct = p.commitment_pct;

  async function run(label: string, fn: () => Promise<unknown>) { setBusy(label); setErr(null); try { await fn(); onChange(); } catch (e) { setErr(e); } finally { setBusy(''); } }
  const savePlan = () => run('plan', () => rpc('save_plan', { p_work_date: p.work_date, p_planned: plannedTotal || null,
    p_plan: Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, Number(v) || 0]).filter(([, v]) => (v as number) > 0)), p_note: note.trim() || null }));

  return (
    <>
      <Card title="Check in">
        {p.checked_in_at
          ? <div className="row"><span className="pill ok"><Icon name="check" size={14} /> Checked in at {time(p.checked_in_at)}</span><span className="muted small">You are marked at work today.</span></div>
          : <div className="stack"><p className="muted" style={{ margin: 0 }}>Mark that you are at work today so your team knows you are available.</p>
              <button className="btn primary" disabled={busy === 'in'} onClick={() => run('in', () => rpc('self_check_in', { p_note: null }))}>{busy === 'in' ? 'Checking in…' : "I'm at work — check in"}</button></div>}
      </Card>

      <Card title="Plan today" help="Put the number you aim to do on each client, and a short note. You can change it during the day.">
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
            <div className="row"><button className="btn primary" disabled={busy === 'plan'} onClick={savePlan}>{busy === 'plan' ? 'Saving…' : p.committed_at ? 'Update my plan' : 'Save my plan'}</button>
              {p.committed_at && <span className="muted small">planned at {time(p.committed_at)}</span>}</div>
          </div>)}
      </Card>

      <Card title="How I'm doing" help="Commitment % is what you did out of what you planned. It is one of your KPIs.">
        <div className="commit-wrap">
          <CommitmentMeter pct={pct} label={pct == null ? 'Plan your day to start' : `${pct}% of plan`} big />
          <div className="commit-nums">
            <div><div className="muted small">Planned</div><div className="display" style={{ fontSize: '1.5rem' }}>{p.planned_total}</div></div>
            <div><div className="muted small">Done</div><div className="display" style={{ fontSize: '1.5rem' }}>{p.actual_total}</div></div>
          </div>
        </div>
        <label className="field" style={{ marginTop: 10 }}>End of day — what did you do?<textarea rows={2} value={done} onChange={(e) => setDone(e.target.value)} placeholder="e.g. did 7 of 10; 3 held for documents" /></label>
        <div className="row"><button className="btn" disabled={busy === 'close'} onClick={() => run('close', () => rpc('close_plan', { p_work_date: p.work_date, p_done_note: done.trim() || null }))}>{busy === 'close' ? 'Saving…' : p.closed_at ? 'Update wrap-up' : 'Wrap up my day'}</button>
          {p.closed_at && <span className="muted small">wrapped up at {time(p.closed_at)}</span>}</div>
      </Card>
      <ErrorBox error={err} />
    </>
  );
}
