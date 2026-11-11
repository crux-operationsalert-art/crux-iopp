import { useEffect, useMemo, useState } from 'react';
import { Me, rpc, has, errText } from '../lib/api';
import { Card, ErrorBox, Loading, useLoad } from '../components/ui';
import { HelpTip } from '../components/HelpTip';
import { Icon } from '../components/Icon';

const clamp = (n: number) => Math.max(0, Math.min(10, Math.round(n * 10) / 10));
const sum = (o: Record<string, unknown>) => Object.values(o).reduce((a: number, v) => a + Number(v || 0), 0);
const monLabel = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const mondayOf = (iso: string) => { const t = new Date(iso); const day = (t.getDay() + 6) % 7; const m = new Date(t.getFullYear(), t.getMonth(), t.getDate() - day); return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-${String(m.getDate()).padStart(2, '0')}`; };

/** A 0–10 bar with a tone by value. */
function ScoreBar({ v, label }: { v: number | null | undefined; label?: string }) {
  const n = v == null ? null : Number(v);
  const tone = n == null ? 'var(--muted)' : n >= 7.5 ? 'var(--ok)' : n >= 5 ? 'var(--warn)' : 'var(--bad)';
  return (
    <div className="scorebar">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        {label && <span className="small muted">{label}</span>}
        <b style={{ color: tone }}>{n == null ? '—' : n.toFixed(1)}<span className="muted small"> / 10</span></b>
      </div>
      <div className="bar"><div style={{ width: `${(n ?? 0) * 10}%`, background: tone }} /></div>
    </div>
  );
}

export default function Reviews({ me }: { me: Me }) {
  const scorer = me.manages_operations || me.manages_collections || has(me, 'admin', 'hr_admin', 'ops_head', 'collections_head');
  return (
    <div className="stack">
      <div className="topbar"><div><h1>Reviews &amp; scores<HelpTip k="reviews" /></h1>
        <div className="small muted">Score out of 10 — 75% KPIs, 25% attributes. You start the month with a self-review; your manager then scores, and HR/Admin finalise it. The monthly scorecard is open from the 25th to the 5th; weekly reviews run all month.</div></div>
      </div>
      <MyReview me={me} />
      {scorer && !(me.hidden_pages ?? []).includes('reviews') && <TeamScoring me={me} />}
    </div>
  );
}

/** The person's own review: self-score during the window, the final once locked, and their weekly reviews. */
function MyReview({ me }: { me: Me }) {
  const d = useLoad(() => rpc<any>('my_review', {}), []);
  if (d.loading) return <Card title="My review"><Loading rows={2} /></Card>;
  if (d.error) return <Card title="My review"><ErrorBox error={d.error} retry={d.reload} /></Card>;
  const r = d.data;
  return (
    <Card title="My review" help="You start each month's review with your own self-score; your manager then scores and HR/Admin finalise it.">
      <div className="stack">
        <div className="small muted">{monLabel(r.month)}</div>
        {r.locked
          ? <LockedScore r={r} />
          : r.window_open
            ? <SelfReview r={r} onSaved={d.reload} />
            : <p className="muted">Your monthly scorecard opens on the 25th. Until then, your weekly reviews below keep the month on track.</p>}
        <MyWeekly pid={me.person_id} />
      </div>
    </Card>
  );
}

function LockedScore({ r }: { r: any }) {
  return (
    <div className="stack">
      {r.self_done && <div className="pill neutral small" style={{ alignSelf: 'flex-start' }}>Self-review submitted</div>}
      <div className="scorerow">
        <div className="scorebig"><div className="display">{Number(r.final).toFixed(1)}</div><div className="muted small">overall / 10</div></div>
        <div className="stack" style={{ flex: 1 }}>
          <ScoreBar v={r.kpi_final} label="KPIs (75%)" />
          <ScoreBar v={r.attr_final} label="Attributes (25%)" />
        </div>
      </div>
      {r.manager_note && <div className="banner info"><b>Manager note:</b> {r.manager_note}</div>}
      {r.breakdown && <Breakdown sheet={r.breakdown} />}
    </div>
  );
}

function SelfReview({ r, onSaved }: { r: any; onSaved: () => void }) {
  const [kpi, setKpi] = useState(String(r.self_kpi ?? 7));
  const [attr, setAttr] = useState(String(r.self_attr ?? 7));
  const list = (r.attributes ?? []) as AttrDef[];
  const [each, setEach] = useState<Record<string, string>>(() => initEach(list, r.self_attr_scores));
  const attrVal = list.length ? avgEach(list, each) : Number(attr) || 0;
  const [note, setNote] = useState(r.self_note ?? '');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null); const [msg, setMsg] = useState('');
  const sheet = r.sheet;
  const kFinal = clamp((Number(kpi) || 0) + sum(sheet.kpi.adjustments));
  const aFinal = clamp(attrVal + sum(sheet.attr.adjustments));
  async function save() {
    setBusy(true); setErr(null); setMsg('');
    try { if (list.length) await rpc('self_score_attrs', { p_month: r.month, p_kpi: Number(kpi), p_scores: numEach(each), p_note: note.trim() || null });
      else await rpc('self_score', { p_month: r.month, p_kpi: Number(kpi), p_attr: Number(attr), p_note: note.trim() || null }); setMsg('Self-review submitted.'); onSaved(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <div className="stack">
      {r.self_done
        ? <div className="banner ok row"><Icon name="check" size={14} /><span>Self-review submitted — your manager will score next. You can still update it until it's locked.</span></div>
        : <div className="banner info">Start your review: score yourself honestly. The numbers adjust it the same way they adjust your manager's score.</div>}
      <div className="scoregrid">
        <div className="stack">
          <label className="field">My KPI self-score (0–10)
            <input type="number" min={0} max={10} step={0.5} value={kpi} onChange={(e) => setKpi(e.target.value)} className="num" style={{ width: 90 }} /></label>
          <AdjList title="KPI adjustments" measures={sheet.kpi.measures} adj={sheet.kpi.adjustments} kind="kpi" />
          <ScoreBar v={kFinal} label="Adjusted KPI" />
        </div>
        <div className="stack">
          {list.length ? <AttrInputs list={list} each={each} onChange={setEach} avg={attrVal} label="My attributes — rate yourself on each (0–10)" />
            : <label className="field">My attributes self-score (0–10)
            <input type="number" min={0} max={10} step={0.5} value={attr} onChange={(e) => setAttr(e.target.value)} className="num" style={{ width: 90 }} /></label>}
          <AdjList title="Attribute adjustments" measures={sheet.attr.measures} adj={sheet.attr.adjustments} kind="attr" isManager={sheet.attr.is_manager} />
          <ScoreBar v={aFinal} label="Adjusted attributes" />
        </div>
      </div>
      <label className="field">My note — what went well, what I'll improve<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <div className="row"><button className="btn primary" disabled={busy || (list.length > 0 && !filledEach(list, each))} onClick={save}>{busy ? 'Saving…' : r.self_done ? 'Update my self-review' : 'Submit self-review'}</button>{msg && <span className="pill ok small">{msg}</span>}</div>
      {err ? <div className="banner bad">{errText(err)}</div> : null}
    </div>
  );
}

function MyWeekly({ pid }: { pid: string }) {
  const d = useLoad(() => rpc<any[]>('weekly_reviews', { p_person: pid, p_weeks: 8 }), [pid]);
  const rows = (d.data ?? []) as any[];
  if (!rows.length) return null;
  return <details className="weekly"><summary>My weekly reviews</summary><WeeklyTable rows={rows} /></details>;
}

/** Manager / HR / Admin: score reports (when the window is open) and add weekly reviews. */
function TeamScoring({ me }: { me: Me }) {
  const d = useLoad(() => rpc<any>('team_scores', {}), []);
  const [openScore, setOpenScore] = useState<string | null>(null);
  const [openWeek, setOpenWeek] = useState<string | null>(null);
  if (d.loading) return <Card title="My team"><Loading rows={3} /></Card>;
  if (d.error) return <Card title="My team"><ErrorBox error={d.error} retry={d.reload} /></Card>;
  const data = d.data; const rows = (data?.rows ?? []) as any[];
  const windowOpen = !!data?.window_open; const canLock = !!data?.can_lock;
  const title = data?.hr_view ? 'Everyone — monthly scores (HR/Admin)' : 'My team — reviews';
  const statusPill = (s: string, self: boolean) => s === 'locked' ? <span className="pill ok small">locked</span>
    : s === 'scored' ? <span className="pill warn small">scored</span>
    : self ? <span className="pill info small">self-review in</span> : <span className="pill small">not started</span>;
  return (
    <Card title={title} help="Weekly reviews run all month. The monthly score (manager gives a base, the numbers adjust it) is open from the 25th to the 5th. Each person starts their month with a self-review.">
      {!windowOpen && <div className="banner info" style={{ marginBottom: 10 }}>Monthly scoring is closed — it opens on the 25th. You can still add weekly reviews.</div>}
      {rows.length === 0 ? <p className="muted">No team members.</p> : (
        <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Person</th><th>Status</th><th className="num">Final</th><th></th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.person_id}>
            <td><b>{r.full_name}</b>{r.designation && <div className="small muted">{r.designation}</div>}</td>
            <td>{statusPill(r.status, r.self_done)}</td>
            <td className="num">{r.final == null ? <span className="muted">—</span> : <b>{Number(r.final).toFixed(1)}</b>}</td>
            <td className="num"><div className="row" style={{ justifyContent: 'flex-end' }}>
              {r.can_edit && <button className="btn sm" onClick={() => { setOpenWeek(openWeek === r.person_id ? null : r.person_id); setOpenScore(null); }}>{openWeek === r.person_id ? 'Close' : 'Weekly'}</button>}
              {windowOpen && (r.can_edit || canLock) && <button className="btn sm" onClick={() => { setOpenScore(openScore === r.person_id ? null : r.person_id); setOpenWeek(null); }}>{openScore === r.person_id ? 'Close' : 'Score'}</button>}
            </div></td>
          </tr>)}</tbody></table></div>)}
      {openScore && <ScorePanel key={'s' + openScore} person={openScore} canLock={canLock} onSaved={d.reload} />}
      {openWeek && <div className="panel"><WeeklyReview person={openWeek} name={rows.find((x) => x.person_id === openWeek)?.full_name} today={me.today} /></div>}
    </Card>
  );
}

function ScorePanel({ person, canLock, onSaved }: { person: string; canLock: boolean; onSaved: () => void }) {
  const d = useLoad(() => rpc<any>('score_preview', { p_person: person }), [person]);
  if (d.loading) return <div className="panel"><Loading rows={3} /></div>;
  if (d.error) return <div className="panel"><ErrorBox error={d.error} retry={d.reload} /></div>;
  return <ScorePanelBody pv={d.data} person={person} canLock={canLock} onSaved={() => { d.reload(); onSaved(); }} />;
}

function ScorePanelBody({ pv, person, canLock, onSaved }: { pv: any; person: string; canLock: boolean; onSaved: () => void }) {
  const [kpi, setKpi] = useState<string>(String(pv.kpi_given ?? pv.self_kpi ?? 7));
  const [attr, setAttr] = useState<string>(String(pv.attr_given ?? pv.self_attr ?? 7));
  const [note, setNote] = useState<string>(pv.note ?? '');
  const list = (pv.attributes ?? []) as AttrDef[];
  const [each, setEach] = useState<Record<string, string>>(() => initEach(list, pv.attr_scores ?? pv.self_attr_scores));
  const attrVal = list.length ? avgEach(list, each) : Number(attr) || 0;
  const [busy, setBusy] = useState(''); const [err, setErr] = useState<unknown>(null); const [msg, setMsg] = useState('');
  const locked = pv.locked; const sheet = pv.sheet; const w = sheet.weights;
  const canEdit = pv.can_edit && (!locked || canLock);
  const kFinal = clamp((Number(kpi) || 0) + sum(sheet.kpi.adjustments));
  const aFinal = clamp(attrVal + sum(sheet.attr.adjustments));
  const final = Math.round((Number(w.kpi) * kFinal + Number(w.attr) * aFinal) * 10) / 10;
  useEffect(() => { setKpi(String(pv.kpi_given ?? pv.self_kpi ?? 7)); setAttr(String(pv.attr_given ?? pv.self_attr ?? 7)); setNote(pv.note ?? ''); }, [pv]);

  async function run(label: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(label); setErr(null); setMsg('');
    try { await fn(); setMsg(ok); onSaved(); } catch (e) { setErr(e); } finally { setBusy(''); }
  }
  const save = () => run('save', () => (list.length
    ? rpc('save_score_attrs', { p_person: person, p_month: pv.month, p_kpi_given: Number(kpi), p_scores: numEach(each), p_note: note.trim() || null })
    : rpc('save_score', { p_person: person, p_month: pv.month, p_kpi_given: Number(kpi), p_attr_given: Number(attr), p_note: note.trim() || null })), 'Saved.');
  const lock = () => run('lock', () => rpc('lock_score', { p_person: person, p_month: pv.month }), 'Locked.');
  const reopen = () => run('reopen', () => rpc('reopen_score', { p_person: person, p_month: pv.month }), 'Reopened.');

  return (
    <div className="panel stack">
      <div className="row"><b>{pv.full_name}</b>{pv.designation && <span className="muted small">· {pv.designation}</span>}<span className="spacer" />
        {locked ? <span className="pill ok small"><Icon name="check" size={12} /> locked</span> : pv.status === 'scored' ? <span className="pill warn small">scored, not locked</span> : null}</div>

      {!pv.self_done && <div className="banner warn">Waiting for {pv.full_name?.split(' ')[0]}'s self-review — they start the review before you score.</div>}
      {pv.self_done && (pv.self_kpi != null || pv.self_attr != null) &&
        <div className="banner info small">Self-review: KPI <b>{pv.self_kpi}</b> · Attributes <b>{pv.self_attr}</b>{pv.self_note ? ` — “${pv.self_note}”` : ''}</div>}

      <div className="scoregrid">
        <div className="stack">
          <label className="field">KPI score (0–10)
            <input type="number" min={0} max={10} step={0.5} value={kpi} disabled={!canEdit} onChange={(e) => setKpi(e.target.value)} className="num" style={{ width: 90 }} /></label>
          <AdjList title="KPI adjustments" measures={sheet.kpi.measures} adj={sheet.kpi.adjustments} kind="kpi" />
          <ScoreBar v={kFinal} label="Adjusted KPI" />
        </div>
        <div className="stack">
          {list.length ? <AttrInputs list={list} each={each} onChange={setEach} avg={attrVal} disabled={!canEdit} self={pv.self_attr_scores} label="Attributes — rate each (0–10)" />
            : <label className="field">Attributes score (0–10)
            <input type="number" min={0} max={10} step={0.5} value={attr} disabled={!canEdit} onChange={(e) => setAttr(e.target.value)} className="num" style={{ width: 90 }} /></label>}
          <AdjList title="Attribute adjustments" measures={sheet.attr.measures} adj={sheet.attr.adjustments} kind="attr" isManager={sheet.attr.is_manager} />
          <ScoreBar v={aFinal} label="Adjusted attributes" />
        </div>
      </div>

      <div className="scorerow">
        <div className="scorebig"><div className="display">{final.toFixed(1)}</div><div className="muted small">final / 10</div></div>
        <div className="muted small">{Math.round(Number(w.kpi) * 100)}% KPI + {Math.round(Number(w.attr) * 100)}% attributes</div>
      </div>

      {pv.can_edit && <label className="field">Note for {pv.full_name?.split(' ')[0]} (shown when finalised)
        <textarea rows={2} value={note} disabled={!canEdit} onChange={(e) => setNote(e.target.value)} placeholder="What went well, what to focus on next month" /></label>}

      <div className="row">
        {canEdit && pv.self_done && <button className="btn primary" disabled={busy === 'save' || (list.length > 0 && !filledEach(list, each))} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save score'}</button>}
        {canLock && !locked && pv.status === 'scored' && <button className="btn" disabled={busy === 'lock'} onClick={lock}>{busy === 'lock' ? 'Locking…' : 'Lock month'}</button>}
        {canLock && locked && <button className="btn" disabled={busy === 'reopen'} onClick={reopen}>{busy === 'reopen' ? 'Reopening…' : 'Reopen'}</button>}
        {msg && <span className="pill ok small">{msg}</span>}
      </div>
      {err ? <div className="banner bad">{errText(err)}</div> : null}
    </div>
  );
}

type AttrDef = { id: string; name: string; description: string | null };
const initEach = (list: AttrDef[], saved?: Record<string, number> | null) => Object.fromEntries(list.map((a) => [a.id, saved?.[a.id] != null ? String(saved[a.id]) : '']));
const filledEach = (list: AttrDef[], each: Record<string, string>) => list.every((a) => each[a.id] !== '' && Number(each[a.id]) >= 0 && Number(each[a.id]) <= 10);
const avgEach = (list: AttrDef[], each: Record<string, string>) => { const v = list.map((a) => each[a.id]).filter((x) => x !== '').map(Number); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : 0; };
const numEach = (each: Record<string, string>) => Object.fromEntries(Object.entries(each).map(([k, v]) => [k, Number(v)]));

/** One 0–10 input per assigned attribute; the attribute score is their average. */
function AttrInputs({ list, each, onChange, avg, disabled, self, label }: { list: AttrDef[]; each: Record<string, string>; onChange: (e: Record<string, string>) => void; avg: number; disabled?: boolean; self?: Record<string, number> | null; label: string }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="small"><b>{label}</b></div>
      {list.map((a) => <label key={a.id} className="attrscore">
        <span>{a.name}{self?.[a.id] != null && <span className="small muted"> · self {self[a.id]}</span>}</span>
        <input type="number" min={0} max={10} step={0.5} value={each[a.id] ?? ''} disabled={disabled} onChange={(e) => onChange({ ...each, [a.id]: e.target.value })} className="num" style={{ width: 80 }} aria-label={a.name} /></label>)}
      <div className="small muted">Average: <b>{avg.toFixed(1)}</b></div>
    </div>
  );
}

const KPI_LABEL: Record<string, string> = { achievement: 'Achievement vs target', tat: 'TAT / punctuality', commitment: 'Commitment %', attendance: 'Attendance' };
const ATTR_LABEL: Record<string, string> = { self_shrinkage: 'Self shrinkage', team_shrinkage: 'Team shrinkage', team_performance: 'Team performance', growth: 'Growth' };
const fmtDelta = (n: number) => (n === 0 ? '0' : (n > 0 ? '+' : '') + n);

function AdjList({ title, measures, adj, kind, isManager }: { title: string; measures: any; adj: Record<string, number>; kind: 'kpi' | 'attr'; isManager?: boolean }) {
  // Team factors only make sense for managers — hide them for everyone else.
  const keys = kind === 'kpi' ? Object.keys(KPI_LABEL)
    : Object.keys(ATTR_LABEL).filter((k) => isManager || (k !== 'team_shrinkage' && k !== 'team_performance'));
  const labels = kind === 'kpi' ? KPI_LABEL : ATTR_LABEL;
  const note = (k: string): string => {
    if (kind === 'kpi') {
      if (k === 'achievement') return measures.achievement_pct == null ? 'no target set' : `${measures.achievement_pct}% of target`;
      if (k === 'tat') return measures.late_share == null ? 'nothing reported yet' : `${Math.round(measures.late_share * 100)}% late`;
      if (k === 'commitment') return measures.commitment_avg == null ? 'not planned' : `${measures.commitment_avg}% avg`;
      if (k === 'attendance') return measures.miss_share == null ? '—' : `${Math.round(measures.miss_share * 100)}% missed`;
    } else {
      if (k === 'self_shrinkage') return `${Math.round((measures.miss_share || 0) * 100)}% own days missed`;
      if (k === 'team_shrinkage') return `${measures.team_exits} of ${measures.team_size} left`;
      if (k === 'team_performance') return measures.team_achievement == null ? 'no team figures' : `team at ${measures.team_achievement}%`;
      if (k === 'growth') return measures.achievement_prev == null ? 'no prior month' : `${measures.achievement_prev}% → ${measures.achievement_now}%`;
    }
    return '';
  };
  return (
    <div className="adjlist">
      <div className="small muted" style={{ marginBottom: 4 }}>{title}</div>
      {keys.map((k) => {
        const n = Number(adj[k] || 0);
        return <div key={k} className="adjrow">
          <span>{labels[k]} <span className="muted small">· {note(k)}</span></span>
          <b className={n > 0 ? 'pos' : n < 0 ? 'neg' : 'muted'}>{fmtDelta(n)}</b>
        </div>;
      })}
    </div>
  );
}

function WeeklyTable({ rows }: { rows: any[] }) {
  return (
    <div className="tablewrap"><table><thead><tr><th>Week of</th><th className="num">Commit</th><th className="num">Ach.</th><th>Review</th><th>Focus</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.week_start}>
        <td className="small">{new Date(r.week_start).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
        <td className="num small">{r.commitment_pct == null ? '—' : `${r.commitment_pct}%`}</td>
        <td className="num small">{r.achievement_pct == null ? '—' : `${r.achievement_pct}%`}</td>
        <td className="small">{r.review_note}</td><td className="small muted">{r.focus_note}</td>
      </tr>)}</tbody></table></div>
  );
}

/** Weekly review note + focus for one person (direct manager). */
function WeeklyReview({ person, name, today }: { person: string; name: string; today: string }) {
  const d = useLoad(() => rpc<any[]>('weekly_reviews', { p_person: person, p_weeks: 8 }), [person]);
  const thisWeek = useMemo(() => mondayOf(today), [today]);
  const [review, setReview] = useState(''); const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [err, setErr] = useState<unknown>(null);
  async function save() {
    setBusy(true); setErr(null); setMsg('');
    try { await rpc('save_weekly_review', { p_person: person, p_week_start: thisWeek, p_review: review.trim() || null, p_focus: focus.trim() || null }); setMsg('Saved.'); setReview(''); setFocus(''); d.reload(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const rows = (d.data ?? []) as any[];
  return (
    <div className="stack">
      <div className="row"><b>Weekly review — {name}</b><span className="muted small">so the month isn't scored cold</span></div>
      <label className="field">This week — how it went
        <textarea rows={2} value={review} onChange={(e) => setReview(e.target.value)} placeholder={`e.g. ${name?.split(' ')[0]} cleared the SBI backlog`} /></label>
      <label className="field">Next week — focus
        <input className="input" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. start fresh allocations early" /></label>
      <div className="row"><button className="btn sm primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save weekly review'}</button>{msg && <span className="pill ok small">{msg}</span>}</div>
      {err ? <div className="banner bad">{errText(err)}</div> : null}
      {rows.length > 0 && <WeeklyTable rows={rows} />}
    </div>
  );
}

/** Read-only breakdown shown to the person on their own locked review. */
function Breakdown({ sheet }: { sheet: any }) {
  return (
    <details className="weekly"><summary>How this was worked out</summary>
      <div className="scoregrid" style={{ marginTop: 8 }}>
        <AdjList title="KPI adjustments" measures={sheet.kpi.measures} adj={sheet.kpi.adjustments} kind="kpi" />
        <AdjList title="Attribute adjustments" measures={sheet.attr.measures} adj={sheet.attr.adjustments} kind="attr" isManager={sheet.attr.is_manager} />
      </div>
    </details>
  );
}
