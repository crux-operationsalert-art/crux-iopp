import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { configured, entersFigures, has, Me, rpc, sb } from './lib/api';
import { ErrorBox, Loading } from './components/ui';
import Login from './pages/Login';
import Home from './pages/Home';
import Productivity from './pages/Productivity';
import Team from './pages/Team';
import Targets from './pages/Targets';
const Reports = lazy(() => import('./pages/Reports'));
const Admin = lazy(() => import('./pages/Admin'));
import Penalties from './pages/Penalties';
import Attendance from './pages/Attendance';
import Tasks from './pages/Tasks';
import Notifications from './pages/Notifications';
import { AgreementGate, Logo, ProfileForm } from './pages/Onboard';
import { MfaPrompt, needsCode, TwoStepCard } from './pages/TwoStep';

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [err, setErr] = useState<unknown>(null);
  const [menu, setMenu] = useState(false);
  const [side, setSide] = useState(() => { try { return localStorage.getItem('crux-side') !== '0'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem('crux-side', side ? '1' : '0'); } catch { /* optional */ } }, [side]);
  const loc = useLocation();

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const [n, setN] = useState(0);
  const [code, setCode] = useState(false);
  useEffect(() => {
    if (!session) { setMe(session === null ? null : undefined); return; }
    (async () => {
      try {
        if (await needsCode()) { setCode(true); setMe(null); return; }
        setCode(false);
        const w = await rpc<Me | null>('whoami');
        setMe(w);
      } catch (e) { setErr(e); setMe(null); }
    })();
  }, [session, n]);
  const refresh = () => setN((x) => x + 1);

  if (!configured) return <div className="login card"><h1>Setup needed</h1><p>VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are not set.</p></div>;
  if (session === undefined || (session && me === undefined)) return <div className="login"><Loading /></div>;
  if (!session) return <Login />;
  if (code) return <MfaPrompt onDone={() => setN((x) => x + 1)} />;
  if (!me) return (
    <div className="login card stack">
      <h1>No access yet</h1>
      <ErrorBox error={err} />
      <p>Your sign-in worked, but your CRUX account is not active (it may have been deactivated or not set up yet).</p>
      <p className="muted">Ask your manager or Admin to check your record and issue a new activation code.</p>
      <button className="btn" onClick={() => sb.auth.signOut()}>Sign out</button>
    </div>
  );

  // Nobody uses the tool before signing the agreement and completing the profile.
  if (!me.agreement_ok) return <AgreementGate me={me} onDone={refresh} />;
  if (me.profile_missing.length) return <ProfileForm me={me} onDone={refresh} />;

  const groups = menuGroups(me);
  const flat = groups.flatMap((g) => g.items);
  const mobile = flat.filter((n) => (entersFigures(me) ? ['/', '/productivity', '/tasks', '/notifications'] : ['/', '/reports?v=tracker', '/tasks', '/notifications']).includes(n.to)).slice(0, 4);

  return (
    <div className="shell">
      <aside className={`side ${side ? '' : 'collapsed'}`} aria-label="Main navigation">
        <div className="brand" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}><Logo compact /><span className="small muted">Productivity · {me.company?.website}</span></div>
        <Menu groups={groups} />
        <div className="small muted" style={{ padding: '12px 10px' }}>
          {me.full_name}<br />{me.roles.map((r) => r.replace('_', ' ')).join(', ')}<br />
          <button className="btn sm" style={{ marginTop: 8 }} onClick={() => sb.auth.signOut()}>Sign out</button>
        </div>
      </aside>
      <main className="main">
        <button className="btn ghost sm hamburger desktop-only" aria-label={side ? 'Hide menu' : 'Show menu'} aria-expanded={side} onClick={() => setSide(!side)}>☰ Menu</button>
        <Suspense fallback={<Loading rows={4} />}>
        <Routes>
          <Route path="/" element={<Home me={me} />} />
          <Route path="/productivity" element={<Productivity me={me} />} />
          <Route path="/team" element={<Team me={me} />} />
          <Route path="/attendance" element={<Attendance me={me} />} />
          <Route path="/tasks" element={<Tasks me={me} />} />
          <Route path="/profile" element={<div className="stack"><ProfileForm me={me} embedded onDone={refresh} /><TwoStepCard /></div>} />
          <Route path="/notifications" element={<Notifications me={me} />} />
          <Route path="/install" element={<Navigate to="/notifications" />} />
          <Route path="/collections" element={<Navigate to="/" />} />
          <Route path="/targets" element={<Targets me={me} />} />
          <Route path="/reports" element={<Reports me={me} />} />
          <Route path="/penalties" element={<Penalties me={me} />} />
          <Route path="/admin" element={has(me, 'admin', 'hr_admin') ? <Admin me={me} /> : <Navigate to="/" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
        </Suspense>
      </main>
      {menu && <div className="drawer" role="dialog" aria-label="Menu" onClick={(e) => { if ((e.target as HTMLElement).closest('a')) setMenu(false); }}>
        <div className="row" style={{ padding: '4px 4px 8px' }}><Logo compact /><span className="spacer" /><button className="btn sm" onClick={() => setMenu(false)} aria-label="Close menu">✕</button></div>
        <Menu groups={groups} />
        <div className="small muted" style={{ padding: '8px 12px' }}>{me.full_name} · {me.roles.map((r) => r.replace('_', ' ')).join(', ')}</div>
        <button className="btn sm" style={{ margin: '0 12px 12px' }} onClick={() => sb.auth.signOut()}>Sign out</button>
      </div>}
      <nav className="bottomnav" aria-label="Quick navigation">
        {mobile.map((n) => <Link key={n.to} to={n.to} className={isActive(n.to, loc) ? 'active' : ''} onClick={() => setMenu(false)}><span className="ico" aria-hidden>{n.ico}</span>{n.short ?? n.label}</Link>)}
        <a href="#menu" role="button" aria-expanded={menu} onClick={(e) => { e.preventDefault(); setMenu(!menu); }}><span className="ico" aria-hidden>☰</span>Menu</a>
      </nav>
    </div>
  );
}

type Item = { to: string; label: string; ico: string; short?: string };
type Group = { key: string; label: string; ico: string; items: Item[] };
const ADMIN_SECTIONS: [string, string, boolean][] = [['people', 'People', false], ['compliance', 'Agreements & profiles', false], ['locations', 'Locations & heads', false],
  ['clients', 'Clients & rates', true], ['targets', 'Monthly targets', true], ['upload', 'Bulk upload', false], ['reopen', 'Reopen days', true],
  ['close', 'Month close & backup', true], ['policy', 'Leave, holidays & policies', false], ['settings', 'Settings', true], ['log', 'Activity log', true]];

/** Menu categories; each category holds its tabs. */
function menuGroups(me: Me): Group[] {
  const manager = me.manages_operations || me.manages_collections || has(me, 'admin', 'hr_admin', 'ops_head', 'collections_head', 'zm', 'bm', 'ba', 'manager');
  const g: Group[] = [
    { key: 'work', label: 'My work', ico: '✎', items: [
      { to: '/', label: 'Home · performance & collections', short: 'Home', ico: '⌂' },
      ...(entersFigures(me) ? [{ to: '/productivity', label: 'My day (operations & collections)', short: 'My day', ico: '✎' }] : []),
      { to: '/tasks', label: 'Tasks & misses', short: 'Tasks', ico: '✓' },
      { to: '/notifications', label: 'Notifications', short: 'Alerts', ico: '🔔' },
      { to: '/attendance', label: 'Attendance & leave', ico: '◷' },
      { to: '/profile', label: 'My profile', ico: '☺' }] },
    { key: 'team', label: 'Team', ico: '☷', items: [
      ...(manager ? [{ to: '/team', label: 'My team', ico: '☷' }] : []),
      ...(!me.ops_blind ? [{ to: '/targets', label: 'Targets', ico: '◎' }] : []),
      { to: '/penalties', label: 'Penalties', ico: '⚑' }] },
    { key: 'reports', label: 'Reports', ico: '▤', items: [
      ...(!me.ops_blind ? [{ to: '/reports?v=tracker', label: 'Zonal Tracker', short: 'Tracker', ico: '▤' }, { to: '/reports?v=status', label: 'Revenue Status', ico: '₹' }] : []),
      ...(!me.ops_blind ? [{ to: '/reports?v=live', label: 'Daily submissions', ico: '☑' }, { to: '/reports?v=history', label: 'History (Oct 2024 – Oct 2026)', ico: '⌛' }] : []),
      ...(has(me, 'admin', 'hr_admin', 'ops_head', 'auditor', 'leadership') ? [{ to: '/reports?v=attrition', label: 'Attrition', ico: '⇄' }] : [])] },
  ];
  if (has(me, 'admin', 'hr_admin')) g.push({ key: 'admin', label: 'Admin', ico: '⚙', items: ADMIN_SECTIONS.filter(([, , adminOnly]) => !adminOnly || has(me, 'admin'))
    .map(([k, l]) => ({ to: `/admin?s=${k}`, label: l, ico: '⚙' })) });
  return g.filter((x) => x.items.length);
}

function isActive(to: string, loc: { pathname: string; search: string }) {
  const [p, q] = to.split('?');
  if (p !== loc.pathname) return false;
  if (!q) return true;
  const want = new URLSearchParams(q), have = new URLSearchParams(loc.search);
  return [...want.entries()].every(([k, v]) => (have.get(k) ?? (p === '/reports' ? 'tracker' : p === '/admin' ? 'people' : '')) === v);
}

/** Expandable categories; the one holding the current page opens by itself. */
function Menu({ groups }: { groups: Group[] }) {
  const loc = useLocation();
  const [open, setOpen] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem('crux-menu') ?? '{}'); } catch { return {}; } });
  const toggle = (k: string) => setOpen((o) => { const n = { ...o, [k]: !(o[k] ?? true) }; try { localStorage.setItem('crux-menu', JSON.stringify(n)); } catch { /* optional */ } return n; });
  return (
    <nav className="nav menu">{groups.map((g) => {
      const here = g.items.some((i) => isActive(i.to, loc));
      const isOpen = here || (open[g.key] ?? true);
      return (
        <div key={g.key} className="menugroup">
          <button className="menuhead" aria-expanded={isOpen} onClick={() => toggle(g.key)}><span aria-hidden>{g.ico}</span>{g.label}<span className="spacer" /><span aria-hidden className="chev">{isOpen ? '▾' : '▸'}</span></button>
          {isOpen && g.items.map((i) => <Link key={i.to} to={i.to} className={isActive(i.to, loc) ? 'active' : ''}>{i.label}</Link>)}
        </div>);
    })}</nav>
  );
}
