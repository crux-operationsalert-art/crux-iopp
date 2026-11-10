import { rpc, sb } from './api';

/** Live chat (D-102): new messages arrive over Supabase Realtime (members only, by row security) and are passed to the
 *  screens as a window event; a heartbeat marks the person online while the app is open and in front. */
export type ChatEvent = { id: number; thread_id: string; sender_id: string; body: string; created_at: string };
export const CHAT_EVENT = 'crux-chat';

let started = false;
export function startLive() {
  if (started) return () => undefined;
  started = true;
  const ch = sb.channel('chat-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (p: any) => {
      window.dispatchEvent(new CustomEvent<ChatEvent>(CHAT_EVENT, { detail: p.new as ChatEvent }));
    })
    .subscribe();
  const ping = () => { if (document.visibilityState === 'visible') rpc('chat_ping').catch(() => null); };
  ping();
  const t = window.setInterval(ping, 45000);
  document.addEventListener('visibilitychange', ping);
  return () => { started = false; window.clearInterval(t); document.removeEventListener('visibilitychange', ping); sb.removeChannel(ch); };
}

export function onChat(fn: (e: ChatEvent) => void) {
  const h = (e: Event) => fn((e as CustomEvent<ChatEvent>).detail);
  window.addEventListener(CHAT_EVENT, h);
  return () => window.removeEventListener(CHAT_EVENT, h);
}
