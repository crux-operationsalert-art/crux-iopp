import { createClient } from '@supabase/supabase-js';
import { record } from './netcheck';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
export const configured = Boolean(url && key);
/** Requests in flight (the version check never reloads the page while one is running). */
export const net = { inflight: 0 };
const READ_RPC = /\/rpc\/(whoami|my_|team_|perf_|tracker_|collections_|product_|police_status|hr_repository|assignable_people|target_|zonal_|day_report|attendance_|leave_taken|extra_work_report|revenue_status|ar_carry|sync_tasks|team_breakdown)/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** fetch that counts requests in flight and retries reads twice when the phone's connection drops for a moment. */
export async function robustFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const u = String(input instanceof Request ? input.url : input);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const retryable = method === 'GET' || READ_RPC.test(u) || /\/auth\/v1\/(user|token\?grant_type=refresh_token)/.test(u);
  net.inflight++;
  try {
    for (let i = 0; ; i++) {
      try { return await fetch(input, init); }
      catch (e) { if (!retryable || i >= 2) { record('fetch_failed', { path: u.replace(/^https?:\/\/[^/]+/, '').split('?')[0], method, tries: i + 1, error: String((e as Error)?.message ?? e).slice(0, 80) }); throw e; }
        await sleep(800 * (i + 1)); }
    }
  } finally { net.inflight--; }
}
export const isNetworkError = (e: unknown) => /Failed to fetch|NetworkError|Load failed|network connection was lost|fetch failed/i.test((e as Error)?.message ?? String(e));

export const sb = createClient(url || 'http://localhost', key || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  global: { fetch: robustFetch },
});

export type Fn = 'operations' | 'collections';
export type Me = {
  person_id: string; full_name: string; designation: string | null; status: string; roles: string[];
  manages_operations: boolean; manages_collections: boolean; has_collections: boolean;
  today: string; tz: string; server_time: string;
  mobile?: string | null; resource_type?: string; heads_locations?: boolean;
  agreement_version: string; agreement_ok: boolean; profile_missing: string[];
  profile?: { pct: number; done: number; total: number; missing: string[]; due_at: string; blocking: boolean };
  company?: { name: string; place: string; website: string; address: string };
  leadership?: boolean; ops_blind?: boolean;
  products?: string[]; ea_for?: string[]; hr?: boolean; reports_figures?: boolean; has_kpis?: boolean; hidden_pages?: string[];
};

/** Plain-language error text from Postgres / PostgREST errors. */
export function errText(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e);
  if (/permission denied|42501/i.test(m)) return 'You do not have permission to do that.';
  if (/persons_designation_required/.test(m)) return 'Designation is required.';
  if (/more than one relationship/i.test(m)) return 'This screen could not load its data (a technical link is ambiguous). Please tell Admin.';
  if (isNetworkError(m)) return 'Could not reach the server (the connection dropped). Check your internet and try again.';
  if (/JWT|session/i.test(m)) return 'Your session has expired. Please sign in again.';
  return m.replace(/^.*?ERROR:\s*/, '');
}

export async function rpc<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export async function select<T = any>(table: string, cols = '*', q?: (b: any) => any): Promise<T[]> {
  let b: any = sb.from(table).select(cols);
  if (q) b = q(b);
  const { data, error } = await b;
  if (error) throw new Error(error.message);
  return data as T[];
}

/** Calls the iopp-auth Edge Function with the signed-in user's token. */
export async function authFn<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data } = await sb.auth.getSession();
  const r = await robustFetch(`${url}/functions/v1/iopp-auth`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${data.session?.access_token ?? ''}` },
    body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? 'Request failed');
  return j as T;
}

export const has = (me: Me | null, ...roles: string[]) => !!me && roles.some((r) => me.roles.includes(r));
export const isLeader = (me: Me | null) => has(me, 'admin', 'ops_head', 'collections_head', 'zm', 'bm', 'ba', 'auditor', 'leadership');
/** Enters daily figures (anyone except leadership-only and collections-only people who head no location). */
export const entersFigures = (me: Me) => me.reports_figures !== false && !(me.roles.length > 0 && me.roles.every((r) => r === 'ea')) && !(me.leadership && !has(me, 'admin', 'ops_head', 'zm', 'bm', 'ba', 'executive', 'manager')) && !(me.ops_blind && !me.heads_locations);
