import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
export const configured = Boolean(url && key);
export const sb = createClient(url || 'http://localhost', key || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export type Fn = 'operations' | 'collections';
export type Me = {
  person_id: string; full_name: string; designation: string | null; status: string; roles: string[];
  manages_operations: boolean; manages_collections: boolean; has_collections: boolean;
  today: string; tz: string; server_time: string;
};

/** Plain-language error text from Postgres / PostgREST errors. */
export function errText(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e);
  if (/permission denied|42501/i.test(m)) return 'You do not have permission to do that.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'No connection. Your changes are not saved yet — try again.';
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

export const has = (me: Me | null, ...roles: string[]) => !!me && roles.some((r) => me.roles.includes(r));
export const isLeader = (me: Me | null) => has(me, 'admin', 'ops_head', 'collections_head', 'zm', 'bm', 'ba', 'auditor');
