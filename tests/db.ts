// Test harness: PGlite (Postgres 17 in-process) + a minimal Supabase auth stub + all migrations.
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIG = join(__dirname, '..', 'supabase', 'migrations');

export const SUPABASE_STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid, status text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
`;

export async function freshDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { btree_gist, pgcrypto } });
  await db.exec(SUPABASE_STUB);
  for (const f of readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await db.exec(readFileSync(join(MIG, f), 'utf8'));
    } catch (e) {
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
    }
  }
  return db;
}

/** Run a query as a signed-in user (RLS applies). */
export async function as<T = any>(db: PGlite, uid: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [uid ? JSON.stringify({ sub: uid }) : '']);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

/** Set the business clock (only honoured because tests enable allow_fake_clock). */
export async function clock(db: PGlite, iso: string) {
  await db.query(`select set_config('app.fake_now', $1, false)`, [iso]);
}

export async function expectError(p: Promise<unknown>, match: RegExp) {
  try {
    await p;
  } catch (e) {
    const msg = (e as Error).message;
    if (!match.test(msg)) throw new Error(`Expected error ${match} but got: ${msg}`);
    return msg;
  }
  throw new Error(`Expected error ${match} but the call succeeded`);
}
