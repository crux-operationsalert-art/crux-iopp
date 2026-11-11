import { useEffect, useMemo, useState } from 'react';
import { rpc, errText } from '../lib/api';
import { Card, Empty, ErrorBox, Loading, useLoad } from './ui';
import { Icon } from './Icon';

type Lib = { kpi_id: string; name: string; unit: string | null; department: string; description: string | null; auto: boolean; cadence: string; higher_better: boolean; recommended?: boolean; target?: number | null };
type Attr = { id: string; name: string; description: string | null; recommended: boolean };
type Pick = { target: string; cadence: string; higher_better: boolean };
const MIN = 3, MAX = 5;
const BASIS: [string, string][] = [['monthly', 'for the month'], ['weekly', 'per week'], ['daily', 'per day']];

/** A short worked example so a manager sees how a KPI is set, using operations and collections. */
export function HowKpisWork() {
  return (
    <Card title="How KPIs work here" collapsible collapseKey="kpi-how" help="Operations and collections already work this way. Every other department follows the same three steps.">
      <ol className="howsteps">
        <li><b>Pick 3 to 5 KPIs</b> for each person from their department's list. You only see the KPIs that fit their department and role.</li>
        <li><b>Give each a target</b> — normally for the month, set at the start of the month. You can make it per week or per day, and say whether higher or lower is better.</li>
        <li><b>Pick 3 to 5 attributes</b> you will rate them on. That's it — it stays in force every month until you change it.</li>
      </ol>
      <div className="howex">
        <div className="howrow"><span className="pill info small">Operations</span><span><b>Cases Closed – Volume</b> · target 400 for the month</span><span className="muted small">counted automatically from the daily update</span></div>
        <div className="howrow"><span className="pill info small">Collections</span><span><b>Collections Received – Value (₹)</b> · target ₹25,00,000 for the month</span><span className="muted small">counted automatically from collection entries</span></div>
        <div className="howrow"><span className="pill neutral small">Any department</span><span><b>Invoice Accuracy – Rate %</b> · target 98 for the month</span><span className="muted small">the person enters planned and done on their KPI page</span></div>
      </div>
    </Card>
  );
}

/** The reporting manager's list of people with how complete each scorecard is. */
export function TeamSetup() {
  const d = useLoad(() => rpc<any>('scorecard_team', {}), []);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const rows = ((d.data?.rows ?? []) as any[]).filter((r) => !q || r.full_name.toLowerCase().includes(q.toLowerCase()));
  const all = (d.data?.rows ?? []) as any[];
  const ready = all.filter((r) => r.ready).length;
  const chip = (n: number, label: string) => <span className={`pill small ${n >= MIN && n <= MAX ? 'ok' : n > 0 ? 'warn' : 'neutral'}`}>{label} {n}/{MIN}–{MAX}</span>;
  return (
    <Card title={d.data?.hr_view ? 'Set KPIs & attributes — everyone' : 'Set KPIs & attributes — my team'}
      help="Each person needs 3 to 5 KPIs with targets and 3 to 5 attributes. Set once; change any time."
      action={all.length > 0 ? <span className="small muted">{ready} of {all.length} set</span> : undefined}>
      {d.loading ? <Loading rows={3} /> : d.error ? <ErrorBox error={d.error} retry={d.reload} /> : all.length === 0 ? <Empty>No one reports to you yet.</Empty> : (
        <div className="stack">
          {all.length > 8 && <label className="field">Find a person<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name" /></label>}
          {rows.map((r) => <div key={r.person_id} className="scperson">
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 160 }}><b>{r.full_name}</b><div className="small muted">{[r.designation, r.department].filter(Boolean).join(' · ')}</div></div>
              {chip(r.kpis, 'KPIs')}{chip(r.attributes, 'Attributes')}
              <button className={`btn sm${r.ready ? '' : ' primary'}`} onClick={() => setOpen(open === r.person_id ? null : r.person_id)}>{open === r.person_id ? 'Close' : r.ready ? 'Change' : 'Set up'}</button>
            </div>
            {open !== r.person_id && (r.kpi_list?.length > 0 || r.attr_list?.length > 0) && <div className="scsum small">
              {r.kpi_list?.length > 0 && <div><span className="muted">KPIs: </span>{r.kpi_list.map((k: any) => `${k.name} (${Number(k.target).toLocaleString('en-IN')}${k.cadence === 'monthly' ? '' : k.cadence === 'weekly' ? '/week' : '/day'})`).join(' · ')}</div>}
              {r.attr_list?.length > 0 && <div><span className="muted">Attributes: </span>{r.attr_list.join(' · ')}</div>}
            </div>}
            {open === r.person_id && <PersonSetup person={r.person_id} onSaved={() => { setOpen(null); d.reload(); }} />}
          </div>)}
        </div>)}
    </Card>
  );
}

function PersonSetup({ person, onSaved }: { person: string; onSaved: () => void }) {
  const [dept, setDept] = useState<string | null>(null);
  const d = useLoad(() => rpc<any>('scorecard_person', { p_person: person, p_department: dept }), [person, dept]);
  const [picks, setPicks] = useState<Record<string, Pick> | null>(null);
  const [attrs, setAttrs] = useState<string[] | null>(null);
  const [meta, setMeta] = useState<Record<string, Lib>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);

  useEffect(() => {
    if (!d.data) return;
    setMeta((m) => { const n = { ...m }; for (const k of [...d.data.library, ...d.data.kpis] as Lib[]) n[k.kpi_id] = { ...n[k.kpi_id], ...k }; return n; });
    setPicks((p) => p ?? Object.fromEntries((d.data.kpis as Lib[]).map((k) => [k.kpi_id, { target: k.target == null ? '' : String(k.target), cadence: k.cadence, higher_better: k.higher_better }])));
    setAttrs((a) => a ?? (d.data.attributes as string[]));
  }, [d.data]);

  if (!d.data || !picks || !attrs) return <div className="panel">{d.error ? <ErrorBox error={d.error} retry={d.reload} /> : <Loading rows={3} />}</div>;
  const s = d.data; const library = s.library as Lib[]; const alib = s.attribute_library as Attr[];
  const chosen = Object.keys(picks);
  const extra = chosen.filter((id) => !library.some((k) => k.kpi_id === id));       // chosen from another department
  const nK = chosen.length, nA = attrs.length;
  const targetsOk = chosen.every((id) => Number(picks[id].target) > 0);
  const canSave = nK >= MIN && nK <= MAX && nA >= MIN && nA <= MAX && targetsOk;
  const toggle = (k: Lib) => setPicks((p) => { const n = { ...p! }; if (n[k.kpi_id]) delete n[k.kpi_id]; else if (Object.keys(n).length < MAX) n[k.kpi_id] = { target: '', cadence: k.auto ? 'monthly' : k.cadence, higher_better: k.higher_better }; return n; });
  const upd = (id: string, patch: Partial<Pick>) => setPicks((p) => ({ ...p!, [id]: { ...p![id], ...patch } }));
  const toggleAttr = (id: string) => setAttrs((a) => (a!.includes(id) ? a!.filter((x) => x !== id) : a!.length < MAX ? [...a!, id] : a!));

  async function save() {
    setBusy(true); setErr(null);
    try {
      await rpc('scorecard_save', { p_person: person, p_department: s.department,
        p_kpis: chosen.map((id) => ({ kpi_id: id, target: Number(picks![id].target), cadence: picks![id].cadence, higher_better: picks![id].higher_better })), p_attributes: attrs });
      onSaved();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }

  const row = (k: Lib) => {
    const on = !!picks[k.kpi_id]; const p = picks[k.kpi_id];
    return (
      <div key={k.kpi_id} className={`sckpi${on ? ' on' : ''}`}>
        <button type="button" className="sckpi-head" aria-pressed={on} disabled={!on && nK >= MAX} onClick={() => toggle(k)}>
          <span className="tick" aria-hidden>{on ? <Icon name="check" size={13} /> : null}</span>
          <span style={{ flex: 1, textAlign: 'left' }}><b>{k.name}</b>{k.description && <span className="small muted" style={{ display: 'block' }}>{k.description}</span>}</span>
          {k.auto && <span className="pill info small">automatic</span>}{k.recommended && !k.auto && <span className="pill neutral small">fits this role</span>}
        </button>
        {on && <div className="kpiform sckpi-body">
          <label className="field">Target{k.unit ? ` (${k.unit})` : ''}<input type="number" inputMode="decimal" min={0} className="num" value={p.target} onChange={(e) => upd(k.kpi_id, { target: e.target.value })} /></label>
          {k.auto ? <span className="small muted" style={{ alignSelf: 'center' }}>for the month · higher is better · counted automatically</span> : <>
            <label className="field">Target is<select className="input" value={p.cadence} onChange={(e) => upd(k.kpi_id, { cadence: e.target.value })}>{BASIS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="field">Better when<select className="input" value={p.higher_better ? '1' : '0'} onChange={(e) => upd(k.kpi_id, { higher_better: e.target.value === '1' })}><option value="1">higher</option><option value="0">lower</option></select></label></>}
        </div>}
      </div>);
  };

  return (
    <div className="panel stack">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <label className="field" style={{ minWidth: 220 }}>Department
          <select className="input" value={s.department} onChange={(e) => setDept(e.target.value)}>
            {!(s.departments as string[]).includes(s.department) && <option value={s.department}>{s.department}</option>}
            {(s.departments as string[]).map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
        <span className="small muted" style={{ alignSelf: 'flex-end' }}>Showing KPIs for this department, best fit for a{/^[aeiou]/.test(s.person.level) ? 'n' : ''} {s.person.level} first.</span>
      </div>

      <div className="row"><b>KPIs</b><span className={`pill small ${nK >= MIN ? 'ok' : 'warn'}`}>{nK} chosen · need {MIN}–{MAX}</span></div>
      <div className="stack" style={{ gap: 6 }}>
        {extra.map((id) => meta[id] && row(meta[id]))}
        {library.map(row)}
      </div>
      <AddKpi department={s.department} onAdded={(k) => { setMeta((m) => ({ ...m, [k.kpi_id]: k })); setPicks((p) => (p![k.kpi_id] || Object.keys(p!).length >= MAX ? p! : { ...p!, [k.kpi_id]: { target: '', cadence: 'monthly', higher_better: k.higher_better } })); d.reload(); }} />

      <div className="row" style={{ marginTop: 6 }}><b>Attributes</b><span className={`pill small ${nA >= MIN ? 'ok' : 'warn'}`}>{nA} chosen · need {MIN}–{MAX}</span></div>
      <div className="attrgrid">
        {alib.map((a) => { const on = attrs.includes(a.id); return (
          <button key={a.id} type="button" className={`attrchip${on ? ' on' : ''}`} aria-pressed={on} disabled={!on && nA >= MAX} onClick={() => toggleAttr(a.id)}>
            <b>{a.name}</b><span className="small muted">{a.description}</span></button>); })}
      </div>

      {err ? <div className="banner bad">{errText(err)}</div> : null}
      <div className="row"><button className="btn primary" disabled={busy || !canSave} onClick={save}>{busy ? 'Saving…' : `Save for ${s.person.full_name?.split(' ')[0]}`}</button>
        {!canSave && <span className="small muted">{nK < MIN ? `Pick ${MIN - nK} more KPI${MIN - nK > 1 ? 's' : ''}. ` : ''}{!targetsOk && nK > 0 ? 'Give every KPI a target. ' : ''}{nA < MIN ? `Pick ${MIN - nA} more attribute${MIN - nA > 1 ? 's' : ''}.` : ''}</span>}</div>
    </div>
  );
}

const MEASURES: [string, string][] = [['count', 'a count (how many)'], ['percent', 'a percentage'], ['time', 'time taken'], ['amount', 'an amount in ₹'], ['rating', 'a quality score out of 10']];

/** Add a KPI that is not in the list. The manager says what is measured; the name is built by the system so all KPIs read alike. */
function AddKpi({ department, onAdded }: { department: string; onAdded: (k: Lib) => void }) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(''); const [measure, setMeasure] = useState('count'); const [unit, setUnit] = useState('days');
  const [pv, setPv] = useState<any>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const args = useMemo(() => ({ p_department: department, p_subject: subject, p_measure: measure, p_time_unit: unit }), [department, subject, measure, unit]);
  useEffect(() => {
    setPv(null); setErr(null);
    if (subject.trim().length < 3) return;
    const t = setTimeout(() => { rpc<any>('kpi_custom_add', { ...args, p_preview: true }).then(setPv).catch(() => setPv(null)); }, 450);
    return () => clearTimeout(t);
  }, [args, subject]);
  async function add() {
    setBusy(true); setErr(null);
    try {
      const r = await rpc<any>('kpi_custom_add', { ...args, p_preview: false });
      onAdded({ kpi_id: r.kpi_id, name: r.name, unit: r.unit, department, description: null, auto: false, cadence: 'monthly', higher_better: r.higher_better });
      setSubject(''); setOpen(false);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  if (!open) return <button type="button" className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>+ Add a KPI that isn't listed</button>;
  return (
    <div className="scadd stack">
      <div className="kpiform">
        <label className="field" style={{ flex: 1, minWidth: 200 }}>What do you want to measure?<input value={subject} maxLength={80} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. vendor bills checked" /></label>
        <label className="field">It is<select className="input" value={measure} onChange={(e) => setMeasure(e.target.value)}>{MEASURES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        {measure === 'time' && <label className="field">In<select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}><option value="days">days</option><option value="hours">hours</option></select></label>}
      </div>
      {pv && <div className="banner info small">{pv.exists ? <>This already exists as <b>{pv.name}</b> — it will be used, not duplicated.</> : <>It will be named <b>{pv.name}</b> so every KPI reads the same way.</>}</div>}
      {err ? <div className="banner bad">{errText(err)}</div> : null}
      <div className="row"><button type="button" className="btn sm primary" disabled={busy || !pv} onClick={add}>{busy ? 'Adding…' : pv?.exists ? 'Use this KPI' : 'Add this KPI'}</button>
        <button type="button" className="btn sm" onClick={() => setOpen(false)}>Cancel</button></div>
    </div>
  );
}
