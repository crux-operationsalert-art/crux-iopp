// 12 Nov: data access audit (D-136) — own and team only; no company-wide data for an individual contributor.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, clock, freshDb } from './db';
import { A, P, seed } from './fixtures';

let db: PGlite;
const n = async (who: string | null, sql: string, params: unknown[] = []) => Number((await as(db, who, sql, params))[0].n);
beforeAll(async () => { db = await freshDb(); await seed(db); await clock(db, '2026-11-12T10:00:00+05:30'); });

describe('Own and team only (D-136)', () => {
  it('an individual contributor gets no branch-level business data; a manager still does', async () => {
    expect((await as(db, A.e1, `select app.is_individual() i`))[0].i).toBe(true);
    expect((await as(db, A.bm1, `select app.is_individual() i`))[0].i).toBe(false);
    expect(await n(A.e1, `select count(*) n from app.visible_branches('2026-11-12')`)).toBe(0);
    expect(await n(A.bm1, `select count(*) n from app.visible_branches('2026-11-12')`)).toBeGreaterThan(0);
    const d = (await as(db, A.e1, `select perf_dashboard('2026-11-01') j`))[0].j;
    for (const k of ['by_client', 'by_person', 'by_location', 'by_stakeholder', 'daily', 'series']) expect(d[k] ?? []).toEqual([]);
    expect(d.team.people.length).toBe(1);                       // their own target and actual remain
    expect(await n(A.e1, `select count(*) n from tracker_monthly`)).toBe(0);
    expect(await n(A.e1, `select count(*) n from target_allocations where level <> 'person'`)).toBe(0);
  });

  it('the Home dashboard is not switched off or re-scoped by the Targets page setting', async () => {
    await as(db, A.admin, `select page_set('page:targets','bm','hidden')`);
    const d = (await as(db, A.bm1, `select perf_dashboard('2026-11-01') j`))[0].j;
    expect(d.team.people.length).toBeGreaterThan(1);
    await as(db, A.admin, `select page_set('page:targets','bm','full')`);
  });

  it('clients and services: only those the person or their team works', async () => {
    const all = Number((await db.query<any>(`select count(*) n from clients`)).rows[0].n), cls = Number((await db.query<any>(`select count(*) n from client_locations`)).rows[0].n);
    const mine = Number((await db.query<any>(`select count(distinct client_location_id) n from allocations where person_id=$1 and valid @> date '2026-11-12'`, [P.e1])).rows[0].n);
    expect(await n(A.e1, `select count(*) n from client_locations`)).toBe(mine);
    expect(await n(A.e1, `select count(*) n from clients`)).toBeLessThanOrEqual(mine);
    expect(await n(A.admin, `select count(*) n from clients`)).toBe(all);
    expect(await n(A.oh, `select count(*) n from client_locations`)).toBe(cls);
    expect(await n(A.e1, `select count(*) n from settings`)).toBe(0);
    expect(await n(A.e1, `select count(*) n from product_heads`)).toBe(0);
  });

  it('a colleague at the same location cannot read another person’s daily lines', async () => {
    await db.query(`select set_config('app.reason','test',false)`);
    const cl = (await db.query<any>(`select client_location_id id from allocations where person_id=$1 and valid @> date '2026-11-12' limit 1`, [P.e2])).rows[0]?.id;
    if (cl) expect((await as(db, A.e1, `select app.shares_location($1, '2026-11-12') s`, [cl]))[0].s).toBe(false);
    expect(await n(A.e1, `select count(*) n from productivity_lines where person_id <> $1`, [P.e1])).toBe(0);
  });

  it('nothing is callable without signing in', async () => {
    expect(Number((await db.query<any>(`select count(*) n from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
      and p.proname in ('letter_get','payslip','access_card','my_tasks','team_scores','letterhead','kpi_catalogue','designation_options')`)).rows[0].n)).toBe(0);
  });
});
