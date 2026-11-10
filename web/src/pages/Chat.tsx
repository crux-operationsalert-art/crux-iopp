import { HelpTip } from '../components/HelpTip';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Me, rpc } from '../lib/api';
import { nice } from '../lib/format';
import { Icon } from '../components/Icon';
import { Empty, ErrorBox, Loading, useLoad } from '../components/ui';
import { onChat } from '../lib/live';
import { Desk, Faq, findAnswers, forPeople, guessDesk } from '../lib/help';

export type Avail = { state: 'online' | 'alerts' | 'app' | 'away' | 'leave' | 'off' | 'not_joined'; label: string; online: boolean; alerts: string | null; seen: string | null };
type Thread = { id: string; kind: 'direct' | 'team' | 'topic' | 'help'; title: string | null; ref: any; members: number; last_body: string | null; last_sender: string | null;
  last_at: string; unread: number; desk: string | null; other: string | null; availability: Avail | null };
type Msg = { id: number; sender_id: string; sender: string; body: string; ref: any; created_at: string; mine: boolean };
type Contact = { person_id: string; full_name: string; designation: string | null; relation: string; availability: Avail | null };
type DeskInfo = { key: Desk; title: string; blurb: string; people: { person_id: string; full_name: string; designation: string | null; role: 'owner' | 'delegate'; availability: Avail | null }[]; mine: boolean; can_manage: boolean };

const QUICK = ['Noted, thanks', 'Checking — will update in 10 min', 'Figures corrected', 'Please recheck the pending by age', 'Call me when free'];
const when = (s: string) => {
  const d = new Date(s), now = new Date();
  return d.toDateString() === now.toDateString() ? d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const ago = (s: string | null) => {
  if (!s) return '';
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const initials = (n: string | null) => (n ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
export const refText = (r: any) => (r?.client ? `${r.client}${r.location ? ' · ' + r.location : ''}${r.date ? ' · ' + nice(r.date) : ''}` : null);
/** "Online", "On leave today", "Away · gets alerts on phone · seen 5 min ago" … */
export const availText = (a: Avail | null) => (!a ? '' : a.label + (a.state !== 'online' && a.state !== 'not_joined' && a.seen ? ` · seen ${ago(a.seen)}` : ''));
export const Dot = ({ a }: { a: Avail | null }) => (a ? <span className={`adot ${a.state}`} title={availText(a)} aria-hidden /> : null);
const HELP_ID = 'help';

/** Chat (D-99, D-102): instant one-to-one, team, per-figure and Need help threads, with who is available. */
export default function Chat({ me, onRead }: { me: Me; onRead?: () => void }) {
  const [sp, setSp] = useSearchParams();
  const open = sp.get('t');
  const [tick, setTick] = useState(0);
  const threads = useLoad(() => rpc<Thread[]>('chat_threads'), [tick]);
  useEffect(() => {
    const t = window.setInterval(() => document.visibilityState === 'visible' && setTick((x) => x + 1), 60000);   // fallback; live events do the rest
    const off = onChat(() => setTick((x) => x + 1));
    return () => { window.clearInterval(t); off(); };
  }, []);
  const [picking, setPicking] = useState(false);
  const nav = useNavigate();
  const go = (id: string) => { setPicking(false); setSp({ t: id }); };
  const manager = me.manages_operations || me.manages_collections;
  const all = threads.data ?? [];
  const helpUnread = all.filter((t) => t.kind === 'help').reduce((a, t) => a + t.unread, 0);

  return (
    <div className="chat-wrap">
      <div className={`chat-list ${open ? 'hide-m' : ''}`}>
        <div className="topbar" style={{ marginBottom: 10 }}>
          <div><div className="h1row"><h1>Chat</h1><HelpTip k="Chat" /></div><div className="small muted">Ask about a figure, give a quick update — it stays with the numbers.</div></div>
        </div>
        <div className="row" style={{ marginBottom: 10 }}>
          <button className="btn primary sm" onClick={() => setPicking(!picking)} aria-expanded={picking}><Icon name="plus" size={16} /> New chat</button>
          {manager && <button className="btn sm" onClick={async () => go(await rpc<string>('chat_team'))}><Icon name="team" size={16} /> Team chat</button>}
        </div>
        {picking && <Contacts onPick={async (p) => go(await rpc<string>('chat_direct', { p_person: p }))} />}
        <ul className="threads" role="list" style={{ marginBottom: 6 }}>
          <li><button className={`thread pinned ${open === HELP_ID ? 'on' : ''}`} onClick={() => go(HELP_ID)} aria-current={open === HELP_ID ? 'true' : undefined}>
            <span className="avatar help" aria-hidden>?</span>
            <span className="tmain"><b className="ttitle">Need help</b><span className="small muted tlast">How to do anything in the app · operations, HR and finance questions</span></span>
            {helpUnread > 0 && <span className="badge" aria-label={`${helpUnread} unread`}>{helpUnread}</span>}
          </button></li>
        </ul>
        {threads.loading && !threads.data ? <Loading rows={4} /> : threads.error ? <ErrorBox error={threads.error} retry={threads.reload} /> : (
          all.length === 0 ? <div className="card"><Empty>No conversations yet. Start one with <b>New chat</b>, or tap <b>Ask</b> next to any figure on My day.</Empty></div> : (
            <ul className="threads" role="list">
              {all.map((t) => (
                <li key={t.id}><button className={`thread ${t.id === open ? 'on' : ''}`} onClick={() => go(t.id)} aria-current={t.id === open ? 'true' : undefined}>
                  <span className={`avatar ${t.kind}`} aria-hidden>{t.kind === 'team' ? <Icon name="team" size={18} /> : t.kind === 'topic' ? <Icon name="chart" size={18} /> : t.kind === 'help' ? '?' : initials(t.title)}<Dot a={t.availability} /></span>
                  <span className="tmain"><span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><b className="ttitle">{t.title ?? 'Conversation'}</b><span className="spacer" /><span className="small muted">{when(t.last_at)}</span></span>
                    <span className="small muted tlast">{t.kind === 'direct' && t.availability && t.unread === 0 && !t.last_body ? availText(t.availability)
                      : <>{refText(t.ref) && <span className="pill neutral" style={{ marginRight: 6 }}>{refText(t.ref)}</span>}{t.last_body ? `${t.last_sender}: ${t.last_body}` : 'No messages yet'}</>}</span></span>
                  {t.unread > 0 && <span className="badge" aria-label={`${t.unread} unread`}>{t.unread}</span>}
                </button></li>))}
            </ul>))}
      </div>
      <div className={`chat-pane ${open ? '' : 'hide-m'}`}>
        {open === HELP_ID ? <HelpChat me={me} onBack={() => nav('/chat')} onAsked={(id) => { setTick((x) => x + 1); go(id); }} threads={all.filter((t) => t.kind === 'help')} openThread={go} />
          : open ? <Conversation key={open} me={me} id={open} thread={all.find((t) => t.id === open)} onBack={() => nav('/chat')} onChange={() => { setTick((x) => x + 1); onRead?.(); }} />
          : <div className="chat-empty desktop-only"><Icon name="chat" size={40} /><p className="muted">Pick a conversation, or start a new one.</p></div>}
      </div>
    </div>
  );
}

function Contacts({ onPick, title = 'Who do you want to talk to?' }: { onPick: (id: string) => void; title?: string }) {
  const c = useLoad(() => rpc<Contact[]>('chat_contacts'), []);
  const [q, setQ] = useState('');
  const list = useMemo(() => (c.data ?? []).filter((x) => !q || x.full_name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b.availability?.online ?? false) - Number(a.availability?.online ?? false)), [c.data, q]);
  return (
    <div className="card" style={{ marginBottom: 10, padding: 12 }}>
      <label className="field">{title}<input autoFocus placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {c.loading ? <Loading rows={2} /> : c.error ? <ErrorBox error={c.error} /> : list.length === 0 ? <Empty>No one matches.</Empty> : (
        <ul className="threads" role="list" style={{ maxHeight: 300, overflowY: 'auto', marginTop: 8 }}>
          {list.slice(0, 60).map((p) => <li key={p.person_id}><button className="thread" onClick={() => onPick(p.person_id)}>
            <span className="avatar direct" aria-hidden>{initials(p.full_name)}<Dot a={p.availability} /></span>
            <span className="tmain"><b>{p.full_name}</b><span className="small muted">{[p.designation, availText(p.availability)].filter(Boolean).join(' · ')}</span></span></button></li>)}
        </ul>)}
      <p className="small muted" style={{ margin: '8px 0 0' }}>You can message your manager, your team, colleagues under the same manager, and HR.</p>
    </div>
  );
}

function Conversation({ me, id, thread, onBack, onChange }: { me: Me; id: string; thread?: Thread; onBack: () => void; onChange: () => void }) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const last = useRef(0);
  const members = useLoad(() => rpc<{ person_id: string; full_name: string; availability: Avail | null }[]>('chat_members_of', { p_thread: id }), [id]);

  async function load() {
    try {
      const m = (await rpc<Msg[]>('chat_messages', { p_thread: id })) ?? [];
      const sorted = [...m].sort((a, b) => a.id - b.id);
      setMsgs(sorted); setErr(null);
      const top = sorted.length ? sorted[sorted.length - 1].id : 0;
      if (top !== last.current) { last.current = top; await rpc('chat_read', { p_thread: id }).catch(() => null); onChange(); }
    } catch (e) { setErr(e); }
  }
  useEffect(() => {
    load();
    const off = onChat((m) => { if (m.thread_id === id) load(); });                                   // instant
    const t = window.setInterval(() => document.visibilityState === 'visible' && load(), 20000);      // fallback if the live link drops
    const m = window.setInterval(() => document.visibilityState === 'visible' && members.reload(), 60000);
    return () => { off(); window.clearInterval(t); window.clearInterval(m); };
  }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs?.length]);

  async function send(body: string, e?: FormEvent) {
    e?.preventDefault();
    const b = body.trim(); if (!b || busy) return;
    setBusy(true);
    // show it at once; the server copy replaces it
    setMsgs((m) => [...(m ?? []), { id: Number.MAX_SAFE_INTEGER, sender_id: me.person_id, sender: 'You', body: b, ref: null, created_at: new Date().toISOString(), mine: true }]);
    setText('');
    try { await rpc('chat_send', { p_thread: id, p_body: b }); await load(); } catch (x) { setErr(x); setText(b); await load(); } finally { setBusy(false); }
  }
  const others = (members.data ?? []).filter((m) => m.person_id !== me.person_id);
  const title = thread?.title ?? (others.length ? others.map((m) => m.full_name).join(', ') : 'Conversation');
  const sub = thread?.kind === 'direct' || others.length === 1 ? availText(others[0]?.availability ?? thread?.availability ?? null)
    : others.length ? `${others.filter((m) => m.availability?.online).length} of ${others.length} online` : '';
  let day = '';
  return (
    <div className="convo">
      <header className="convo-head">
        <button className="btn sm ghost mobile-only" onClick={onBack} aria-label="Back to conversations"><Icon name="back" size={18} /></button>
        <span className={`avatar ${thread?.kind ?? 'direct'}`} aria-hidden>{thread?.kind === 'team' ? <Icon name="team" size={18} /> : thread?.kind === 'help' ? '?' : initials(title)}<Dot a={others.length === 1 ? others[0].availability : null} /></span>
        <div style={{ minWidth: 0 }}><b className="ttitle" style={{ display: 'block' }}>{title}</b>
          <div className="small muted ttitle">{refText(thread?.ref) ? `${refText(thread?.ref)} · ` : ''}{sub}</div></div>
        {thread?.ref?.date && <><span className="spacer" /><Link className="btn sm" to={`/productivity?date=${thread.ref.date}`}>Open figures</Link></>}
      </header>
      {others.length > 1 && <div className="presence-strip">{others.map((m) => <span key={m.person_id} className="pchip" title={availText(m.availability)}><Dot a={m.availability} />{m.full_name.split(' ')[0]}</span>)}</div>}
      <div className="msgs" aria-live="polite">
        {msgs === null ? <Loading rows={3} /> : msgs.length === 0 ? <p className="muted small" style={{ textAlign: 'center', marginTop: 24 }}>Say hello — or tap a quick reply below.</p> :
          msgs.map((m) => {
            const d = new Date(m.created_at).toDateString(); const sep = d !== day; day = d;
            return (<div key={m.id}>
              {sep && <div className="daysep"><span>{new Date(m.created_at).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span></div>}
              <div className={`bubble ${m.mine ? 'mine' : ''}`}>
                {!m.mine && thread?.kind !== 'direct' && <div className="who small">{m.sender}</div>}
                <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.body}</div>
                <div className="meta">{m.id === Number.MAX_SAFE_INTEGER ? 'sending…' : new Date(m.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</div>
              </div></div>);
          })}
        <div ref={end} />
      </div>
      <ErrorBox error={err} />
      <div className="quick" role="group" aria-label="Quick replies">{QUICK.map((q) => <button key={q} className="chip" disabled={busy} onClick={() => send(q)}>{q}</button>)}</div>
      <form className="composer" onSubmit={(e) => send(text, e)}>
        <label className="sr" htmlFor="chat-input">Message</label>
        <textarea id="chat-input" rows={1} maxLength={2000} placeholder="Write a message" value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }} />
        <button className="btn primary send" disabled={busy || !text.trim()} aria-label="Send"><Icon name="send" size={18} /></button>
      </form>
    </div>
  );
}

type Turn = { who: 'me' | 'bot'; text: string; answers?: Faq[]; desk?: Desk | null; asked?: string; routed?: boolean };
const STORE = 'crux-help-chat';
const STARTERS = ['How do I send my daily update?', 'I made a mistake after sending', 'How do I apply for leave?', 'How do I complete my profile?', 'I am not getting notifications', 'How do I declare my salary?'];

/** Need help (D-102): app questions answered on the spot; operations / HR / finance / app-support questions go to the desk's people. */
function HelpChat({ me, onBack, onAsked, threads, openThread }: { me: Me; onBack: () => void; onAsked: (id: string) => void; threads: Thread[]; openThread: (id: string) => void }) {
  const desks = useLoad(() => rpc<DeskInfo[]>('help_desks'), []);
  const [turns, setTurns] = useState<Turn[]>(() => { try { return JSON.parse(sessionStorage.getItem(STORE) ?? '[]'); } catch { return []; } });
  const [text, setText] = useState('');
  const [ask, setAsk] = useState<{ desk: Desk; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [manage, setManage] = useState<Desk | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { try { sessionStorage.setItem(STORE, JSON.stringify(turns.slice(-30))); } catch { /* private mode */ } end.current?.scrollIntoView({ block: 'end' }); }, [turns]);
  const D = (k: Desk) => (desks.data ?? []).find((d) => d.key === k);

  function question(q: string) {
    const t = q.trim(); if (!t) return;
    const answers = findAnswers(t), desk = guessDesk(t);
    const people = forPeople(t) && desk;
    setTurns((x) => [...x, { who: 'me', text: t }, people
      ? { who: 'bot', text: `This looks like a question for ${D(desk)?.title ?? 'the team'} — tap it below to send it to them. You get the answer here in Chat.`, answers, desk, asked: t, routed: true }
      : answers.length
      ? { who: 'bot', text: answers[0].a, answers, desk: desk ?? null, asked: t }
      : { who: 'bot', text: desk ? `This looks like a question for ${D(desk)?.title ?? 'the team'}. I can send it to them now.` : 'I could not find an answer to that in the app guide. Choose who should answer it and I will send it to them.', desk, asked: t }]);
    setText('');
  }
  async function send() {
    if (!ask) return; setBusy(true); setErr(null);
    try { const id = await rpc<string>('help_ask', { p_desk: ask.desk, p_question: ask.text }); setAsk(null); onAsked(id); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const people = (k: Desk) => { const d = D(k); if (!d) return ''; if (!d.people.length) return 'Admin answers'; const on = d.people.filter((p) => p.availability?.online);
    return (on.length ? on : d.people).slice(0, 2).map((p) => `${p.full_name}${p.availability ? ` (${p.availability.online ? 'online' : p.availability.state === 'leave' ? 'on leave' : 'away'})` : ''}`).join(', '); };
  const mine = (desks.data ?? []).filter((d) => d.can_manage);

  return (
    <div className="convo">
      <header className="convo-head">
        <button className="btn sm ghost mobile-only" onClick={onBack} aria-label="Back to conversations"><Icon name="back" size={18} /></button>
        <span className="avatar help" aria-hidden>?</span>
        <div style={{ minWidth: 0 }}><b>Need help</b><div className="small muted">Answers about the app at once · questions for people go to the right desk</div></div>
        <span className="spacer" />{turns.length > 0 && <button className="btn sm ghost" onClick={() => setTurns([])}>Clear</button>}
      </header>
      <div className="msgs">
        <div className="bubble"><div className="who small">CRUX Help</div>Hello {me.full_name.split(' ')[0]}. Ask me how to do anything in the app. For operations, HR or finance questions I will pass you to the people who answer them.
          <div className="chips" style={{ marginTop: 8 }}>{STARTERS.map((s) => <button key={s} className="chip" onClick={() => question(s)}>{s}</button>)}</div></div>
        {threads.length > 0 && <div className="bubble"><div className="who small">Your questions to people</div>
          <div className="stack" style={{ marginTop: 4 }}>{threads.slice(0, 5).map((t) => <button key={t.id} className="linklike" onClick={() => openThread(t.id)}>{t.title}{t.unread ? ` · ${t.unread} new` : ''}</button>)}</div></div>}
        {turns.map((t, i) => t.who === 'me'
          ? <div key={i} className="bubble mine">{t.text}</div>
          : <div key={i} className="bubble"><div className="who small">CRUX Help</div><div style={{ whiteSpace: 'pre-wrap' }}>{t.text}</div>
              {!t.routed && t.answers?.[0]?.link && <Link className="btn sm" style={{ marginTop: 8 }} to={t.answers[0].link[0]}>{t.answers[0].link[1]}</Link>}
              {(t.answers?.length ?? 0) > (t.routed ? 0 : 1) && <div className="chips" style={{ marginTop: 8 }}><span className="small muted">{t.routed ? 'About using the app:' : 'Or did you mean:'}</span>{t.answers!.slice(t.routed ? 0 : 1).map((a) => <button key={a.q} className="chip" onClick={() => question(a.q)}>{a.q}</button>)}</div>}
              <div className="small muted" style={{ marginTop: 8 }}>{t.routed ? 'Send it to:' : t.answers?.length ? 'Not what you needed? Ask a person:' : 'Send it to:'}</div>
              <div className="chips" style={{ marginTop: 4 }}>{(['ops', 'hr', 'finance', 'app'] as Desk[]).map((k) => <button key={k} className={`chip${t.desk === k ? ' on' : ''}`} onClick={() => setAsk({ desk: k, text: t.asked ?? '' })}>{D(k)?.title ?? k}</button>)}</div>
            </div>)}
        {ask && <div className="card" style={{ padding: 12 }}>
          <label className="field">Your question for {D(ask.desk)?.title}<textarea rows={3} value={ask.text} onChange={(e) => setAsk({ ...ask, text: e.target.value })} /></label>
          <div className="small muted" style={{ margin: '6px 0' }}>Goes to: {people(ask.desk) || '…'}. You get the answer here in Chat.</div>
          <ErrorBox error={err} />
          <div className="row"><button className="btn primary sm" disabled={busy || !ask.text.trim()} onClick={send}>{busy ? 'Sending…' : 'Send question'}</button><button className="btn sm" onClick={() => setAsk(null)}>Cancel</button></div>
        </div>}
        {mine.length > 0 && <div className="card" style={{ padding: 12 }}>
          <b>Desks you look after</b><HelpTip text="Questions sent to these desks come to you. Add someone to answer on your behalf — for example when you are on leave — and remove them when you are back." />
          {mine.map((d) => <div key={d.key} style={{ marginTop: 8 }}>
            <div className="row"><b className="small">{d.title}</b><span className="small muted">{d.people.map((p) => `${p.full_name}${p.role === 'delegate' ? ' (on behalf)' : ''}`).join(', ') || 'nobody yet — Admin answers'}</span>
              <span className="spacer" /><button className="btn sm" onClick={() => setManage(manage === d.key ? null : d.key)}>{manage === d.key ? 'Close' : 'Change'}</button></div>
            {manage === d.key && <DeskPeople me={me} d={d} onDone={desks.reload} />}
          </div>)}
        </div>}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); question(text); }}>
        <label className="sr" htmlFor="help-input">Your question</label>
        <textarea id="help-input" rows={1} placeholder="Ask anything — e.g. how do I correct a sent figure?" value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); question(text); } }} />
        <button className="btn primary send" disabled={!text.trim()} aria-label="Ask"><Icon name="send" size={18} /></button>
      </form>
    </div>
  );
}

function DeskPeople({ me, d, onDone }: { me: Me; d: DeskInfo; onDone: () => void }) {
  const [err, setErr] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  const admin = me.roles.includes('admin');
  const set = (p: string, role: string, on: boolean) => rpc('help_set_person', { p_desk: d.key, p_person: p, p_role: role, p_on: on }).then(() => { setAdding(false); onDone(); }, setErr);
  return (
    <div className="stack" style={{ marginTop: 6 }}>
      {d.people.map((p) => <div key={p.person_id} className="row small"><Dot a={p.availability} /><span>{p.full_name} · {p.role === 'owner' ? 'owner' : 'answers on behalf'}</span><span className="muted">{availText(p.availability)}</span><span className="spacer" />
        {(admin || p.role === 'delegate') && p.person_id !== me.person_id && <button className="btn sm" onClick={() => set(p.person_id, p.role, false)}>Remove</button>}</div>)}
      <div className="row">{!adding && <button className="btn sm" onClick={() => setAdding(true)}>Add someone to answer on {admin ? 'this desk' : 'my behalf'}</button>}
        {!adding && admin && <span className="small muted">Admin can add owners from the list below too.</span>}</div>
      {adding && <>{admin && <div className="small muted">Tap a name to add them as {d.people.some((p) => p.role === 'owner') ? 'someone answering on behalf' : 'the desk owner'}.</div>}
        <Contacts title="Who should answer?" onPick={(p) => set(p, admin && !d.people.some((x) => x.role === 'owner') ? 'owner' : 'delegate', true)} /></>}
      <ErrorBox error={err} />
    </div>
  );
}

