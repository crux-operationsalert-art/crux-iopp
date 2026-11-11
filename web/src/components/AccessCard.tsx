import { useState } from 'react';
import { rpc, errText } from '../lib/api';
import { Card, ErrorBox, Loading, useLoad } from './ui';

type Area = { key: string; label: string; description: string; warn?: string };
type Role = { code: string; label: string; people: number };
type Rule = { area: string; role: string; level: 'self' | 'team' | 'all'; locked: boolean; by: string | null; at: string | null };
const LEVELS: ['self' | 'team' | 'all', string][] = [['self', 'Only own'], ['team', 'Own team'], ['all', 'Everyone']];
const SHORT = { self: 'Own', team: 'Team', all: 'All' } as const;

/** Admin's "who sees what" card (D-121): per role, whose records can be opened in each data area. Changes apply at once. */
export function AccessCard() {
  const d = useLoad(() => rpc<{ areas: Area[]; roles: Role[]; rules: Rule[] }>('access_card', {}), []);
  const [role, setRole] = useState('executive');
  const [busy, setBusy] = useState(''); const [err, setErr] = useState<unknown>(null);
  if (d.loading) return <Loading rows={4} />;
  if (d.error || !d.data) return <ErrorBox error={d.error} retry={d.reload} />;
  const { areas, roles, rules } = d.data; const pages = ((d.data as any).pages ?? []) as Area[];
  const rule = (a: string, r: string) => rules.find((x) => x.area === a && x.role === r);
  const cur = roles.find((r) => r.code === role)!;
  async function set(area: string, level: string) {
    setBusy(area); setErr(null);
    try { await rpc('access_set', { p_area: area, p_role: role, p_level: level }); d.reload(); } catch (e) { setErr(e); } finally { setBusy(''); }
  }
  return (
    <div className="stack">
      <Card title="Who sees what" help="For each role, choose whose records that role can open. A person with several roles gets the widest of them. Everyone always sees their own.">
        <div className="stack">
          <div className="field">Role
            <div className="segbtns">{roles.map((r) => <button key={r.code} className={`btn sm${role === r.code ? ' primary' : ''}`} aria-pressed={role === r.code} onClick={() => setRole(r.code)}>{r.label} <span className="small muted">{r.people}</span></button>)}</div></div>
          <div className="small muted">{cur.people} {cur.people === 1 ? 'person holds' : 'people hold'} the <b>{cur.label}</b> role. Changes apply as soon as you pick.</div>
          {areas.map((a) => { const r = rule(a.key, role); if (!r) return null; return (
            <div key={a.key} className="accrow">
              <div style={{ flex: 1, minWidth: 220 }}><b>{a.label}</b><div className="small muted">{a.description}</div>
                {r.level === 'all' && a.warn && !r.locked && <div className="small" style={{ color: 'var(--warn)' }}>{a.warn}</div>}
                {r.by && <div className="small muted">Last changed by {r.by}{r.at ? ` on ${new Date(r.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}</div>}</div>
              <div className="segbtns" role="group" aria-label={`${a.label} for ${cur.label}`}>
                {LEVELS.map(([v, l]) => <button key={v} className={`btn sm${r.level === v ? ' primary' : ''}`} aria-pressed={r.level === v} disabled={r.locked || busy === a.key} onClick={() => r.level !== v && set(a.key, v)}>{l}</button>)}
                {r.locked && <span className="pill neutral small">fixed</span>}
              </div>
            </div>); })}
          {err ? <div className="banner bad">{errText(err)}</div> : null}
        </div>
      </Card>

      <Card title={`Pages for ${cur.label}`} help="Hide a company-wide report page from this role. 'As today' keeps the page for whoever in this role already has it; it does not give the page to anyone new. A person keeps a page if any of their roles keeps it.">
        <div className="stack">
          {pages.map((a) => { const r = rule(a.key, role); if (!r) return null; return (
            <div key={a.key} className="accrow">
              <div style={{ flex: 1, minWidth: 220 }}><b>{a.label}</b><div className="small muted">{a.description}</div>
                {r.by && <div className="small muted">Last changed by {r.by}</div>}</div>
              <div className="segbtns" role="group" aria-label={`${a.label} page for ${cur.label}`}>
                <button className={`btn sm${r.level !== 'self' ? ' primary' : ''}`} aria-pressed={r.level !== 'self'} disabled={r.locked || busy === a.key} onClick={() => r.level === 'self' && set(a.key, 'all')}>As today</button>
                <button className={`btn sm${r.level === 'self' ? ' primary' : ''}`} aria-pressed={r.level === 'self'} disabled={r.locked || busy === a.key} onClick={() => r.level !== 'self' && set(a.key, 'self')}>Hidden</button>
                {r.locked && <span className="pill neutral small">fixed</span>}
              </div>
            </div>); })}
        </div>
      </Card>

      <Card title="All roles at a glance" collapsible collapseKey="access-grid">
        <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Data</th>{roles.map((r) => <th key={r.code} className="small">{r.label}</th>)}</tr></thead>
          <tbody>{areas.map((a) => <tr key={a.key}><td><b>{a.label}</b></td>{roles.map((r) => { const x = rule(a.key, r.code); return <td key={r.code}>{x ? <span className={`pill small ${x.level === 'all' ? 'warn' : x.level === 'team' ? 'info' : 'neutral'}`}>{SHORT[x.level]}</span> : '—'}</td>; })}</tr>)}</tbody></table></div>
      </Card>

      <Card title="What this card does not change" collapsible collapseKey="access-fixed" defaultOpen={false}>
        <ul className="howsteps">
          <li><b>Own team</b> means the people who report to them, at any depth — not their peers.</li>
          <li><b>Pages can be hidden, not handed out.</b> Giving a report page to a role that does not have it today still needs a change in the app. Home dashboards, My team, Payroll, Penalties and the Admin sections are not on this card.</li>
          <li><b>Who can act</b> stays fixed: only the direct manager scores and sets KPIs; only HR/Admin lock scores and run payroll; only Admin opens this card.</li>
          <li><b>ID, bank and salary structure details</b> stay with HR/Admin and the person themselves.</li>
          <li><b>Admin</b> always sees everything, so Admin cannot be locked out.</li>
        </ul>
      </Card>
    </div>
  );
}
