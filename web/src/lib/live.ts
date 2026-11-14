import { rpc, sb, TRAINING } from './api';

/** Live chat (D-102): new messages arrive over Supabase Realtime (members only, by row security) and are passed to the
 *  screens as a window event; a heartbeat marks the person online while the app is open and in front. */
export type ChatEvent = { id: number; thread_id: string; sender_id: string; body: string; created_at: string };
export const CHAT_EVENT = 'crux-chat';

let started = false;
export function startLive() {
  if (started) return () => undefined;
  started = true;
  // training runs without a server, so there is no live channel; the chat refreshes on its own timer
  const ch = TRAINING ? null : sb.channel('chat-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (p: any) => {
      window.dispatchEvent(new CustomEvent<ChatEvent>(CHAT_EVENT, { detail: p.new as ChatEvent }));
    })
    .subscribe();
  const ping = () => { if (document.visibilityState === 'visible') rpc('chat_ping').catch(() => null); };
  ping();
  const t = window.setInterval(ping, 45000);
  document.addEventListener('visibilitychange', ping);
  // in-app engagement: accumulate the time the app is open and in front, flush to the server (D-105, in-app only)
  let visibleSince = document.visibilityState === 'visible' ? Date.now() : 0;
  let acc = 0;
  const take = () => { if (visibleSince) { acc += Math.round((Date.now() - visibleSince) / 1000); visibleSince = Date.now(); } };
  const flush = () => { take(); if (acc >= 20) { const s = Math.min(acc, 900); acc -= s; rpc('record_activity', { p_seconds: s }).catch(() => null); } };
  const onVis = () => { if (document.visibilityState === 'visible') visibleSince = Date.now(); else { take(); visibleSince = 0; flush(); } };
  document.addEventListener('visibilitychange', onVis);
  const at = window.setInterval(flush, 30000);
  window.addEventListener('pagehide', flush);
  return () => { started = false; window.clearInterval(t); window.clearInterval(at); document.removeEventListener('visibilitychange', ping);
    document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pagehide', flush); flush(); if (ch) sb.removeChannel(ch); };
}

export function onChat(fn: (e: ChatEvent) => void) {
  const h = (e: Event) => fn((e as CustomEvent<ChatEvent>).detail);
  window.addEventListener(CHAT_EVENT, h);
  return () => window.removeEventListener(CHAT_EVENT, h);
}
