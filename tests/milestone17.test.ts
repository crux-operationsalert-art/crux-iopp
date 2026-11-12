// 11 Nov: approved designations with seniority, and department when adding a person (D-123).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, clock, expectError, freshDb } from './db';
import { A, P, seed } from './fixtures';

let db: PGlite;
const add = (who: string, name: string, mob: string, desig: string, mgr: string, dept: string | null = null) =>
  as(db, who, `select (add_team_member($1, null, $2, 'own_employee', $3, 'executive', $4, 'operations', null, null, null, $5)).department d`, [name, mob, desig, mgr, dept]);
beforeAll(async () => {
  db = await freshDb(); await seed(db); await clock(db, '2026-11-12T10:00:00+05:30');
  await db.query(`update persons set designation='Branch Manager' where id=$1`, [P.bm1]);
  await db.query(`update persons set designation='Zonal Manager' where id=$1`, [P.zm1]);
});

describe('Designations & department on add-person (D-123)', () => {
  it('ranks free-text titles by the approved name they contain', async () => {
    const r = async (t: string) => (await db.query<any>(`select app.designation_rank($1) r`, [t])).rows[0].r;
    expect(await r('AVP - Business Intelligence and Growth')).toBe(7);
    expect(await r('Vice President - HR')).toBe(6);
    expect(await r('Assistant Branch Manager')).toBe(14);
    expect(await r('National Head, Risk Operations')).toBe(6);
    expect(await r('Execative')).toBe(17);
  });

  it('Admin adds an AVP straight into a new department', async () => {
    await as(db, A.admin, `select department_add('Business Communication')`);
    const d = (await add(A.admin, 'SYNTH Avp', '7700000111', 'Associate Vice President', P.admin, 'Business Communication'))[0].d;
    expect(d).toBe('Business Communication');
  });

  it('a manager can only add approved designations below their own, in their own department', async () => {
    const o = (await as(db, A.bm1, `select designation_options() j`))[0].j;
    expect(o.admin).toBe(false);
    expect(o.departments).toEqual(['Operations']);
    const names = o.designations.map((x: any) => x.name);
    expect(names).toContain('Executive'); expect(names).toContain('Assistant Manager');
    expect(names).not.toContain('Branch Manager'); expect(names).not.toContain('Zonal Manager'); expect(names).not.toContain('Associate Vice President');

    await expectError(add(A.bm1, 'SYNTH X', '7700000112', 'Chief Fun Officer', P.bm1), /approved list/);
    await expectError(add(A.bm1, 'SYNTH X', '7700000112', 'Zonal Manager', P.bm1), /below your own/);
    await expectError(add(A.bm1, 'SYNTH X', '7700000112', 'Branch Manager', P.bm1), /below your own/);
    // goes into the manager's own department even if they ask for another
    const d = (await add(A.bm1, 'SYNTH Y', '7700000113', 'Senior Executive', P.bm1, 'Business Communication'))[0].d;
    expect(d).toBe('Operations');
  });

  it('cannot place someone at or above the person they report to', async () => {
    // zm1 adds under bm1 (Branch Manager, rank 12): an Assistant Manager is fine, a Team Manager (same level) is not
    await expectError(add(A.zm1, 'SYNTH Z', '7700000114', 'Team Manager', P.bm1), /not below the person they will report to/);
    await add(A.zm1, 'SYNTH Z', '7700000114', 'Assistant Manager', P.bm1);
  });

  it('AVP is Assistant Vice President; designations carry their departments (D-135)', async () => {
    const o = (await as(db, A.admin, `select designation_options() j`))[0].j;
    const by = (n: string) => o.designations.find((x: any) => x.name === n);
    expect(by('Assistant Vice President').rank).toBe(7); expect(by('Associate Vice President')).toBeUndefined();
    expect((await db.query<any>(`select app.designation_rank('AVP - Business Intelligence') r`)).rows[0].r).toBe(7);
    expect(by('HR Executive').departments).toEqual(['Human Resources']); expect(by('Branch Manager').departments).toEqual(['Operations']);
    expect(by('Manager').departments).toEqual([]);                                  // common to every department
    // a Branch Manager (Operations) is offered Operations and common designations only
    const names = (await as(db, A.bm1, `select designation_options() j`))[0].j.designations.map((x: any) => x.name);
    expect(names).toContain('Field Executive'); expect(names).toContain('Executive'); expect(names).not.toContain('HR Executive'); expect(names).not.toContain('Accountant');
    await expectError(add(A.bm1, 'SYNTH Q', '7700000120', 'HR Executive', P.bm1), /another department/);
    await expectError(as(db, A.bm1, `select designation_map_set('HR Executive','Operations',true)`), /Only HR\/Admin/);
    await as(db, A.hr, `select designation_map_set('HR Executive','Operations',true)`);
    expect((await as(db, A.bm1, `select designation_options() j`))[0].j.designations.map((x: any) => x.name)).toContain('HR Executive');
    await as(db, A.hr, `select designation_map_set('HR Executive','Operations',false)`);
  });

  it('an Assistant Branch Manager added under a Branch Manager becomes that manager’s assistant (D-135)', async () => {
    await add(A.zm1, 'SYNTH Abm', '7700000121', 'Assistant Branch Manager', P.bm1);
    const abm = (await db.query<any>(`select id from persons where full_name='SYNTH Abm'`)).rows[0].id;
    expect((await db.query<any>(`select principal from ea_assignments where ea_person=$1`, [abm])).rows.map((r: any) => r.principal)).toEqual([P.bm1]);
    await add(A.bm1, 'SYNTH Plain', '7700000122', 'Senior Executive', P.bm1);
    expect((await db.query<any>(`select count(*)::int n from ea_assignments where ea_person=(select id from persons where full_name='SYNTH Plain')`)).rows[0].n).toBe(0);
  });

  it('only HR/Admin add a designation, placed level with an existing one', async () => {
    await expectError(as(db, A.bm1, `select designation_add('Lead Analyst','Team Leader')`), /Only HR\/Admin/);
    const r = (await as(db, A.admin, `select designation_add('Lead Analyst','Team Leader') j`))[0].j;
    expect(r.rank).toBe(15);
    await expectError(as(db, A.admin, `select designation_add('lead analyst','Team Leader')`), /already exists/);
    expect((await as(db, A.bm1, `select designation_options() j`))[0].j.designations.map((x: any) => x.name)).toContain('Lead Analyst');
  });
});
