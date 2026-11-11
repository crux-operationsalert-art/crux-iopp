import { useState } from 'react';
import { rpc, errText } from '../lib/api';
import { Card, ErrorBox, Loading, useLoad } from './ui';

type Area = { key: string; label: string; description: string; warn?: string };
type Page = Area & { section: string; base_roles: string[] | null; base_note: string | null };
type Role = { code: string; label: string; people: number };
type Rule = { area: string; role: string; level: 'self' | 'team' | 'all'; locked: boolean; by: string | null; at: string | null };
const LEVELS: ['self' | 'team' | 'all', string][] = [['self', 'Only own'], ['team', 'Own team'], ['all', 'Everyone']];
const SHORT = { self: 'Own', team: 'Team', all: 'All' } as const;

/** Admin's "who sees what" card (D-121, D-124): per role, the data they can open and the pages on their menu. Changes apply at once. */
export function AccessCard() {
  const d = useLoad(() => rpc<{ areas: Area[]; roles: Role[]; rules: Rule[]; pages?: Page[] }>('access_card', {}), []);
  const [role, setRole] = useState('executive');
  const [busy, setBusy] = useState(''); const [err, setErr] = useState<unknown>(null);
  if (d.loading && !d.data) return <Loading rows={4} />;
  if (d.error || !d.data) return <ErrorBox error={d.error} retry={d.reload} />;
  const { areas, roles, rules } = d.data; const pages = d.data.pages ?? [];
  const rule = (a: string, r: string) => rules.find((x) => x.area === a && x.role === r);
  const cur = roles.find((r) => r.code === role)!;
  const sections = [...new Set(pages.map((p) => p.section))];
  /** on = built into this role; maybe = the role gets it only in some cases; no = never on this role's menu */
  const base = (p: Page, r: string) => (!p.base_roles || p.base_roles.includes(r) ? 'on' : p.base_note ? 'maybe' : 'no');
  async function set(area: string, level: string, r = role) {
    setBusy(area + r); setErr(null);
    try { await rpc('access_set', { p_area: area, p_role: r, p_level: level }); d.reload(); } catch (e) { setErr(e); } finally { setBusy(''); }
  }
  const hideable = pages.filter((p) => base(p, role) !== 'no' && rule(p.key, role) && !rule(p.key, role)!.locked);
  const hiddenN = hideable.filter((p) => rule(p.key, role)!.level === 'self').length;

  return (
    <div className="stack">
      <Card title="Who sees what" help="Pick a role. First choose which pages are on its menu, then whose records it can open. A person with several roles gets the widest of them. Everyone always sees their own.">
        <div className="stack">
          <div className="field">Role
            <div className="segbtns">{roles.map((r) => <button key={r.code} className={`btn sm${role === r.code ? ' primary' : ''}`} aria-pressed={role === r.code} onClick={() => setRole(r.code)}>{r.label} <span className="small muted">{r.people}</span></button>)}</div></div>
          <div className="small muted">{cur.people} {cur.people === 1 ? 'person holds' : 'people hold'} the <b>{cur.label}</b> role. Changes apply as soon as you pick; the person sees them the next time they open the app.</div>
          {err ? <div className="banner bad">{errText(err)}</div> : null}
        </div>
      </Card>

      <Card title={`Menu for ${cur.label}`} help="Every page and Admin section. 'Shown' keeps the page for whoever in this role has it today; 'Hidden' removes it from the menu and blocks the page. Hiding never gives a page to anyone new. A person keeps a page only if one of their roles that carries it keeps it.">
        <div className="stack">
          <div className="small muted">{hiddenN ? `${hiddenN} of ${hideable.length} pages hidden for this role.` : `Nothing is hidden for this role yet (${hideable.length} pages).`} Always on for everyone: Home, My day, Notifications, My profile, My review, About.</div>
          {sections.map((sec) => (
            <div key={sec} className="stack" style={{ gap: 8 }}>
              <h3 style={{ margin: '6px 0 0' }}>{sec}</h3>
              {pages.filter((p) => p.section === sec).map((p) => { const r = rule(p.key, role); const b = base(p, role); if (!r) return null; return (
                <div key={p.key} className="accrow" style={b === 'no' ? { opacity: 0.6 } : undefined}>
                  <div style={{ flex: 1, minWidth: 220 }}><b>{p.label}</b><div className="small muted">{p.description}</div>
                    {b === 'maybe' && <div className="small muted">Not on this role's menu by default. {p.base_note}</div>}
                    {r.by && b !== 'no' && <div className="small muted">Last changed by {r.by}</div>}</div>
                  {b === 'no'
                    ? <span className="pill neutral small">Not for this role</span>
                    : <div className="segbtns" role="group" aria-label={`${p.label} page for ${cur.label}`}>
                        <button className={`btn sm${r.level !== 'self' ? ' primary' : ''}`} aria-pressed={r.level !== 'self'} disabled={r.locked || busy === p.key + role} onClick={() => r.level === 'self' && set(p.key, 'all')}>Shown</button>
                        <button className={`btn sm${r.level === 'self' ? ' primary' : ''}`} aria-pressed={r.level === 'self'} disabled={r.locked || busy === p.key + role} onClick={() => r.level !== 'self' && set(p.key, 'self')}>Hidden</button>
                        {r.locked && <span className="pill neutral small">fixed</span>}
                      </div>}
                </div>); })}
            </div>))}
        </div>
      </Card>

      <Card title={`Data ${cur.label} can open`} help="Whose records this role can open inside the pages it has.">
        <div className="stack">
          {areas.map((a) => { const r = rule(a.key, role); if (!r) return null; return (
            <div key={a.key} className="accrow">
              <div style={{ flex: 1, minWidth: 220 }}><b>{a.label}</b><div className="small muted">{a.description}</div>
                {r.level === 'all' && a.warn && !r.locked && <div className="small" style={{ color: 'var(--warn)' }}>{a.warn}</div>}
                {r.by && <div className="small muted">Last changed by {r.by}{r.at ? ` on ${new Date(r.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}</div>}</div>
              <div className="segbtns" role="group" aria-label={`${a.label} for ${cur.label}`}>
                {LEVELS.map(([v, l]) => <button key={v} className={`btn sm${r.level === v ? ' primary' : ''}`} aria-pressed={r.level === v} disabled={r.locked || busy === a.key + role} onClick={() => r.level !== v && set(a.key, v)}>{l}</button>)}
                {r.locked && <span className="pill neutral small">fixed</span>}
              </div>
            </div>); })}
        </div>
      </Card>

      <Card title="All roles at a glance" collapsible collapseKey="access-grid" help="The whole card in one table. Click a Shown or Hidden cell to switch it.">
        <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Page or data</th>{roles.map((r) => <th key={r.code} className="small">{r.label}</th>)}</tr></thead>
          <tbody>
            {sections.flatMap((sec) => [
              <tr key={'s' + sec}><td colSpan={roles.length + 1} className="small muted"><b>{sec}</b></td></tr>,
              ...pages.filter((p) => p.section === sec).map((p) => <tr key={p.key}><td>{p.label}</td>{roles.map((r) => { const x = rule(p.key, r.code); const b = base(p, r.code);
                if (!x || b === 'no') return <td key={r.code} className="muted">—</td>;
                const hid = x.level === 'self';
                return <td key={r.code}><button className={`pill small ${hid ? 'bad' : b === 'maybe' ? 'neutral' : 'ok'}`} style={{ cursor: x.locked ? 'default' : 'pointer', border: 0 }} disabled={x.locked || busy === p.key + r.code}
                  aria-label={`${p.label} for ${r.label}: ${hid ? 'hidden' : 'shown'}. Switch.`} onClick={() => set(p.key, hid ? 'all' : 'self', r.code)}>{hid ? 'Hidden' : b === 'maybe' ? 'Some' : 'Shown'}</button></td>; })}</tr>)])}
            <tr><td colSpan={roles.length + 1} className="small muted"><b>Data</b></td></tr>
            {areas.map((a) => <tr key={a.key}><td>{a.label}</td>{roles.map((r) => { const x = rule(a.key, r.code); return <td key={r.code}>{x ? <span className={`pill small ${x.level === 'all' ? 'warn' : x.level === 'team' ? 'info' : 'neutral'}`}>{SHORT[x.level]}</span> : '—'}</td>; })}</tr>)}
          </tbody></table></div>
        <div className="small muted" style={{ marginTop: 8 }}>“Some” means the role gets that page only in some cases, such as when people report to them or KPIs are assigned.</div>
      </Card>

      <Card title="What this card does not change" collapsible collapseKey="access-fixed" defaultOpen={false}>
        <ul className="howsteps">
          <li><b>Own team</b> means the people who report to them, at any depth — not their peers.</li>
          <li><b>Pages can be hidden, not handed out.</b> Giving a page to a role that does not have it today still needs a change in the app.</li>
          <li><b>Admin-only sections</b> (Who sees what, Clients & rates, Monthly targets, Reopen days, Month close & backup, Settings, full Activity log) are never shown to any other role.</li>
          <li><b>Who can act</b> stays fixed: only the direct manager scores and sets KPIs; only HR/Admin lock scores and run payroll; only Admin opens this card.</li>
          <li><b>ID, bank and salary structure details</b> stay with HR/Admin and the person themselves.</li>
          <li><b>Admin</b> always sees everything, so Admin cannot be locked out.</li>
        </ul>
      </Card>
    </div>
  );
}
