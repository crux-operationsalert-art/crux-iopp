// 11 Nov: departments as first-class, and hiding report pages per role (D-122).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, clock, expectError, freshDb } from './db';
import { A, P, seed } from './fixtures';

let db: PGlite;
beforeAll(async () => { db = await freshDb(); await seed(db); await clock(db, '2026-11-12T10:00:00+05:30'); });

describe('Departments (D-122)', () => {
  it('HR/Admin add a department, put a person in it, and the manager can then set KPIs there', async () => {
    await as(db, A.admin, `select department_add('  Business   Communication ')`);
    await expectError(as(db, A.admin, `select department_add('business communication')`), /already a department/);
    await expectError(as(db, A.bm1, `select department_add('Anything')`), /Only HR\/Admin/);
    await as(db, A.admin, `select person_set_department($1,'Business Communication')`, [P.e2]);
    const list = (await as(db, A.admin, `select departments_list() j`))[0].j;
    const d = list.find((x: any) => x.name === 'Business Communication');
    expect(d.people.map((p: any) => p.person_id)).toContain(P.e2);
    expect(d.kpis).toBe(0);
    // the reporting manager now sees that department for the person, with an empty library, and can add a KPI to it
    const s = (await as(db, A.bm1, `select scorecard_person($1) j`, [P.e2]))[0].j;
    expect(s.department).toBe('Business Communication');
    expect(s.departments).toContain('Business Communication');
    expect(s.library.length).toBe(0);
    const k = (await as(db, A.bm1, `select kpi_custom_add('Business Communication','client newsletters sent','count') j`))[0].j;
    expect(k.name).toBe('Client Newsletters Sent – Volume');
    // typing a brand-new department on a KPI also creates the department
    await as(db, A.admin, `select kpi_upsert(null,'Legal','contracts reviewed','count')`);
    expect((await db.query<any>(`select count(*)::int n from departments where name='Legal'`)).rows[0].n).toBe(1);
  });
});

describe('Hiding a report page from a role (D-122)', () => {
  it('blocks the page on the server and tells the app to drop it from the menu', async () => {
    const hidden = async (who: string) => (await as(db, who, `select (whoami()->'hidden_pages') j`))[0].j;
    expect(await hidden(A.bm1)).toEqual([]);
    await as(db, A.admin, `select access_set('page:status','bm','self')`);
    expect(await hidden(A.bm1)).toEqual(['status']);
    await expectError(as(db, A.bm1, `select zonal_tracker('2026-11-12')`), /turned off for your role/);
    expect(await hidden(A.zm1)).toEqual([]);                       // other roles keep it
    await as(db, A.zm1, `select zonal_tracker('2026-11-12')`);
    await as(db, A.admin, `select zonal_tracker('2026-11-12')`);   // Admin is never blocked
    await as(db, A.admin, `select access_set('page:status','bm','all')`);
    await as(db, A.bm1, `select zonal_tracker('2026-11-12')`);
    await expectError(as(db, A.admin, `select access_set('page:status','bm','team')`), /Unknown level/);
    await expectError(as(db, A.admin, `select access_set('page:status','admin','self')`), /fixed/);
  });
});
