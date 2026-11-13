import React, { useMemo, useState } from 'react';
import { Me, rpc, errText, has } from '../lib/api';
import { Card, Empty, ErrorBox, Loading, useLoad } from '../components/ui';
import { HelpTip } from '../components/HelpTip';
import { HowKpisWork, TeamSetup } from '../components/Scorecard';
import { MyScorecard } from '../components/MyScorecard';

type Kpi = { kpi_id: string; department: string; name: string; unit: string | null; cadence: string; higher_better: boolean;
  target: number | null; auto?: boolean; description?: string | null; period: string; planned: number | null; actual: number | null; note: string | null; commitment: number | null };

const periodLabel = (iso: string, cadence: string) => {
  const d = new Date(iso);
  if (cadence === 'monthly') return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  if (cadence === 'weekly') return 'week of ' + d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

/** The KPIs I hold, grouped by department, each with its entry row for the current period. */
function MyKpiCards({ empty }: { empty: React.ReactNode }) {
  const d = useLoad(() => rpc<Kpi[]>('my_kpis', {}), []);
  const rows = (d.data ?? []) as Kpi[];
  const byDept = useMemo(() => {
    const m: Record<string, Kpi[]> = {};
    for (const r of rows) (m[r.department] ??= []).push(r);
    return m;
  }, [rows]);
  if (d.loading) return <Loading rows={3} />;
  if (d.error) return <ErrorBox error={d.error} retry={d.reload} />;
  if (rows.length === 0) return <>{empty}</>;
  return <>{Object.entries(byDept).map(([dept, list]) => (
    <Card key={dept} title={dept}>
      <div className="stack">{list.map((k) => <KpiRow key={k.kpi_id} k={k} onSaved={d.reload} />)}</div>
    </Card>))}</>;
}

/** My KPIs (D-118): each assigned KPI with its target, and plan/actual for the current period. */
export default function Kpis({ me }: { me: Me }) {
  const manager = me.manages_operations || me.manages_collections || has(me, 'admin', 'hr_admin', 'ops_head', 'collections_head', 'zm', 'bm', 'ba', 'manager');
  const at = useLoad(() => rpc<{ id: string; name: string; description: string | null }[]>('my_attributes', {}), []);
  const attrs = at.data ?? [];
  return (
    <div className="stack">
      <div className="topbar"><div><h1>KPIs &amp; attributes<HelpTip k="my kpis" /></h1>
        <div className="small muted">{manager ? 'Your own KPIs, and where you set KPIs, targets and attributes for the people who report to you.' : 'The KPIs and attributes your manager has set for you. Enter what you plan and what you did.'}</div></div></div>
      <MyKpiCards empty={manager ? null : <Card><Empty>No KPIs are set for you yet. Your reporting manager sets these up.</Empty></Card>} />
      {attrs.length > 0 && <Card title="My attributes" help="What your manager rates you on in the monthly review.">
        <div className="attrgrid">{attrs.map((a) => <div key={a.id} className="attrchip on static"><b>{a.name}</b><span className="small muted">{a.description}</span></div>)}</div></Card>}
      {manager && <><HowKpisWork /><TeamSetup /><TeamKpis /></>}
    </div>
  );
}

/** "My update" for people who do not file case or collection figures: their own KPIs are their update (D-145). */
export function KpiDay({ me }: { me: Me }) {
  return (
    <div className="stack">
      <div className="topbar"><div><h1>My update</h1>
        <div className="small muted">{new Date(me.today).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} · enter what you planned and what you did against each of your KPIs. Your manager sees it as you save.</div></div></div>
      <MyScorecard link={false} />
      <MyKpiCards empty={<Card><Empty>No KPIs are set for you yet. Your reporting manager sets these up — once they do, this is where you update them.</Empty></Card>} />
    </div>
  );
}

/** Managers / HR / Admin: this period's plan vs done for every KPI their people hold (D-119). */
function TeamKpis() {
  const d = useLoad(() => rpc<any[]>('kpi_team', {}), []);
  const kpis = (d.data ?? []) as any[];
  return (
    <Card title="My team's KPIs" collapsible help="Each KPI your people hold, with what they planned and did this period. You can type a result for your own people — a quality score, for example — and it saves when you leave the box. These results feed the monthly score.">
      {d.loading ? <Loading rows={2} /> : d.error ? <ErrorBox error={d.error} retry={d.reload} />
        : kpis.length === 0 ? <Empty>None of your people have KPIs assigned yet.</Empty>
        : <div className="stack">{kpis.map((k) => <div key={k.kpi_id} className="kpirow">
            <div><b>{k.name}</b> <span className="muted small">{k.department} · {k.cadence} · {periodLabel(k.period, k.cadence)}</span></div>
            <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Person</th><th className="num">Target</th><th className="num">Planned</th><th className="num">Done</th><th className="num">%</th></tr></thead>
              <tbody>{k.rows.map((r: any) => <tr key={r.person_id}><td>{r.full_name}</td><td className="num">{r.target ?? '—'}</td><td className="num">{r.planned ?? '—'}</td><td className="num">{k.auto ? (r.actual ?? '—') : <DoneCell person={r.person_id} name={r.full_name} kpi={k.kpi_id} value={r.actual} onSaved={d.reload} />}</td>
                <td className="num">{r.commitment == null ? '—' : <span className={`pill ${r.commitment >= 90 ? 'ok' : r.commitment >= 60 ? 'warn' : 'bad'} small`}>{r.commitment}%</span>}</td></tr>)}</tbody></table></div>
          </div>)}</div>}
    </Card>
  );
}

/** A result the reporting manager can enter for their own person (quality score, TAT and the like). */
function DoneCell({ person, name, kpi, value, onSaved }: { person: string; name: string; kpi: string; value: number | null; onSaved: () => void }) {
  const [v, setV] = useState(value == null ? '' : String(value));
  const [st, setSt] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  async function save() {
    if (v === (value == null ? '' : String(value))) return;
    setSt('saving');
    try { await rpc('kpi_entry_for', { p_person: person, p_kpi: kpi, p_actual: v === '' ? null : Number(v), p_note: null }); setSt('saved'); onSaved(); }
    catch (e) { setSt('error'); setMsg(errText(e)); }
  }
  return <span className="row" style={{ justifyContent: 'flex-end', gap: 6, flexWrap: 'nowrap' }}>
    <input type="number" inputMode="decimal" className="num" style={{ width: 84 }} value={v} aria-label={`Result for ${name}`} onChange={(e) => { setV(e.target.value); setSt('idle'); }} onBlur={save} />
    <span className="small" role="status" style={{ minWidth: 14 }}>{st === 'saving' ? '…' : st === 'saved' ? '✓' : st === 'error' ? <span title={msg} style={{ color: 'var(--bad)' }}>!</span> : ''}</span></span>;
}

function KpiRow({ k, onSaved }: { k: Kpi; onSaved: () => void }) {
  const [planned, setPlanned] = useState(k.planned == null ? '' : String(k.planned));
  const [actual, setActual] = useState(k.actual == null ? '' : String(k.actual));
  const [note, setNote] = useState(k.note ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [ok, setOk] = useState('');
  const pct = planned && Number(planned) ? Math.round((Number(actual) || 0) / Number(planned) * 100) : null;
  const tone = pct == null ? 'neutral' : pct >= 90 ? 'ok' : pct >= 60 ? 'warn' : 'bad';
  async function save() {
    setBusy(true); setErr(null); setOk('');
    try {
      await rpc('save_kpi_entry', { p_kpi: k.kpi_id, p_period: k.period, p_planned: planned === '' ? null : Number(planned),
        p_actual: actual === '' ? null : Number(actual), p_note: note.trim() || null });
      setOk('Saved.'); onSaved();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  if (k.auto) {
    const ap = k.commitment; const at = ap == null ? 'neutral' : ap >= 90 ? 'ok' : ap >= 60 ? 'warn' : 'bad';
    return (
      <div className="kpirow">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div><b>{k.name}</b> {k.unit && <span className="muted small">({k.unit})</span>}
            <div className="small muted">{periodLabel(k.period, 'monthly')} · target {k.target ?? '—'} · counted automatically from the daily updates</div></div>
          {ap != null && <span className={`pill ${at} small`}>{ap}%</span>}
        </div>
        <div className="row"><span className="muted small">So far this month</span><b>{k.actual == null ? 'no target set yet' : Number(k.actual).toLocaleString('en-IN') + (k.unit === '%' ? '%' : '')}</b></div>
      </div>);
  }
  return (
    <div className="kpirow">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div><b>{k.name}</b> {k.unit && <span className="muted small">({k.unit})</span>}
          <div className="small muted">{k.cadence} · {periodLabel(k.period, k.cadence)}{k.target != null ? ` · target ${k.target}` : ''}{!k.higher_better ? ' · lower is better' : ''}</div></div>
        {pct != null && <span className={`pill ${tone} small`}>{pct}%</span>}
      </div>
      <div className="kpiform">
        <label className="field">Planned<input type="number" inputMode="decimal" value={planned} onChange={(e) => setPlanned(e.target.value)} className="num" /></label>
        <label className="field">Done<input type="number" inputMode="decimal" value={actual} onChange={(e) => setActual(e.target.value)} className="num" /></label>
        <label className="field" style={{ flex: 1, minWidth: 160 }}>Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" /></label>
      </div>
      <div className="row"><button className="btn sm primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>{ok && <span className="pill ok small">{ok}</span>}</div>
      {err ? <div className="banner bad">{errText(err)}</div> : null}
    </div>
  );
}
