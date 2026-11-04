import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { has, Me, rpc, sb, select } from '../lib/api';
import { label, time } from '../lib/format';
import { canPromptInstall, disablePush, enablePush, isInstalled, isIOS, notifState, onInstallChange, promptInstall, pushActive } from '../lib/push';
import { Card, Empty, ErrorBox, Loading, Pill, useLoad } from '../components/ui';

/** Install button + step-by-step guide. Shown on the sign-in page (link in the invitation message) and in Notifications. */
export function InstallGuide({ compact }: { compact?: boolean }) {
  const [, force] = useState(0);
  useEffect(() => onInstallChange(() => force((x) => x + 1)), []);
  if (isInstalled()) return <div className="banner ok">The app is installed on this device. Open it from your home screen.</div>;
  return (
    <div className="stack">
      {canPromptInstall() && <button className="btn primary" onClick={() => promptInstall()}>Install the CRUX app</button>}
      {!compact || !canPromptInstall() ? (isIOS()
        ? <ol className="small" style={{ margin: 0, paddingLeft: 18 }}><li>Open this link in <b>Safari</b>.</li><li>Tap <b>Share</b> (square with an arrow) → <b>Add to Home Screen</b> → <b>Add</b>.</li>
            <li>Open <b>CRUX</b> from your home screen and sign in.</li><li>Go to <b>Notifications</b> and tap <b>Turn on notifications</b>.</li></ol>
        : <ol className="small" style={{ margin: 0, paddingLeft: 18 }}><li>Open this link in <b>Chrome</b>.</li><li>Tap <b>Install the CRUX app</b> above, or the menu <b>⋮</b> → <b>Install app</b> / <b>Add to Home screen</b>.</li>
            <li>Open <b>CRUX</b> from your home screen and sign in.</li><li>Allow notifications when asked.</li></ol>) : null}
    </div>
  );
}

/** One-time card asking for the permissions the app uses (notifications; install). Taps are needed — browsers do not allow automatic prompts. */
export function PermissionCard({ me }: { me: Me }) {
  const [st, setSt] = useState<string>(notifState());
  const [on, setOn] = useState<boolean | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { pushActive().then(setOn); }, [st]);
  if (on || st === 'unsupported' && isInstalled()) return null;
  async function allow() { setBusy(true); setMsg(''); try { const r = await enablePush(); if (r !== 'ok') setMsg(r); setSt(notifState()); setOn(await pushActive()); } catch (e) { setMsg(String((e as Error).message ?? e)); } finally { setBusy(false); } }
  return (
    <Card title="Set up this phone">
      <p className="small muted">Hi {me.full_name.split(' ')[0]} — allow notifications so reminders for your daily report, tasks and misses reach you even when the app is closed.</p>
      <div className="row"><button className="btn primary" disabled={busy} onClick={allow}>{busy ? 'Asking…' : 'Turn on notifications'}</button>
        {!isInstalled() && canPromptInstall() && <button className="btn" onClick={() => promptInstall()}>Install app</button>}</div>
      {st === 'denied' && <div className="banner warn small">Notifications are blocked for this site. Phone settings → Apps → Chrome (or CRUX) → Notifications → Allow, then tap the button again.</div>}
      {msg && <div className="banner warn small">{msg}</div>}
    </Card>
  );
}

export default function Notifications({ me }: { me: Me }) {
  const nav = useNavigate();
  const [unread, setUnread] = useState(false);
  const list = useLoad(() => select('notifications', '*', (b) => (unread ? b.is('read_at', null) : b).order('created_at', { ascending: false }).limit(100)), [unread]);
  const [on, setOn] = useState<boolean | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { pushActive().then(setOn); }, []);
  async function toggle() {
    setMsg('');
    try { if (on) { await disablePush(); setOn(false); } else { const r = await enablePush(); if (r !== 'ok') setMsg(r); setOn(await pushActive()); } }
    catch (e) { setMsg(String((e as Error).message ?? e)); }
  }
  async function open(n: any) {
    if (!n.read_at) await sb.rpc('mark_notifications_read', { p_ids: [n.id] });
    if (n.link) nav(n.link); else list.reload();
  }
  return (
    <div className="stack">
      <div className="topbar"><div><h1>Notifications</h1><div className="muted">Reminders, tasks and misses. With notifications turned on they also arrive on your phone.</div></div></div>
      {canAlert(me) && <SendAlert />}
      <Card title="This device">
        <div className="row"><span>Phone notifications</span><span className="spacer" />{on == null ? <Loading rows={1} /> : <Pill status={on ? 'active' : 'inactive'} text={on ? 'On' : 'Off'} />}
          <button className={`btn ${on ? '' : 'primary'}`} onClick={toggle}>{on ? 'Turn off' : 'Turn on notifications'}</button></div>
        {notifState() === 'denied' && <div className="banner warn small">Notifications are blocked. Phone settings → Apps → Chrome (or CRUX) → Notifications → Allow, then try again.</div>}
        {msg && <div className="banner warn small">{msg}</div>}
        <div className="row" style={{ marginTop: 10 }}><span>App installed</span><span className="spacer" /><Pill status={isInstalled() ? 'active' : 'inactive'} text={isInstalled() ? 'Yes' : 'No'} /></div>
        {!isInstalled() && <InstallGuide compact />}
      </Card>
      <Card title="Messages" action={<div className="row">
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" style={{ width: 'auto', minHeight: 0 }} checked={unread} onChange={(e) => setUnread(e.target.checked)} /> Unread only</label>
        <button className="btn sm" onClick={async () => { await sb.rpc('mark_notifications_read', {}); list.reload(); }}>Mark all read</button></div>}>
        {list.loading ? <Loading /> : <ErrorBox error={list.error} retry={list.reload} />}
        {list.data && (list.data.length === 0 ? <Empty>No notifications.</Empty> : <div className="stack" style={{ gap: 0 }}>{list.data.map((n: any) => (
          <button key={n.id} className="linklike row" onClick={() => open(n)} style={{ textAlign: 'left', padding: '10px 4px', borderBottom: '1px solid var(--border)', fontWeight: n.read_at ? 400 : 600, width: '100%' }}>
            <Pill status={n.kind === 'miss' ? 'overdue' : 'reopened'} text={label(n.kind)} /><span style={{ flex: 1 }}>{n.message}</span><span className="small muted">{time(n.created_at)}</span>
          </button>))}</div>)}
      </Card>
    </div>
  );
}

export const canAlert = (me: Me) => has(me, 'admin', 'leadership', 'ops_head', 'collections_head', 'hr_admin');

/** Admin, HR and the heads send a one-click app alert (in the app and on the phone) to chosen people. */
export function SendAlert({ initial = '', title = 'Send an app alert' }: { initial?: string; title?: string }) {
  const ppl = useLoad(() => select('persons', 'id,full_name,designation', (b) => b.in('status', ['active', 'invited']).order('full_name')), []);
  const [open, setOpen] = useState(!!initial);
  const [msg, setMsg] = useState(initial);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [ok, setOk] = useState('');
  const list = ((ppl.data ?? []) as any[]).filter((p) => !q || `${p.full_name} ${p.designation ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Card title={title} action={<button className="btn sm" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Write alert'}</button>}>
      {open && <div className="stack">
        <label className="field">Message<textarea rows={2} value={msg} maxLength={400} onChange={(e) => setMsg(e.target.value)} /></label>
        <div className="row" style={{ alignItems: 'end' }}><label className="field" style={{ flex: 1 }}>Send to — search name or designation<input value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <button className="btn sm" onClick={() => setSel([...new Set([...sel, ...list.map((p) => p.id)])])}>Select all {q ? 'shown' : ''} ({list.length})</button>
          <button className="btn sm" onClick={() => setSel([])}>Clear</button></div>
        {ppl.loading ? <Loading rows={2} /> : <div className="stack" style={{ maxHeight: 200, overflow: 'auto', gap: 2 }}>{list.map((p) => (
          <label key={p.id} className="row small" style={{ gap: 6 }}><input type="checkbox" style={{ width: 'auto', minHeight: 0 }} checked={sel.includes(p.id)}
            onChange={(e) => setSel(e.target.checked ? [...sel, p.id] : sel.filter((x) => x !== p.id))} />{p.full_name}<span className="muted">{p.designation ?? ''}</span></label>))}</div>}
        <ErrorBox error={err} />{ok && <div className="banner ok" role="status">{ok}</div>}
        <button className="btn primary" disabled={busy || !msg.trim() || !sel.length} onClick={async () => {
          setBusy(true); setErr(null); setOk('');
          try { const n = await rpc<number>('send_alert', { p_people: sel, p_message: msg.trim() }); setOk(`Sent to ${n} people.`); setSel([]); setMsg(''); }
          catch (e) { setErr(e); } finally { setBusy(false); }
        }}>Send to {sel.length} {sel.length === 1 ? 'person' : 'people'}</button>
      </div>}
    </Card>
  );
}
