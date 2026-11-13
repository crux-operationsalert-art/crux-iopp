import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { configured, entersFigures, has, isNetworkError, Me, paused, rpc, sb, setPausedNow } from './lib/api';
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
import { logAccess } from './lib/device';
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
  useEffect(() => { if (me?.person_id) void logAccess(); }, [me?.person_id]);   // sign-in and device log (D-139)
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
        setPausedNow(w?.paused_modules); setMe(w);
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
  const hubs = menuHubs(view);
  /** A page Admin has turned off for this person's role, or paused for everyone, goes back to Home (the server refuses it as well). */
  const gate = (page: string, el: JSX.Element) => ((view.hidden_pages ?? []).includes(page) ? <Navigate to="/" /> : el);
  const mobile = [...['home', 'day', 'perf', 'work'].map((k) => hubs.find((h) => h.key === k)), ...hubs.filter((h) => !['home', 'day', 'perf', 'work', 'admin'].includes(h.key))]
    .filter((h): h is Hub => !!h).slice(0, 4);
  const adminHome = has(view, 'admin', 'hr_admin') ? <Admin me={view} /> : has(view, 'auditor', 'leadership') ? <Admin me={view} /> : <Navigate to="/" />;

  return (
    <div className="shell">
      <aside className={`side ${side ? '' : 'collapsed'}`} aria-label="Main navigation">
        <div className="brand" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}><Logo compact /><span className="small muted">Productivity · {me.company?.website}</span></div>
        <Menu hubs={hubs} unread={unread} />
        <div className="small muted" style={{ padding: '12px 10px' }}>
          {me.full_name}<br />{(preview ? view.roles : me.roles).map((r) => r.replace('_', ' ')).join(', ')}<br />
          <button className="btn sm" style={{ marginTop: 8 }} onClick={() => sb.auth.signOut()}>Sign out</button>
          <div className="footlinks"><Link to="/notifications">Alerts &amp; app</Link><span aria-hidden>·</span><Link to="/about">About</Link></div>
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
        <HubTabs hubs={hubs} unread={unread} />
        <Suspense fallback={<Loading rows={4} />}>
        <Routes>
          <Route path="/" element={<Home me={view} />} />
          <Route path="/productivity" element={<Productivity me={view} />} />
          <Route path="/team" element={gate('team', <Team me={view} />)} />
          <Route path="/attendance" element={gate('attendance', <Attendance me={view} />)} />
          <Route path="/tasks" element={gate('tasks', <Tasks me={view} />)} />
          <Route path="/profile" element={paused(me, 'hr_docs') ? <Navigate to="/" /> : <CompleteProfile me={me} onDone={refresh} />} />
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
          <Route path="/admin" element={adminHome} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
        </Suspense>
      </main>
      {menu && <div className="drawer" role="dialog" aria-label="Menu" onClick={(e) => { if ((e.target as HTMLElement).closest('a')) setMenu(false); }}>
        <div className="row" style={{ padding: '4px 4px 8px' }}><Logo compact /><span className="spacer" /><button className="btn sm" onClick={() => setMenu(false)} aria-label="Close menu"><Icon name="close" size={18} /></button></div>
        <Menu hubs={hubs} unread={unread} />
        <div className="small muted" style={{ padding: '8px 12px' }}>{me.full_name} · {me.roles.map((r) => r.replace('_', ' ')).join(', ')}</div>
        <button className="btn sm" style={{ margin: '0 12px 8px' }} onClick={() => sb.auth.signOut()}>Sign out</button>
        <div className="footlinks" style={{ padding: '0 12px 12px' }}><Link to="/notifications">Alerts &amp; app</Link><span aria-hidden>·</span><Link to="/about">About</Link></div>
      </div>}
      {!['/chat', '/tasks'].includes(loc.pathname) && (() => { const off = (k: string) => (view.hidden_pages ?? []).includes(k); const to = !off('chat') ? '/chat' : !off('tasks') ? '/tasks' : null;
        return to ? <Link to={to} className="fab" aria-label={unread > 0 ? `Chat and tasks, ${unread} unread` : 'Chat and tasks'} title="Chat & tasks"><Icon name="chat" size={24} />{unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}</Link> : null; })()}
      <nav className="bottomnav" aria-label="Quick navigation">
        {mobile.map((h) => { const on = h.items.some((i) => isActive(i.to, loc)); const chat = h.key === 'work';
          return <Link key={h.key} to={h.items[0].to} className={on ? 'active' : ''} aria-current={on ? 'page' : undefined} onClick={() => setMenu(false)}><span className="ico" aria-hidden><Icon name={h.ico} size={22} />{chat && unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}</span>{h.short ?? h.label}{chat && unread > 0 && <span className="sr"> ({unread} unread)</span>}</Link>; })}
        <a href="#menu" role="button" aria-expanded={menu} onClick={(e) => { e.preventDefault(); setMenu(!menu); }}><span className="ico" aria-hidden><Icon name="menu" size={22} /></span>Menu</a>
      </nav>
    </div>
  );
}

type Item = { to: string; label: string };
type Hub = { key: string; label: string; short?: string; ico: string; items: Item[] };

/** The menu (D-148): one short list. Each entry is a place; the pages inside a place are tabs across its top.
 *  A page Admin has hidden for the role, or paused for everyone, is simply not there. */
function menuHubs(me: Me): Hub[] {
  const manager = me.manages_operations || me.manages_collections || has(me, 'admin', 'hr_admin', 'ops_head', 'collections_head', 'zm', 'bm', 'ba', 'manager');
  const off = (p: string) => (me.hidden_pages ?? []).includes(p);
  const staff = has(me, 'admin', 'hr_admin');
  const reports = (!me.ops_blind && ['tracker', 'status', 'live', 'history'].some((k) => !off(k))) || (has(me, 'admin', 'hr_admin', 'ops_head', 'auditor', 'leadership') && !off('attrition'));
  const h: Hub[] = [
    { key: 'home', label: 'Home', ico: 'home', items: [{ to: '/', label: 'Home' }] },
    { key: 'day', label: 'My day', ico: 'day', items: [
      ...(entersFigures(me) || me.has_kpis ? [{ to: '/productivity', label: entersFigures(me) ? 'Daily update' : 'My update' }] : []),
      ...(entersFigures(me) && !off('plan') ? [{ to: '/plan', label: 'Check-in & plan' }] : []),
      ...(off('attendance') ? [] : [{ to: '/attendance', label: 'Attendance & leave' }])] },
    { key: 'perf', label: 'Performance', short: 'Perform', ico: 'target', items: [
      ...((me.has_kpis || manager) && !off('kpis') ? [{ to: '/kpis', label: manager ? 'KPIs & attributes' : 'My KPIs' }] : []),
      ...(manager && !off('reviews') ? [{ to: '/reviews', label: 'Reviews & scores' }] : [{ to: '/reviews', label: 'My review' }]),
      ...(!me.ops_blind && !off('targets') ? [{ to: '/targets', label: 'Targets' }] : [])] },
    { key: 'team', label: 'My team', short: 'Team', ico: 'team', items: [
      ...(manager && !off('team') ? [{ to: '/team', label: 'Team & daily review' }] : []),
      ...(!off('payroll') && (manager || staff) ? [{ to: '/payroll', label: 'Payroll' }] : []),
      ...(manager && !off('penalties') ? [{ to: '/penalties', label: 'Penalties' }] : [])] },
    { key: 'work', label: 'Chat & tasks', short: 'Chat', ico: 'chat', items: [
      ...(off('chat') ? [] : [{ to: '/chat', label: 'Chat' }]),
      ...(off('tasks') ? [] : [{ to: '/tasks', label: 'Tasks' }])] },
    { key: 'reports', label: 'Reports', ico: 'chart', items: reports ? [{ to: '/reports', label: 'Reports' }] : [] },
    { key: 'me', label: 'My records', short: 'Records', ico: 'user', items: [
      ...(off('letters') ? [] : [{ to: '/letters', label: 'Letters & salary slips' }]),
      ...(!off('payroll') && !(manager || staff) ? [{ to: '/payroll', label: 'My pay statement' }] : []),
      ...(!manager && !off('penalties') ? [{ to: '/penalties', label: 'Penalties' }] : []),
      ...(paused(me, 'hr_docs') ? [] : [{ to: '/profile', label: 'My profile' }])] },
  ];
  if (staff) h.push({ key: 'admin', label: 'Admin', ico: 'gear', items: [{ to: '/admin', label: 'Admin' }] });
  else if (has(me, 'auditor', 'leadership') && !off('adm_log')) h.push({ key: 'admin', label: 'Activity log', ico: 'gear', items: [{ to: '/admin?s=log', label: 'Activity log' }] });
  // "My day" with a single tab reads better under that tab's own name
  return h.filter((x) => x.items.length).map((x) => (x.key === 'work' && x.items.length === 1 ? { ...x, label: x.items[0].label, short: x.items[0].label } : x));
}

function isActive(to: string, loc: { pathname: string; search: string }) {
  return to.split('?')[0] === loc.pathname;
}

/** The short menu: one line per place. */
function Menu({ hubs, unread = 0 }: { hubs: Hub[]; unread?: number }) {
  const loc = useLocation();
  return (
    <nav className="nav menu flat">{hubs.map((h) => {
      const on = h.items.some((i) => isActive(i.to, loc));
      return <Link key={h.key} to={h.items[0].to} className={on ? 'active' : ''} aria-current={on ? 'page' : undefined}><Icon name={h.ico} size={18} />{h.label}
        {h.key === 'work' && unread > 0 && <span className="pill info small" style={{ marginLeft: 'auto' }}>{unread} new</span>}</Link>;
    })}</nav>
  );
}

/** The tabs of the place that is open (nothing when the place has a single page). */
function HubTabs({ hubs, unread }: { hubs: Hub[]; unread: number }) {
  const loc = useLocation();
  const hub = hubs.find((h) => h.items.length > 1 && h.items.some((i) => isActive(i.to, loc)));
  if (!hub) return null;
  return (
    <div className="hubtabs" role="tablist" aria-label={hub.label}>
      {hub.items.map((i) => { const on = isActive(i.to, loc);
        return <Link key={i.to} role="tab" aria-selected={on} className={on ? 'on' : ''} to={i.to}>{i.label}{i.to === '/chat' && unread > 0 && <span className="pill info small" style={{ marginLeft: 6 }}>{unread}</span>}</Link>; })}
    </div>
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
