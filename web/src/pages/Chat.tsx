import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Me, rpc } from '../lib/api';
import { nice } from '../lib/format';
import { Icon } from '../components/Icon';
import { Empty, ErrorBox, Loading, useLoad } from '../components/ui';

type Thread = { id: string; kind: 'direct' | 'team' | 'topic'; title: string | null; ref: any; members: number; last_body: string | null; last_sender: string | null; last_at: string; unread: number };
type Msg = { id: number; sender_id: string; sender: string; body: string; ref: any; created_at: string; mine: boolean };
type Contact = { person_id: string; full_name: string; designation: string | null; relation: string };

const QUICK = ['Noted, thanks', 'Checking — will update in 10 min', 'Figures corrected', 'Please recheck the pending by age', 'Call me when free'];
const when = (s: string) => {
  const d = new Date(s), now = new Date();
  const same = d.toDateString() === now.toDateString();
  return same ? d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const initials = (n: string | null) => (n ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
export const refText = (r: any) => (r?.client ? `${r.client}${r.location ? ' · ' + r.location : ''}${r.date ? ' · ' + nice(r.date) : ''}` : null);

/** Chat (D-99): one-to-one, team and per-figure threads, so questions about numbers stay next to the numbers instead of in WhatsApp. */
export default function Chat({ me, onRead }: { me: Me; onRead?: () => void }) {
  const [sp, setSp] = useSearchParams();
  const open = sp.get('t');
  const [tick, setTick] = useState(0);
  const threads = useLoad(() => rpc<Thread[]>('chat_threads'), [tick]);
  useEffect(() => { const t = window.setInterval(() => document.visibilityState === 'visible' && setTick((x) => x + 1), 30000); return () => window.clearInterval(t); }, []);
  const [picking, setPicking] = useState(false);
  const nav = useNavigate();
  const go = (id: string) => { setPicking(false); setSp({ t: id }); };
  const manager = me.manages_operations || me.manages_collections;

  return (
    <div className="chat-wrap">
      <div className={`chat-list ${open ? 'hide-m' : ''}`}>
        <div className="topbar" style={{ marginBottom: 10 }}>
          <div><h1>Chat</h1><div className="small muted">Ask about a figure, give a quick update — it stays with the numbers.</div></div>
        </div>
        <div className="row" style={{ marginBottom: 10 }}>
          <button className="btn primary sm" onClick={() => setPicking(!picking)} aria-expanded={picking}><Icon name="plus" size={16} /> New chat</button>
          {manager && <button className="btn sm" onClick={async () => go(await rpc<string>('chat_team'))}><Icon name="team" size={16} /> Team chat</button>}
        </div>
        {picking && <Contacts onPick={async (p) => go(await rpc<string>('chat_direct', { p_person: p }))} />}
        {threads.loading && !threads.data ? <Loading rows={4} /> : threads.error ? <ErrorBox error={threads.error} retry={threads.reload} /> : (
          (threads.data ?? []).length === 0 ? <div className="card"><Empty>No conversations yet. Start one with <b>New chat</b>, or tap <b>Ask</b> next to any figure on My day.</Empty></div> : (
            <ul className="threads" role="list">
              {(threads.data ?? []).map((t) => (
                <li key={t.id}><button className={`thread ${t.id === open ? 'on' : ''}`} onClick={() => go(t.id)} aria-current={t.id === open ? 'true' : undefined}>
                  <span className={`avatar ${t.kind}`} aria-hidden>{t.kind === 'team' ? <Icon name="team" size={18} /> : t.kind === 'topic' ? <Icon name="chart" size={18} /> : initials(t.title)}</span>
                  <span className="tmain"><span className="row" style={{ gap: 6 }}><b className="ttitle">{t.title ?? 'Conversation'}</b><span className="spacer" /><span className="small muted">{when(t.last_at)}</span></span>
                    <span className="small muted tlast">{refText(t.ref) && <span className="pill neutral" style={{ marginRight: 6 }}>{refText(t.ref)}</span>}{t.last_body ? `${t.last_sender}: ${t.last_body}` : 'No messages yet'}</span></span>
                  {t.unread > 0 && <span className="badge" aria-label={`${t.unread} unread`}>{t.unread}</span>}
                </button></li>))}
            </ul>))}
      </div>
      <div className={`chat-pane ${open ? '' : 'hide-m'}`}>
        {open ? <Conversation key={open} id={open} thread={(threads.data ?? []).find((t) => t.id === open)} onBack={() => nav('/chat')} onChange={() => { setTick((x) => x + 1); onRead?.(); }} />
          : <div className="chat-empty desktop-only"><Icon name="chat" size={40} /><p className="muted">Pick a conversation, or start a new one.</p></div>}
      </div>
    </div>
  );
}

function Contacts({ onPick }: { onPick: (id: string) => void }) {
  const c = useLoad(() => rpc<Contact[]>('chat_contacts'), []);
  const [q, setQ] = useState('');
  const list = useMemo(() => (c.data ?? []).filter((x) => !q || x.full_name.toLowerCase().includes(q.toLowerCase())), [c.data, q]);
  return (
    <div className="card" style={{ marginBottom: 10, padding: 12 }}>
      <label className="field">Who do you want to talk to?<input autoFocus placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {c.loading ? <Loading rows={2} /> : c.error ? <ErrorBox error={c.error} /> : list.length === 0 ? <Empty>No one matches.</Empty> : (
        <ul className="threads" role="list" style={{ maxHeight: 280, overflowY: 'auto', marginTop: 8 }}>
          {list.slice(0, 50).map((p) => <li key={p.person_id}><button className="thread" onClick={() => onPick(p.person_id)}>
            <span className="avatar direct" aria-hidden>{initials(p.full_name)}</span>
            <span className="tmain"><b>{p.full_name}</b><span className="small muted">{[p.designation, p.relation].filter(Boolean).join(' · ')}</span></span></button></li>)}
        </ul>)}
      <p className="small muted" style={{ margin: '8px 0 0' }}>You can message your manager, your team, colleagues under the same manager, and HR.</p>
    </div>
  );
}

function Conversation({ id, thread, onBack, onChange }: { id: string; thread?: Thread; onBack: () => void; onChange: () => void }) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const last = useRef(0);
  const members = useLoad(() => rpc<{ person_id: string; full_name: string }[]>('chat_members_of', { p_thread: id }), [id]);

  async function load() {
    try {
      const m = (await rpc<Msg[]>('chat_messages', { p_thread: id })) ?? [];
      const sorted = [...m].sort((a, b) => a.id - b.id);
      setMsgs(sorted); setErr(null);
      const top = sorted.length ? sorted[sorted.length - 1].id : 0;
      if (top !== last.current) { last.current = top; await rpc('chat_read', { p_thread: id }).catch(() => null); onChange(); }
    } catch (e) { setErr(e); }
  }
  useEffect(() => { load(); const t = window.setInterval(() => document.visibilityState === 'visible' && load(), 5000); return () => window.clearInterval(t); }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs?.length]);

  async function send(body: string, e?: FormEvent) {
    e?.preventDefault();
    const b = body.trim(); if (!b || busy) return;
    setBusy(true);
    try { await rpc('chat_send', { p_thread: id, p_body: b }); setText(''); await load(); } catch (x) { setErr(x); } finally { setBusy(false); }
  }
  const title = thread?.title ?? (members.data ? members.data.map((m) => m.full_name).join(', ') : 'Conversation');
  let day = '';
  return (
    <div className="convo">
      <header className="convo-head">
        <button className="btn sm ghost mobile-only" onClick={onBack} aria-label="Back to conversations"><Icon name="back" size={18} /></button>
        <div style={{ minWidth: 0 }}><b className="ttitle">{title}</b>
          <div className="small muted">{refText(thread?.ref) ?? (members.data ? `${members.data.length} people` : '')}</div></div>
        {thread?.ref?.date && <><span className="spacer" /><Link className="btn sm" to={`/productivity?date=${thread.ref.date}`}>Open figures</Link></>}
      </header>
      <div className="msgs" aria-live="polite">
        {msgs === null ? <Loading rows={3} /> : msgs.length === 0 ? <p className="muted small" style={{ textAlign: 'center', marginTop: 24 }}>Say hello — or tap a quick reply below.</p> :
          msgs.map((m) => {
            const d = new Date(m.created_at).toDateString(); const sep = d !== day; day = d;
            return (<div key={m.id}>
              {sep && <div className="daysep"><span>{new Date(m.created_at).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span></div>}
              <div className={`bubble ${m.mine ? 'mine' : ''}`}>
                {!m.mine && thread?.kind !== 'direct' && <div className="who small">{m.sender}</div>}
                <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.body}</div>
                <div className="meta">{new Date(m.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</div>
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
