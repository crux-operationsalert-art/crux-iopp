import { useEffect, useMemo, useState } from 'react';
import { Me, rpc, has, errText } from '../lib/api';
import { Card, ErrorBox, Loading, useLoad } from '../components/ui';
import { HelpTip } from '../components/HelpTip';
import { Icon } from '../components/Icon';

const clamp = (n: number) => Math.max(0, Math.min(10, Math.round(n * 10) / 10));
const sum = (o: Record<string, unknown>) => Object.values(o).reduce((a: number, v) => a + Number(v || 0), 0);
const monthStart = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
const monLabel = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

function lastMonths(today: string, n: number) {
  const base = new Date(today); const out: string[] = [];
  for (let i = 0; i < n; i++) { const d = new Date(base.getFullYear(), base.getMonth() - i, 1); out.push(monthStart(d)); }
  return out;
}

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
  const months = useMemo(() => lastMonths(me.today, 3), [me.today]);
  const [month, setMonth] = useState(months[0]);
  return (
    <div className="stack">
      <div className="topbar"><div><h1>Reviews &amp; scores<HelpTip k="reviews" /></h1>
        <div className="small muted">Monthly score out of 10 — 75% from KPIs, 25% from attributes. The numbers adjust a given score so it stays fair.</div></div>
        <select className="input" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
          {months.map((m) => <option key={m} value={m}>{monLabel(m)}</option>)}</select>
      </div>
      <MyReview month={month} />
      {scorer && <TeamScoring month={month} />}
    </div>
  );
}

/** The person's own score — visible only once HR/Admin has locked it. */
function MyReview({ month }: { month: string }) {
  const d = useLoad(() => rpc<any>('my_score', { p_month: month }), [month]);
  if (d.loading) return <Card title="My review"><Loading rows={2} /></Card>;
  const s = d.data;
  return (
    <Card title="My review" help="Your monthly score. It appears here once HR/Admin has locked the month.">
      {!s?.available
        ? <p className="muted">Your review for {monLabel(month)} will appear here once HR/Admin has finalised it.</p>
        : <div className="stack">
            <div className="scorerow">
              <div className="scorebig"><div className="display">{Number(s.final).toFixed(1)}</div><div className="muted small">overall / 10</div></div>
              <div className="stack" style={{ flex: 1 }}>
                <ScoreBar v={s.kpi_final} label="KPIs (75%)" />
                <ScoreBar v={s.attr_final} label="Attributes (25%)" />
              </div>
            </div>
            {s.note && <div className="banner info"><b>Manager note:</b> {s.note}</div>}
            {s.breakdown && <Breakdown sheet={s.breakdown} />}
          </div>}
    </Card>
  );
}

/** Manager / HR / Admin: score each team member for the month. */
function TeamScoring({ month }: { month: string }) {
  const d = useLoad(() => rpc<any>('team_scores', { p_month: month }), [month]);
  const [open, setOpen] = useState<string | null>(null);
  if (d.loading) return <Card title="My team — monthly scores"><Loading rows={3} /></Card>;
  if (d.error) return <Card title="My team — monthly scores"><ErrorBox error={d.error} retry={d.reload} /></Card>;
  const rows = (d.data?.rows ?? []) as any[];
  const canLock = !!d.data?.can_lock;
  const statusPill = (s: string) => s === 'locked' ? <span className="pill ok small">locked</span>
    : s === 'submitted' ? <span className="pill warn small">scored</span> : <span className="pill small">not scored</span>;
  return (
    <Card title="My team — monthly scores" help="Give a KPI and an attributes score out of 10. The system adjusts both from the measured numbers. HR/Admin lock the month to publish it.">
      {rows.length === 0 ? <p className="muted">No team members to score.</p> : (
        <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Person</th><th>Status</th><th className="num">Final</th><th></th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.person_id}>
            <td><b>{r.full_name}</b>{r.designation && <div className="small muted">{r.designation}</div>}</td>
            <td>{statusPill(r.status)}</td>
            <td className="num">{r.final == null ? <span className="muted">—</span> : <b>{Number(r.final).toFixed(1)}</b>}</td>
            <td className="num"><button className="btn sm" onClick={() => setOpen(open === r.person_id ? null : r.person_id)}>{open === r.person_id ? 'Close' : 'Score'}</button></td>
          </tr>)}</tbody></table></div>)}
      {open && <ScorePanel key={open} person={open} month={month} canLock={canLock} onSaved={d.reload} />}
    </Card>
  );
}

function ScorePanel({ person, month, canLock, onSaved }: { person: string; month: string; canLock: boolean; onSaved: () => void }) {
  const d = useLoad(() => rpc<any>('score_preview', { p_person: person, p_month: month }), [person, month]);
  if (d.loading) return <div className="panel"><Loading rows={3} /></div>;
  if (d.error) return <div className="panel"><ErrorBox error={d.error} retry={d.reload} /></div>;
  return <ScorePanelBody pv={d.data} person={person} month={month} canLock={canLock} onSaved={() => { d.reload(); onSaved(); }} />;
}

function ScorePanelBody({ pv, person, month, canLock, onSaved }: { pv: any; person: string; month: string; canLock: boolean; onSaved: () => void }) {
  const [kpi, setKpi] = useState<string>(String(pv.kpi_given ?? 7));
  const [attr, setAttr] = useState<string>(String(pv.attr_given ?? 7));
  const [note, setNote] = useState<string>(pv.note ?? '');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [msg, setMsg] = useState('');
  const locked = pv.locked;
  const sheet = pv.sheet;
  const w = sheet.weights;
  // adjustments are independent of the given base, so recompute finals live as the base changes.
  const kAdj = sum(sheet.kpi.adjustments), aAdj = sum(sheet.attr.adjustments);
  const kFinal = clamp((Number(kpi) || 0) + kAdj);
  const aFinal = clamp((Number(attr) || 0) + aAdj);
  const final = Math.round((Number(w.kpi) * kFinal + Number(w.attr) * aFinal) * 10) / 10;

  useEffect(() => { setKpi(String(pv.kpi_given ?? 7)); setAttr(String(pv.attr_given ?? 7)); setNote(pv.note ?? ''); }, [pv]);

  async function run(label: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(label); setErr(null); setMsg('');
    try { await fn(); setMsg(ok); onSaved(); } catch (e) { setErr(e); } finally { setBusy(''); }
  }
  const save = () => run('save', () => rpc('save_score', { p_person: person, p_month: month, p_kpi_given: Number(kpi), p_attr_given: Number(attr), p_note: note.trim() || null }), 'Saved.');
  const lock = () => run('lock', () => rpc('lock_score', { p_person: person, p_month: month }), 'Locked.');
  const reopen = () => run('reopen', () => rpc('reopen_score', { p_person: person, p_month: month }), 'Reopened.');

  return (
    <div className="panel stack">
      <div className="row"><b>{pv.full_name}</b>{pv.designation && <span className="muted small">· {pv.designation}</span>}<span className="spacer" />
        {locked ? <span className="pill ok small"><Icon name="check" size={12} /> locked</span> : pv.status === 'submitted' ? <span className="pill warn small">scored, not locked</span> : null}</div>

      <div className="scoregrid">
        <div className="stack">
          <label className="field">KPI score (0–10)
            <input type="number" min={0} max={10} step={0.5} value={kpi} disabled={locked && !canLock} onChange={(e) => setKpi(e.target.value)} className="num" style={{ width: 90 }} /></label>
          <AdjList title="KPI adjustments" measures={sheet.kpi.measures} adj={sheet.kpi.adjustments} kind="kpi" />
          <ScoreBar v={kFinal} label="Adjusted KPI" />
        </div>
        <div className="stack">
          <label className="field">Attributes score (0–10)
            <input type="number" min={0} max={10} step={0.5} value={attr} disabled={locked && !canLock} onChange={(e) => setAttr(e.target.value)} className="num" style={{ width: 90 }} /></label>
          <AdjList title="Attribute adjustments" measures={sheet.attr.measures} adj={sheet.attr.adjustments} kind="attr" isManager={sheet.attr.is_manager} />
          <ScoreBar v={aFinal} label="Adjusted attributes" />
        </div>
      </div>

      <div className="scorerow">
        <div className="scorebig"><div className="display">{final.toFixed(1)}</div><div className="muted small">final / 10</div></div>
        <div className="muted small">{Math.round(Number(w.kpi) * 100)}% KPI + {Math.round(Number(w.attr) * 100)}% attributes</div>
      </div>

      <label className="field">Note for {pv.full_name?.split(' ')[0]} (they see this when it is finalised)
        <textarea rows={2} value={note} disabled={locked && !canLock} onChange={(e) => setNote(e.target.value)} placeholder="What went well, what to focus on next month" /></label>

      <div className="row">
        {(!locked || canLock) && <button className="btn primary" disabled={busy === 'save'} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save score'}</button>}
        {canLock && !locked && pv.status !== 'none' && <button className="btn" disabled={busy === 'lock'} onClick={lock}>{busy === 'lock' ? 'Locking…' : 'Lock month'}</button>}
        {canLock && locked && <button className="btn" disabled={busy === 'reopen'} onClick={reopen}>{busy === 'reopen' ? 'Reopening…' : 'Reopen'}</button>}
        {msg && <span className="pill ok small">{msg}</span>}
      </div>
      {err ? <div className="banner bad">{errText(err)}</div> : null}

      <WeeklyReview person={person} name={pv.full_name} today={month} />
    </div>
  );
}

const KPI_LABEL: Record<string, string> = { achievement: 'Achievement vs target', tat: 'TAT / punctuality', commitment: 'Commitment %', attendance: 'Attendance' };
const ATTR_LABEL: Record<string, string> = { self_shrinkage: 'Self shrinkage', team_shrinkage: 'Team shrinkage', team_performance: 'Team performance', growth: 'Growth' };

function fmtDelta(n: number) { return n === 0 ? '0' : (n > 0 ? '+' : '') + n; }

function AdjList({ title, measures, adj, kind, isManager }: { title: string; measures: any; adj: Record<string, number>; kind: 'kpi' | 'attr'; isManager?: boolean }) {
  const labels = kind === 'kpi' ? KPI_LABEL : ATTR_LABEL;
  const note = (k: string): string => {
    if (kind === 'kpi') {
      if (k === 'achievement') return measures.achievement_pct == null ? 'no target set' : `${measures.achievement_pct}% of target`;
      if (k === 'tat') return measures.late_share == null ? 'nothing reported yet' : `${Math.round(measures.late_share * 100)}% late`;
      if (k === 'commitment') return measures.commitment_avg == null ? 'not planned' : `${measures.commitment_avg}% avg`;
      if (k === 'attendance') return measures.miss_share == null ? '—' : `${Math.round(measures.miss_share * 100)}% missed`;
    } else {
      if (k === 'self_shrinkage') return `${Math.round((measures.miss_share || 0) * 100)}% own days missed`;
      if (k === 'team_shrinkage') return !isManager ? 'not a manager' : `${measures.team_exits} of ${measures.team_size} left`;
      if (k === 'team_performance') return !isManager ? 'not a manager' : (measures.team_achievement == null ? 'no team figures' : `team at ${measures.team_achievement}%`);
      if (k === 'growth') return measures.achievement_prev == null ? 'no prior month' : `${measures.achievement_prev}% → ${measures.achievement_now}%`;
    }
    return '';
  };
  return (
    <div className="adjlist">
      <div className="small muted" style={{ marginBottom: 4 }}>{title}</div>
      {Object.keys(labels).map((k) => {
        const n = Number(adj[k] || 0);
        return <div key={k} className="adjrow">
          <span>{labels[k]} <span className="muted small">· {note(k)}</span></span>
          <b className={n > 0 ? 'pos' : n < 0 ? 'neg' : 'muted'}>{fmtDelta(n)}</b>
        </div>;
      })}
    </div>
  );
}

/** Weekly review note + focus for one person. */
function WeeklyReview({ person, name, today }: { person: string; name: string; today: string }) {
  const d = useLoad(() => rpc<any[]>('weekly_reviews', { p_person: person, p_weeks: 6 }), [person]);
  const thisWeek = useMemo(() => {
    const t = new Date(today); const day = (t.getDay() + 6) % 7; // Monday=0
    const mon = new Date(t.getFullYear(), t.getMonth(), t.getDate() - day);
    return monthStart(mon).slice(0, 8) + String(mon.getDate()).padStart(2, '0');
  }, [today]);
  const [review, setReview] = useState(''); const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [err, setErr] = useState<unknown>(null);
  async function save() {
    setBusy(true); setErr(null); setMsg('');
    try { await rpc('save_weekly_review', { p_person: person, p_week_start: thisWeek, p_review: review.trim() || null, p_focus: focus.trim() || null }); setMsg('Saved.'); setReview(''); setFocus(''); d.reload(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const rows = (d.data ?? []) as any[];
  return (
    <details className="weekly">
      <summary>Weekly reviews <span className="muted small">— quick notes so the month isn't scored cold</span></summary>
      <div className="stack" style={{ marginTop: 8 }}>
        <label className="field">This week — how it went
          <textarea rows={2} value={review} onChange={(e) => setReview(e.target.value)} placeholder={`e.g. ${name?.split(' ')[0]} cleared the SBI backlog`} /></label>
        <label className="field">Next week — focus
          <input className="input" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. start fresh allocations early" /></label>
        <div className="row"><button className="btn sm primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save weekly review'}</button>{msg && <span className="pill ok small">{msg}</span>}</div>
        {err ? <div className="banner bad">{errText(err)}</div> : null}
        {rows.length > 0 && <div className="tablewrap"><table><thead><tr><th>Week of</th><th className="num">Commit</th><th className="num">Ach.</th><th>Review</th><th>Focus</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.week_start}>
            <td className="small">{new Date(r.week_start).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
            <td className="num small">{r.commitment_pct == null ? '—' : `${r.commitment_pct}%`}</td>
            <td className="num small">{r.achievement_pct == null ? '—' : `${r.achievement_pct}%`}</td>
            <td className="small">{r.review_note}</td><td className="small muted">{r.focus_note}</td>
          </tr>)}</tbody></table></div>}
      </div>
    </details>
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
