import { useEffect, useState } from 'react';
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
import Reports from './pages/Reports';
import Admin from './pages/Admin';
import Penalties from './pages/Penalties';

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [err, setErr] = useState<unknown>(null);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setMe(session === null ? null : undefined); return; }
    (async () => {
      try {
        let w = await rpc<Me | null>('whoami');
        if (!w) { await rpc('claim_my_person'); w = await rpc<Me | null>('whoami'); }
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
      <p>You are signed in as <b>{session.user.email}</b>, but there is no active CRUX invitation for this email address, or it has expired.</p>
      <p className="muted">Ask your manager or HR to add you (or re-send the invitation), then sign in again.</p>
      <button className="btn" onClick={() => sb.auth.signOut()}>Sign out</button>
    </div>
  );

  const nav = [
    { to: '/', label: 'Home', ico: '⌂', show: true },
    { to: '/productivity', label: 'My day', ico: '✎', show: true },
    { to: '/team', label: 'My team', ico: '☷', show: me.manages_operations || me.manages_collections },
    { to: '/collections', label: 'Collections', ico: '₹', show: me.has_collections || has(me, 'collections_head', 'ops_head', 'admin', 'auditor') },
    { to: '/targets', label: 'Targets', ico: '◎', show: true },
    { to: '/reports', label: 'Reports', ico: '▤', show: isLeader(me) || me.manages_operations },
    { to: '/penalties', label: 'Penalties', ico: '⚑', show: true },
    { to: '/admin', label: 'Admin', ico: '⚙', show: has(me, 'admin', 'hr_admin') },
  ].filter((n) => n.show);
  const mobile = nav.filter((n) => ['/', '/productivity', '/team', '/collections', '/targets'].includes(n.to)).slice(0, 5);

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
        <Routes>
          <Route path="/" element={<Home me={me} />} />
          <Route path="/productivity" element={<Productivity me={me} />} />
          <Route path="/team" element={<Team me={me} />} />
          <Route path="/collections" element={<Collections me={me} />} />
          <Route path="/targets" element={<Targets me={me} />} />
          <Route path="/reports" element={<Reports me={me} />} />
          <Route path="/penalties" element={<Penalties me={me} />} />
          <Route path="/admin" element={has(me, 'admin', 'hr_admin') ? <Admin me={me} /> : <Navigate to="/" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
      <nav className="bottomnav" aria-label="Main navigation">
        {mobile.map((n) => <NavLink key={n.to} to={n.to} end={n.to === '/'}><span className="ico" aria-hidden>{n.ico}</span>{n.label}</NavLink>)}
      </nav>
    </div>
  );
}
