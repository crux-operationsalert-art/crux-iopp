import { lazy, Suspense, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { configured, has, isLeader, Me, rpc, sb } from './lib/api';
import { ErrorBox, Loading } from './components/ui';
import Login from './pages/Login';
import Home from './pages/Home';
import Productivity from './pages/Productivity';
import Team from './pages/Team';
import Collections from './pages/Collections';
import Targets from './pages/Targets';
const Reports = lazy(() => import('./pages/Reports'));
const Admin = lazy(() => import('./pages/Admin'));
import Penalties from './pages/Penalties';
import Attendance from './pages/Attendance';

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [err, setErr] = useState<unknown>(null);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setMe(session === null ? null : undefined); return; }
    (async () => {
      try {
        const w = await rpc<Me | null>('whoami');
        setMe(w);
      } catch (e) { setErr(e); setMe(null); }
    })();
  }, [session]);

  if (!configured) return <div className="login card"><h1>Setup needed</h1><p>VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are not set.</p></div>;
  if (session === undefined || (session && me === undefined)) return <div className="login"><Loading /></div>;
  if (!session) return <Login />;
  if (!me) return (
    <div className="login card stack">
      <h1>No access yet</h1>
      <ErrorBox error={err} />
      <p>Your sign-in worked, but your CRUX account is not active (it may have been deactivated or not set up yet).</p>
      <p className="muted">Ask your manager or Admin to check your record and issue a new activation code.</p>
      <button className="btn" onClick={() => sb.auth.signOut()}>Sign out</button>
    </div>
  );

  const nav = [
    { to: '/', label: 'Home', ico: '⌂', show: true },
    { to: '/productivity', label: 'My day', ico: '✎', show: true },
    { to: '/attendance', label: 'Attendance', ico: '◷', show: true },
    { to: '/team', label: 'My team', ico: '☷', show: me.manages_operations || me.manages_collections || has(me, 'admin', 'hr_admin', 'ops_head', 'collections_head', 'zm', 'bm', 'ba', 'manager') },
    { to: '/collections', label: 'Collections', ico: '₹', show: me.has_collections || has(me, 'collections_head', 'ops_head', 'admin', 'auditor') },
    { to: '/targets', label: 'Targets', ico: '◎', show: true },
    { to: '/reports', label: 'Reports', ico: '▤', show: isLeader(me) || me.manages_operations },
    { to: '/penalties', label: 'Penalties', ico: '⚑', show: true },
    { to: '/admin', label: 'Admin', ico: '⚙', show: has(me, 'admin', 'hr_admin') },
  ].filter((n) => n.show);
  const mobile = nav.filter((n) => ['/', '/productivity', '/attendance', '/team'].includes(n.to)).slice(0, 4);
  const more = nav.filter((n) => !mobile.includes(n));

  return (
    <div className="shell">
      <aside className="side" aria-label="Main navigation">
        <div className="brand"><img src="./icon.svg" width={24} height={24} alt="" /> CRUX Productivity</div>
        <nav className="nav">{nav.map((n) => <NavLink key={n.to} to={n.to} end={n.to === '/'}><span aria-hidden>{n.ico}</span>{n.label}</NavLink>)}</nav>
        <div style={{ position: 'absolute', bottom: 16, left: 10, right: 10 }} className="small muted">
          {me.full_name}<br />{me.roles.map((r) => r.replace('_', ' ')).join(', ')}<br />
          <button className="btn sm" style={{ marginTop: 8 }} onClick={() => sb.auth.signOut()}>Sign out</button>
        </div>
      </aside>
      <main className="main">
        <Suspense fallback={<Loading rows={4} />}>
        <Routes>
          <Route path="/" element={<Home me={me} />} />
          <Route path="/productivity" element={<Productivity me={me} />} />
          <Route path="/team" element={<Team me={me} />} />
          <Route path="/attendance" element={<Attendance me={me} />} />
          <Route path="/collections" element={<Collections me={me} />} />
          <Route path="/targets" element={<Targets me={me} />} />
          <Route path="/reports" element={<Reports me={me} />} />
          <Route path="/penalties" element={<Penalties me={me} />} />
          <Route path="/admin" element={has(me, 'admin', 'hr_admin') ? <Admin me={me} /> : <Navigate to="/" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
        </Suspense>
      </main>
      {menu && <div className="moresheet" role="menu">
        {more.map((n) => <NavLink key={n.to} to={n.to} role="menuitem" onClick={() => setMenu(false)}><span aria-hidden>{n.ico}</span> {n.label}</NavLink>)}
        <div className="small muted" style={{ padding: '8px 12px' }}>{me.full_name} · {me.roles.map((r) => r.replace('_', ' ')).join(', ')}</div>
        <button className="btn sm" style={{ margin: '0 12px 8px' }} onClick={() => sb.auth.signOut()}>Sign out</button>
      </div>}
      <nav className="bottomnav" aria-label="Main navigation">
        {mobile.map((n) => <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={() => setMenu(false)}><span className="ico" aria-hidden>{n.ico}</span>{n.label}</NavLink>)}
        <a href="#more" role="button" aria-expanded={menu} onClick={(e) => { e.preventDefault(); setMenu(!menu); }}><span className="ico" aria-hidden>☰</span>More</a>
      </nav>
    </div>
  );
}
