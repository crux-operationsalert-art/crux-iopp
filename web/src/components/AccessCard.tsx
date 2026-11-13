import { useState } from 'react';
import { rpc, errText } from '../lib/api';
import { Card, ErrorBox, Loading, useLoad } from './ui';

type Area = { key: string; label: string; description: string; warn?: string };
type Page = Area & { section: string; base_roles: string[] | null; base_note: string | null; scopes?: ('self' | 'team')[] | null };
type Choice = 'hidden' | 'self' | 'team' | 'full';
const CHOICE: Record<Choice, string> = { hidden: 'Hidden', self: 'Only own', team: 'Own team', full: 'Full' };
type Role = { code: string; label: string; people: number };
type Rule = { area: string; role: string; level: 'self' | 'team' | 'all'; locked: boolean; scope?: 'self' | 'team' | null; by: string | null; at: string | null };
const LEVELS: ['self' | 'team' | 'all', string][] = [['self', 'Only own'], ['team', 'Own team'], ['all', 'Everyone']];
const SHORT = { self: 'Own', team: 'Team', all: 'All' } as const;

/** Admin's "who sees what" card (D-121, D-124): per role, the data they can open and the pages on their menu. Changes apply at once. */
export function AccessCard() {
  const d = useLoad(() => rpc<{ areas: Area[]; roles: Role[]; rules: Rule[]; pages?: Page[] }>('access_card', {}), []);
  const mods = useLoad(() => rpc<{ paused: boolean; page_keys?: string[] }[]>('modules_list', {}).catch(() => []), []);
  const [role, setRole] = useState('executive');
  const [busy, setBusy] = useState(''); const [err, setErr] = useState<unknown>(null);
  if (d.loading && !d.data) return <Loading rows={4} />;
  if (d.error || !d.data) return <ErrorBox error={d.error} retry={d.reload} />;
  // paused functions are not shown here at all (D-150): their pages, and the salary / document / profile data they hold
  const off = (mods.data ?? []).filter((m) => m.paused).flatMap((m) => (m.page_keys ?? []).map((k) => 'page:' + k));
  const pausedKey = (k: string) => (mods.data ?? []).some((m: any) => m.paused && m.key === k);
  const offAreas = [...(pausedKey('payroll') ? ['pay'] : []), ...(pausedKey('hr_docs') ? ['documents', 'profiles'] : []), ...(pausedKey('plan') ? ['plans'] : [])];
  const { roles, rules } = d.data; const areas = d.data.areas.filter((a) => !offAreas.includes(a.key)); const pages = (d.data.pages ?? []).filter((p) => !off.includes(p.key));
  const rule = (a: string, r: string) => rules.find((x) => x.area === a && x.role === r);
  const cur = roles.find((r) => r.code === role)!;
  const sections = [...new Set(pages.map((p) => p.section))];
  /** on = built into this role; maybe = the role gets it only in some cases; no = never on this role's menu */
  const base = (p: Page, r: string) => (!p.base_roles || p.base_roles.includes(r) ? 'on' : p.base_note ? 'maybe' : 'no');
  async function set(area: string, level: string, r = role) {
    setBusy(area + r); setErr(null);
    try { await rpc('access_set', { p_area: area, p_role: r, p_level: level }); d.reload(); } catch (e) { setErr(e); } finally { setBusy(''); }
  }
  /** A page's setting for a role, and the settings that page offers. */
  const state = (x: Rule): Choice => (x.level === 'self' ? 'hidden' : x.scope ?? 'full');
  const choices = (p: Page): Choice[] => ['hidden', ...(p.scopes ?? []), 'full'];
  async function setPage(area: string, choice: Choice, r = role) {
    setBusy(area + r); setErr(null);
    try { await rpc('page_set', { p_area: area, p_role: r, p_choice: choice }); d.reload(); } catch (e) { setErr(e); } finally { setBusy(''); }
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

      <Card title={`Menu for ${cur.label}`} help="Every page and Admin section. 'Hidden' removes the page from the menu and blocks it. Report pages also offer 'Only own' (the person's own locations and figures), 'Own team' (theirs and everyone reporting to them) and 'Full' (everything this role is built to see). The limits only narrow; nothing here gives a role more than it has today. A person keeps a page only if one of their roles that carries it keeps it.">
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
                        {choices(p).map((c) => <button key={c} className={`btn sm${state(r) === c ? ' primary' : ''}`} aria-pressed={state(r) === c} disabled={r.locked || busy === p.key + role}
                          onClick={() => state(r) !== c && setPage(p.key, c)}>{c === 'full' && !p.scopes?.length ? 'Shown' : CHOICE[c]}</button>)}
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

      <Card title="All roles at a glance" collapsible collapseKey="access-grid" help="The whole card in one table. Click a page cell to move it to its next setting.">
        <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Page or data</th>{roles.map((r) => <th key={r.code} className="small">{r.label}</th>)}</tr></thead>
          <tbody>
            {sections.flatMap((sec) => [
              <tr key={'s' + sec}><td colSpan={roles.length + 1} className="small muted"><b>{sec}</b></td></tr>,
              ...pages.filter((p) => p.section === sec).map((p) => <tr key={p.key}><td>{p.label}</td>{roles.map((r) => { const x = rule(p.key, r.code); const b = base(p, r.code);
                if (!x || b === 'no') return <td key={r.code} className="muted">—</td>;
                const st = state(x); const opts = choices(p); const next = opts[(opts.indexOf(st) + 1) % opts.length];
                const text = st === 'hidden' ? 'Hidden' : st === 'self' ? 'Own' : st === 'team' ? 'Team' : b === 'maybe' ? 'Some' : p.scopes?.length ? 'Full' : 'Shown';
                return <td key={r.code}><button className={`pill small ${st === 'hidden' ? 'bad' : st === 'self' || st === 'team' ? 'info' : b === 'maybe' ? 'neutral' : 'ok'}`} style={{ cursor: x.locked ? 'default' : 'pointer', border: 0 }} disabled={x.locked || busy === p.key + r.code}
                  aria-label={`${p.label} for ${r.label}: ${CHOICE[st]}. Change to ${CHOICE[next]}.`} onClick={() => setPage(p.key, next, r.code)}>{text}</button></td>; })}</tr>)])}
            <tr><td colSpan={roles.length + 1} className="small muted"><b>Data</b></td></tr>
            {areas.map((a) => <tr key={a.key}><td>{a.label}</td>{roles.map((r) => { const x = rule(a.key, r.code); return <td key={r.code}>{x ? <span className={`pill small ${x.level === 'all' ? 'warn' : x.level === 'team' ? 'info' : 'neutral'}`}>{SHORT[x.level]}</span> : '—'}</td>; })}</tr>)}
          </tbody></table></div>
        <div className="small muted" style={{ marginTop: 8 }}>“Some” means the role gets that page only in some cases, such as when people report to them or KPIs are assigned.</div>
      </Card>

      <Card title="What this card does not change" collapsible collapseKey="access-fixed" defaultOpen={false}>
        <ul className="howsteps">
          <li><b>Own team</b> means the people who report to them, at any depth — not their peers.</li>
          <li><b>Pages can be hidden or narrowed, not handed out.</b> “Full” is what the role is built to see: company-wide for Admin, Auditor and the Operations Head on the tracker; own and team for everyone else. Giving a role more than that still needs a change in the app.</li>
          <li><b>Only own / Own team</b> are offered on the report pages and Targets. Other pages show a person their own records and, for managers, their team's; whose records they can open is set under Data.</li>
          <li><b>View as</b> at the top shows the menu and pages a role gets, but with your own (Admin) data. To see a narrowed report exactly as they do, ask that person or check with a test login.</li>
          <li><b>Admin-only sections</b> (Who sees what, Clients & rates, Monthly targets, Reopen days, Month close & backup, Settings, full Activity log) are never shown to any other role.</li>
          <li><b>Who can act</b> stays fixed: only the direct manager scores and sets KPIs; only HR/Admin lock scores and run payroll; only Admin opens this card.</li>
          <li><b>ID, bank and salary structure details</b> stay with HR/Admin and the person themselves.</li>
          <li><b>Admin</b> always sees everything, so Admin cannot be locked out.</li>
        </ul>
      </Card>
    </div>
  );
}
