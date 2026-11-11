import { useMemo, useState } from 'react';
import { Me, rpc, errText } from '../lib/api';
import { Card, Empty, ErrorBox, Loading, useLoad } from '../components/ui';
import { HelpTip } from '../components/HelpTip';

type Kpi = { kpi_id: string; department: string; name: string; unit: string | null; cadence: string; higher_better: boolean;
  target: number | null; period: string; planned: number | null; actual: number | null; note: string | null; commitment: number | null };

const periodLabel = (iso: string, cadence: string) => {
  const d = new Date(iso);
  if (cadence === 'monthly') return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  if (cadence === 'weekly') return 'week of ' + d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

/** My KPIs (D-118): each assigned KPI with its target, and plan/actual for the current period. */
export default function Kpis(_props: { me: Me }) {
  const d = useLoad(() => rpc<Kpi[]>('my_kpis', {}), []);
  const rows = (d.data ?? []) as Kpi[];
  const byDept = useMemo(() => {
    const m: Record<string, Kpi[]> = {};
    for (const r of rows) (m[r.department] ??= []).push(r);
    return m;
  }, [rows]);
  return (
    <div className="stack">
      <div className="topbar"><div><h1>My KPIs<HelpTip k="my kpis" /></h1>
        <div className="small muted">Your assigned KPIs. Put what you plan and what you did for the current period — like My&nbsp;day, for your department.</div></div></div>
      {d.loading ? <Loading rows={3} /> : d.error ? <ErrorBox error={d.error} retry={d.reload} />
        : rows.length === 0 ? <Card><Empty>No KPIs are assigned to you yet. HR/Admin set these up per department.</Empty></Card>
        : Object.entries(byDept).map(([dept, list]) => (
          <Card key={dept} title={dept}>
            <div className="stack">{list.map((k) => <KpiRow key={k.kpi_id} k={k} onSaved={d.reload} />)}</div>
          </Card>))}
    </div>
  );
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
