// 11 Nov: cross-department KPI engine (D-118).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, clock, expectError, freshDb } from './db';
import { A, P, seed } from './fixtures';

let db: PGlite;
let kpi: string;
beforeAll(async () => { db = await freshDb(); await seed(db); await clock(db, '2026-11-12T10:00:00+05:30'); });

describe('Cross-department KPI engine (D-118)', () => {
  it('HR/Admin define and assign; the person enters plan/actual', async () => {
    kpi = (await as(db, A.admin, `select kpi_define('Finance','Invoices processed','invoices','daily',true) id`))[0].id;
    expect(kpi).toBeTruthy();
    // a non-admin cannot define
    await expectError(as(db, A.e1, `select kpi_define('Finance','x',null,'daily',true)`), /Only HR\/Admin/);

    await as(db, A.admin, `select kpi_assign($1,$2,50)`, [P.e1, kpi]);
    // the person sees it with target
    const mine = (await as(db, A.e1, `select my_kpis(null) j`))[0].j;
    expect(mine.length).toBe(1);
    expect(mine[0].name).toBe('Invoices processed');
    expect(Number(mine[0].target)).toBe(50);

    // and enters plan/actual -> commitment
    await as(db, A.e1, `select save_kpi_entry($1, null, 50, 42, 'cleared the queue')`, [kpi]);
    const after = (await as(db, A.e1, `select my_kpis(null) j`))[0].j;
    expect(Number(after[0].actual)).toBe(42);
    expect(Number(after[0].commitment)).toBe(84);
  });

  it('refuses entry on a KPI you are not assigned', async () => {
    await expectError(as(db, A.e3, `select save_kpi_entry($1, null, 1, 1, null)`, [kpi]), /not assigned to you/);
  });

  it('rolls up a department for a manager, scoped to their reports', async () => {
    const roll = (await as(db, A.admin, `select kpi_rollup('Finance') j`))[0].j;
    expect(roll.length).toBe(1);
    expect(roll[0].rows.length).toBe(1);
    expect(Number(roll[0].rows[0].actual)).toBe(42);
    // an executive with no reports cannot roll up
    await expectError(as(db, A.e3, `select kpi_rollup('Finance')`), /Not permitted/);
  });

  it('whoami flags that the person now has KPIs', async () => {
    expect((await as(db, A.e1, `select (whoami()->>'has_kpis') h`))[0].h).toBe('true');
    expect((await as(db, A.e4, `select (whoami()->>'has_kpis') h`))[0].h).toBe('false');
  });

  it('feeds the monthly score: KPI achievement counts toward person_achievement (D-119)', async () => {
    // daily KPI, target 50/day. Assigned on the real current date; by the fake clock at least one working day has elapsed.
    const items = (await db.query<any>(`select x from app.kpi_achievements($1, app.today()) x`, [P.e1])).rows;
    expect(items.length).toBe(1);
    const days = (await db.query<any>(`select app.working_days_between(greatest(date_trunc('month', app.today())::date, (select lower(valid) from kpi_assignment where person_id=$1)), app.today())::int d`, [P.e1])).rows[0].d;
    expect(Number(items[0].x)).toBe(Math.min(200, Math.round(42 / (50 * days) * 1000) / 10));
    // e1 has no operations target here, so the score's achievement IS the KPI achievement
    const ach = (await db.query<any>(`select app.person_achievement($1, app.today()) a`, [P.e1])).rows[0].a;
    expect(Number(ach)).toBe(Number(items[0].x));
  });

  it('lower-is-better KPIs score target over average actual', async () => {
    const k2 = (await as(db, A.admin, `select kpi_define('Finance','Ageing days','days','monthly',false) id`))[0].id;
    await as(db, A.admin, `select kpi_assign($1,$2,10)`, [P.e2, k2]);
    expect((await db.query<any>(`select count(*)::int c from app.kpi_achievements($1, app.today())`, [P.e2])).rows[0].c).toBe(0);   // nothing entered yet
    await as(db, A.e2, `select save_kpi_entry($1, null, 10, 20, null)`, [k2]);
    expect(Number((await db.query<any>(`select x from app.kpi_achievements($1, app.today()) x`, [P.e2])).rows[0].x)).toBe(50);     // 10 / 20
  });

  it('gives a manager their team roll-up, and nobody else sees those people', async () => {
    const bm = (await as(db, A.bm1, `select kpi_team(null) j`))[0].j;
    const names = bm.flatMap((k: any) => k.rows.map((r: any) => r.person_id));
    expect(names).toContain(P.e1); expect(names).toContain(P.e2);
    const e3 = (await as(db, A.e3, `select kpi_team(null) j`))[0].j;
    expect(e3.length).toBe(0);
  });
});
