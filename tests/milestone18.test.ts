// 11 Nov: the complete menu card — every menu entry and Admin section can be hidden per role (D-124).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, clock, expectError, freshDb } from './db';
import { A, P, seed } from './fixtures';

let db: PGlite;
const hidden = async (who: string) => (await as(db, who, `select (whoami()->'hidden_pages') j`))[0].j as string[];
const set = (page: string, role: string, level: string) => as(db, A.admin, `select access_set($1,$2,$3)`, ['page:' + page, role, level]);
beforeAll(async () => { db = await freshDb(); await seed(db); await clock(db, '2026-11-12T10:00:00+05:30'); });

describe('Complete menu card (D-124)', () => {
  it('lists every page by section and hides nothing to start with', async () => {
    const c = (await as(db, A.admin, `select access_card() j`))[0].j;
    expect(c.pages.length).toBe(24);
    expect([...new Set(c.pages.map((p: any) => p.section))]).toEqual(['My work', 'Team', 'Reports', 'Admin']);
    expect(c.pages.find((p: any) => p.key === 'page:adm_people').base_roles).toEqual(['hr_admin', 'admin']);
    expect(c.areas.length).toBe(8);
    for (const who of [A.e1, A.bm1, A.hr, A.auditor, A.admin]) expect(await hidden(who)).toEqual([]);
  });

  it('hiding a page for a role hides it for that role only, and the server refuses it too', async () => {
    await set('tasks', 'executive', 'self'); await set('chat', 'executive', 'self'); await set('payroll', 'executive', 'self');
    expect(await hidden(A.e1)).toEqual(['chat', 'tasks', 'payroll']);
    expect(await hidden(A.bm1)).toEqual([]);
    await expectError(as(db, A.e1, `select * from my_tasks()`), /turned off for your role/);
    await as(db, A.bm1, `select * from my_tasks()`);
    await set('tasks', 'executive', 'all'); await set('chat', 'executive', 'all'); await set('payroll', 'executive', 'all');
    await as(db, A.e1, `select * from my_tasks()`);
  });

  it('Admin sections can be hidden from HR, and another role of the same person does not bring them back', async () => {
    await set('adm_compliance', 'hr_admin', 'self'); await set('adm_usage', 'hr_admin', 'self');
    expect(await hidden(A.hr)).toEqual(['adm_compliance', 'adm_usage']);
    await expectError(as(db, A.hr, `select hr_repository()`), /turned off for your role/);
    await db.query(`insert into role_assignments(person_id, role, valid) values ($1, 'manager', '[2026-01-01,)')`, [P.hr]);
    expect(await hidden(A.hr)).toEqual(['adm_compliance', 'adm_usage']);       // "manager" does not carry Admin sections
    await set('adm_log', 'auditor', 'self');
    expect(await hidden(A.auditor)).toEqual(['adm_log']);
  });

  it('a page a role gets only by having a team can still be hidden for that role; Admin is never hidden', async () => {
    await set('team', 'executive', 'self'); await set('reviews', 'executive', 'self');
    expect(await hidden(A.e1)).toEqual(['team', 'reviews']);
    expect(await hidden(A.bm1)).toEqual([]);
    await expectError(set('team', 'admin', 'self'), /fixed/);
    expect(await hidden(A.admin)).toEqual([]);
  });
});
