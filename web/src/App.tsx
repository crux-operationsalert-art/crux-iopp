import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { configured, entersFigures, has, isNetworkError, Me, rpc, sb } from './lib/api';
import { flush } from './lib/netcheck';
import { NetAdvice } from './components/NetAdvice';
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
const Payroll = lazy(() => import('./pages/Payroll'));
import Notifications from './pages/Notifications';
import About from './pages/About';
import Plan from './pages/Plan';
import Reviews from './pages/Reviews';
import Kpis from './pages/Kpis';
import Letters from './pages/Letters';
import Chat from './pages/Chat';
import { Icon } from './components/Icon';
import { onChat, startLive } from './lib/live';
import { NotifyGate } from './components/NotifyGate';
import { applyPersona, personaRoles, PERSONAS, PersonaKey } from './lib/preview';
import { pushActive } from './lib/push';
import { AgreementGate, CompleteProfile, Logo } from './pages/Onboard';
import { MfaPrompt, needsCode } from './pages/TwoStep';

let reported = false;
const isStandalone = () => { try { return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true; } catch { return false; } };

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [err, setErr] = useState<unknown>(null);
  const [menu, setMenu] = useState(false);
  const [side, setSide] = useState(() => { try { return localStorage.getItem('crux-side') !== '0'; } catch { return true; } });
  const [hideInstall, setHideInstall] = useState(() => { try { return sessionStorage.getItem('crux-install-hide') === '1'; } catch { return false; } });
  const [skipProfile, setSkipProfile] = useState(() => { try { return sessionStorage.getItem('crux-profile-skip') === '1'; } catch { return false; } });
  const [notifOk, setNotifOk] = useState<boolean | null>(null);
  const [preview, setPreview] = useState<PersonaKey | null>(() => { try { return (sessionStorage.getItem('crux-preview') as PersonaKey) || null; } catch { return null; } });
  // the preview follows Admin's "Who sees what" card: pages hidden for the previewed role are hidden here too (D-125)
  const [prevPages, setPrevPages] = useState<{ key: PersonaKey; hidden: string[]; limited: Record<string, string> } | null>(null);
  useEffect(() => {
    if (!preview) { setPrevPages(null); return; }
    let live = true;
    rpc<{ hidden: string[]; limited: Record<string, string> }>('pages_for_roles', { p_roles: personaRoles(preview) })
      .then((r) => { if (live) setPrevPages({ key: preview, hidden: r.hidden ?? [], limited: r.limited ?? {} }); }).catch(() => { if (live) setPrevPages(null); });
    return () => { live = false; };
  }, [preview]);
  const setPrev = (k: PersonaKey | null) => { try { k ? sessionStorage.setItem('crux-preview', k) : sessionStorage.removeItem('crux-preview'); } catch { /* ignore */ } setPreview(k); };
  useEffect(() => { let on = true; pushActive().then((a) => on && setNotifOk(a)); return () => { on = false; }; }, []);
  useEffect(() => { try { localStorage.setItem('crux-side', side ? '1' : '0'); } catch { /* optional */ } }, [side]);
  const loc = useLocation();

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const [n, setN] = useState(0);
  const [code, setCode] = useState(false);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if (!session) { setMe(session === null ? null : undefined); return; }
    (async () => {
      try {
        if (await needsCode()) { setCode(true); setMe(null); return; }
        setCode(false); setOffline(false); setErr(null);
        const w = await rpc<Me | null>('whoami');
        setMe(w);
        if (w) {
          flush((ev) => rpc('log_net_events', { p_events: ev }));
          if (!reported) { reported = true;   // installed app or browser? (for the install reminder, D-96)
            rpc('report_client', { p_standalone: isStandalone(), p_push: typeof Notification !== 'undefined' && Notification.permission === 'granted', p_user_agent: navigator.userAgent }).catch(() => null); }
        }
      } catch (e) { setErr(e); setMe(null); setOffline(isNetworkError(e)); }
    })();
  }, [session, n]);
  const refresh = () => setN((x) => x + 1);
  // unread chat messages for the Chat tab badge (D-99); light polling, paused when the app is in the background
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!me) return;
    const tick = () => { if (document.visibilityState === 'visible') rpc<number>('chat_unread').then((u) => setUnread(Number(u) || 0)).catch(() => null); };
    tick(); const t = window.setInterval(tick, 60000); document.addEventListener('visibilitychange', tick);
    const stop = startLive();                                   // instant: a new message updates the badge at once (D-102)
    const off = onChat((m) => { if (m.sender_id !== me.person_id) window.setTimeout(tick, 300); });
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', tick); off(); stop(); };
  }, [me?.person_id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (me) rpc<number>('chat_unread').then((u) => setUnread(Number(u) || 0)).catch(() => null); }, [loc.pathname]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!configured) return <div className="login card"><h1>Setup needed</h1><p>VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are not set.</p></div>;
  if (session === undefined || (session && me === undefined)) return <div className="login"><Loading /></div>;
  if (!session) return <Login />;
  if (code) return <MfaPrompt onDone={() => setN((x) => x + 1)} />;
  if (!me && offline) return (
    <div className="login card stack">
      <h1>Can't reach the server</h1>
      <p>You are signed in, but the app could not load your account.</p>
      <NetAdvice />
      <div className="row"><button className="btn primary" onClick={() => setN((x) => x + 1)}>Try again</button>
        <button className="btn" onClick={() => sb.auth.signOut()}>Sign out</button></div>
    </div>
  );
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
  // D-106: notifications are compulsory — the app does not go past this until this phone has them on.
  if (notifOk === false) return <NotifyGate me={me} onReady={() => setNotifOk(true)} />;
  // D-88: 3 days to complete the profile (asked once per session, "skip for now"); after that it is required.
  if (me.profile_missing.length && (me.profile?.blocking || !skipProfile)) return <CompleteProfile me={me} gate onDone={refresh}
    onSkip={me.profile?.blocking ? undefined : () => { try { sessionStorage.setItem('crux-profile-skip', '1'); } catch { /* private mode */ } setSkipProfile(true); }} />;

  const realAdmin = has(me, 'admin');
  const view = preview && realAdmin ? { ...applyPersona(me, preview), hidden_pages: prevPages?.key === preview ? prevPages.hidden : [] } : me;
  const groups = menuGroups(view);
  /** A page Admin has turned off for this person's role goes back to Home (the server refuses it as well). */
  const gate = (page: string, el: JSX.Element) => ((view.hidden_pages ?? []).includes(page) ? <Navigate to="/" /> : el);
  const flat = groups.flatMap((g) => g.items);
  const mobile = flat.filter((n) => (entersFigures(view) ? ['/', '/productivity', '/chat', '/tasks', '/notifications'] : ['/', '/reports?v=tracker', '/chat', '/tasks', '/notifications']).includes(n.to)).slice(0, 5);

  return (
    <div className="shell">
      <aside className={`side ${side ? '' : 'collapsed'}`} aria-label="Main navigation">
        <div className="brand" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}><Logo compact /><span className="small muted">Productivity · {me.company?.website}</span></div>
        <Menu groups={groups} unread={unread} />
        <div className="small muted" style={{ padding: '12px 10px' }}>
          {me.full_name}<br />{(preview ? view.roles : me.roles).map((r) => r.replace('_', ' ')).join(', ')}<br />
          <button className="btn sm" style={{ marginTop: 8 }} onClick={() => sb.auth.signOut()}>Sign out</button>
          <div className="footlinks"><Link to="/reviews">My review</Link><span aria-hidden>·</span><Link to="/about">About</Link></div>
        </div>
      </aside>
      <main className="main">
        {realAdmin && <PreviewBar value={preview} onChange={setPrev} hidden={prevPages?.key === preview ? prevPages.hidden.length : 0} limited={prevPages?.key === preview ? Object.keys(prevPages.limited).length : 0} />}
        <button className="btn ghost sm hamburger desktop-only" aria-label={side ? 'Hide menu' : 'Show menu'} aria-expanded={side} onClick={() => setSide(!side)}><Icon name="menu" size={18} /> Menu</button>
        {me.profile_missing.length > 0 && me.profile && <div className="banner warn row" style={{ marginBottom: 10 }}>
          <span>Your profile is <b>{me.profile.pct}%</b> complete. Finish it by {new Date(me.profile.due_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} — after that the app stays locked until it is done.</span>
          <span className="spacer" /><Link className="btn sm primary" to="/profile">Complete now</Link></div>}
        {!isStandalone() && !hideInstall && loc.pathname !== '/notifications' && <div className="banner info row" style={{ marginBottom: 10 }}>
          <span>You are using CRUX in the browser. Install the app on your phone — it opens faster and you get reminders.</span><span className="spacer" />
          <Link className="btn sm primary" to="/notifications">Install the app</Link>
          <button className="btn sm" onClick={() => { try { sessionStorage.setItem('crux-install-hide', '1'); } catch { /* private mode */ } setHideInstall(true); }}>Later</button></div>}
        <Suspense fallback={<Loading rows={4} />}>
        <Routes>
          <Route path="/" element={<Home me={view} />} />
          <Route path="/productivity" element={<Productivity me={view} />} />
          <Route path="/team" element={gate('team', <Team me={view} />)} />
          <Route path="/attendance" element={gate('attendance', <Attendance me={view} />)} />
          <Route path="/tasks" element={gate('tasks', <Tasks me={view} />)} />
          <Route path="/profile" element={<CompleteProfile me={me} onDone={refresh} />} />
          <Route path="/about" element={<About me={view} />} />
          <Route path="/plan" element={gate('plan', <Plan me={view} />)} />
          <Route path="/reviews" element={<Reviews me={view} />} />
          <Route path="/kpis" element={gate('kpis', <Kpis me={view} />)} />
          <Route path="/letters" element={gate('letters', <Letters me={view} />)} />
          <Route path="/notifications" element={<Notifications me={me} />} />
          <Route path="/chat" element={gate('chat', <Chat me={view} onRead={() => rpc<number>('chat_unread').then((u) => setUnread(Number(u) || 0)).catch(() => null)} />)} />
          <Route path="/install" element={<Navigate to="/notifications" />} />
          <Route path="/collections" element={<Navigate to="/" />} />
          <Route path="/targets" element={gate('targets', <Targets me={view} />)} />
          <Route path="/reports" element={<Reports me={view} />} />
          <Route path="/penalties" element={gate('penalties', <Penalties me={view} />)} />
          <Route path="/payroll" element={gate('payroll', <Payroll me={view} />)} />
          <Route path="/admin" element={has(view, 'admin', 'hr_admin', 'auditor', 'leadership') ? <Admin me={view} /> : <Navigate to="/" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
        </Suspense>
      </main>
      {menu && <div className="drawer" role="dialog" aria-label="Menu" onClick={(e) => { if ((e.target as HTMLElement).closest('a')) setMenu(false); }}>
        <div className="row" style={{ padding: '4px 4px 8px' }}><Logo compact /><span className="spacer" /><button className="btn sm" onClick={() => setMenu(false)} aria-label="Close menu"><Icon name="close" size={18} /></button></div>
        <Menu groups={groups} unread={unread} />
        <div className="small muted" style={{ padding: '8px 12px' }}>{me.full_name} · {me.roles.map((r) => r.replace('_', ' ')).join(', ')}</div>
        <button className="btn sm" style={{ margin: '0 12px 8px' }} onClick={() => sb.auth.signOut()}>Sign out</button>
        <div className="footlinks" style={{ padding: '0 12px 12px' }}><Link to="/reviews">My review</Link><span aria-hidden>·</span><Link to="/about">About</Link></div>
      </div>}
      <nav className="bottomnav" aria-label="Quick navigation">
        {mobile.map((n) => <Link key={n.to} to={n.to} className={isActive(n.to, loc) ? 'active' : ''} onClick={() => setMenu(false)}><span className="ico" aria-hidden><Icon name={n.ico} size={22} />{n.to === '/chat' && unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}</span>{n.short ?? n.label}{n.to === '/chat' && unread > 0 && <span className="sr"> ({unread} unread)</span>}</Link>)}
        <a href="#menu" role="button" aria-expanded={menu} onClick={(e) => { e.preventDefault(); setMenu(!menu); }}><span className="ico" aria-hidden><Icon name="menu" size={22} /></span>Menu</a>
      </nav>
    </div>
  );
}

type Item = { to: string; label: string; ico: string; short?: string };
type Group = { key: string; label: string; ico: string; items: Item[] };
const ADMIN_SECTIONS: [string, string, boolean][] = [['people', 'People', false], ['compliance', 'HR repository', false], ['doccheck', 'Document check', false], ['letters', 'Letters & salary slips', false], ['quality', 'Data quality', false], ['usage', 'App usage report', false], ['kpis', 'KPIs', false], ['access', 'Who sees what', true], ['locations', 'Locations & heads', false],
  ['clients', 'Clients & rates', true], ['targets', 'Monthly targets', true], ['upload', 'Bulk upload', false], ['reopen', 'Reopen days', true],
  ['close', 'Month close & backup', true], ['policy', 'Leave, holidays & policies', false], ['settings', 'Settings', true], ['log', 'Activity log', true]];

/** Menu categories; each category holds its tabs. */
function menuGroups(me: Me): Group[] {
  const manager = me.manages_operations || me.manages_collections || has(me, 'admin', 'hr_admin', 'ops_head', 'collections_head', 'zm', 'bm', 'ba', 'manager');
  const off = (p: string) => (me.hidden_pages ?? []).includes(p);   // pages Admin has turned off for this role (D-122)
  const g: Group[] = [
    { key: 'work', label: 'My work', ico: 'day', items: [
      { to: '/', label: 'Home · performance & collections', short: 'Home', ico: 'home' },
      ...(entersFigures(me) ? [{ to: '/productivity', label: 'My day (operations & collections)', short: 'My day', ico: 'day' },
        ...(off('plan') ? [] : [{ to: '/plan', label: 'My plan & check-in', short: 'Plan', ico: 'target' }])] : []),
      ...(off('chat') ? [] : [{ to: '/chat', label: 'Chat', short: 'Chat', ico: 'chat' }]),
      ...(off('tasks') ? [] : [{ to: '/tasks', label: 'Tasks & misses', short: 'Tasks', ico: 'tasks' }]),
      { to: '/notifications', label: 'Notifications', short: 'Alerts', ico: 'bell' },
      ...(off('attendance') ? [] : [{ to: '/attendance', label: 'Attendance & leave', ico: 'clock' }]),
      ...(off('letters') ? [] : [{ to: '/letters', label: 'My letters & salary slips', ico: 'file' }]),
      ...((me.has_kpis || manager) && !off('kpis') ? [{ to: '/kpis', label: manager ? 'KPIs & attributes' : 'My KPIs', ico: 'target' }] : []),
      { to: '/profile', label: 'My profile', ico: 'user' }] },
    { key: 'team', label: 'Team', ico: 'team', items: [
      ...(manager && !off('team') ? [{ to: '/team', label: 'My team', ico: 'team' }] : []),
      ...(manager && !off('reviews') ? [{ to: '/reviews', label: 'Reviews & scores', ico: 'chart' }] : []),
      ...(!me.ops_blind && !off('targets') ? [{ to: '/targets', label: 'Targets', ico: 'target' }] : []),
      ...(off('payroll') ? [] : manager || has(me, 'admin', 'hr_admin') ? [{ to: '/payroll', label: 'Payroll', ico: 'rupee' }] : [{ to: '/payroll', label: 'My pay statement', ico: 'rupee' }]),
      ...(off('penalties') ? [] : [{ to: '/penalties', label: 'Penalties', ico: 'flag' }])] },
    { key: 'reports', label: 'Reports', ico: 'chart', items: [
      ...(!me.ops_blind && !off('tracker') ? [{ to: '/reports?v=tracker', label: 'Zonal Tracker', short: 'Tracker', ico: 'chart' }] : []),
      ...(!me.ops_blind && !off('status') ? [{ to: '/reports?v=status', label: 'Revenue Status', ico: 'rupee' }] : []),
      ...(!me.ops_blind && !off('live') ? [{ to: '/reports?v=live', label: 'Daily submissions', ico: 'check' }] : []),
      ...(!me.ops_blind && !off('history') ? [{ to: '/reports?v=history', label: 'History (Oct 2024 – Oct 2026)', ico: 'history' }] : []),
      ...(has(me, 'admin', 'hr_admin', 'ops_head', 'auditor', 'leadership') && !off('attrition') ? [{ to: '/reports?v=attrition', label: 'Attrition', ico: 'swap' }] : [])] },
  ];
  if (has(me, 'auditor', 'leadership') && !has(me, 'admin', 'hr_admin') && !off('adm_log')) g.push({ key: 'admin', label: 'Audit', ico: 'gear', items: [{ to: '/admin?s=log', label: 'Activity log (read only)', ico: 'gear' }] });
  if (has(me, 'admin', 'hr_admin')) g.push({ key: 'admin', label: 'Admin', ico: 'gear', items: ADMIN_SECTIONS.filter(([k, , adminOnly]) => (!adminOnly || has(me, 'admin')) && !off('adm_' + k))
    .map(([k, l]) => ({ to: `/admin?s=${k}`, label: l, ico: 'gear' })) });
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
function Menu({ groups, unread = 0 }: { groups: Group[]; unread?: number }) {
  const loc = useLocation();
  const [open, setOpen] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem('crux-menu') ?? '{}'); } catch { return {}; } });
  const toggle = (k: string) => setOpen((o) => { const n = { ...o, [k]: !(o[k] ?? true) }; try { localStorage.setItem('crux-menu', JSON.stringify(n)); } catch { /* optional */ } return n; });
  return (
    <nav className="nav menu">{groups.map((g) => {
      const here = g.items.some((i) => isActive(i.to, loc));
      const isOpen = here || (open[g.key] ?? true);
      return (
        <div key={g.key} className="menugroup">
          <button className="menuhead" aria-expanded={isOpen} onClick={() => toggle(g.key)}><Icon name={g.ico} size={18} />{g.label}<span className="spacer" /><span aria-hidden className="chev">{isOpen ? '▾' : '▸'}</span></button>
          {isOpen && g.items.map((i) => <Link key={i.to} to={i.to} className={isActive(i.to, loc) ? 'active' : ''}>{i.label}{i.to === '/chat' && unread > 0 && <span className="pill info small" style={{ marginLeft: 6 }}>{unread} new</span>}</Link>)}
        </div>);
    })}</nav>
  );
}

/** Admin-only "see the app as…" switcher (D-111). Changes only what the chosen role sees; data stays the admin's own. */
function PreviewBar({ value, onChange, hidden, limited }: { value: PersonaKey | null; onChange: (k: PersonaKey | null) => void; hidden: number; limited: number }) {
  return (
    <div className={`previewbar ${value ? 'on' : ''}`}>
      <Icon name={value ? 'user' : 'gear'} size={16} />
      {value ? <span><b>Previewing as {PERSONAS.find((p) => p.key === value)?.label}</b> — the menu and pages this role gets, with your own data{hidden ? ` · ${hidden} page${hidden === 1 ? '' : 's'} hidden by Who sees what` : ''}{limited ? ` · ${limited} limited to own or team (the limit applies to their data, not yours)` : ''}</span>
        : <span className="muted">See the app as another designation</span>}
      <span className="spacer" />
      <label className="row small" style={{ gap: 6 }}>View as
        <select value={value ?? ''} onChange={(e) => onChange((e.target.value || null) as PersonaKey | null)} aria-label="Preview the app as a designation">
          <option value="">Admin (you)</option>
          {PERSONAS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select></label>
      {value && <button className="btn sm" onClick={() => onChange(null)}>Exit preview</button>}
    </div>
  );
}
