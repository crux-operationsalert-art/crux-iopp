// 11 Nov: report pages get a reach per role — Hidden / Only own / Own team / Full (D-125).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, clock, expectError, freshDb } from './db';
import { A, P, seed } from './fixtures';

let db: PGlite;
const set = (page: string, role: string, choice: string) => as(db, A.admin, `select page_set($1,$2,$3)`, ['page:' + page, role, choice]);
// the locations the Revenue Status page covers for this person (the page's limit is put in force first, as the page does)
const rows = async (who: string) => Number((await as(db, who, `with e as materialized (select app.page_enter('status') x) select (select count(*) from e) a, (select count(*) from app.visible_branches('2026-11-12')) n`))[0].n);
const missing = async (who: string) => (await as(db, who, `select person_id from missing_submissions('2026-11-12','operations')`)).map((r: any) => r.person_id);
beforeAll(async () => { db = await freshDb(); await seed(db); await clock(db, '2026-11-12T10:00:00+05:30'); });

describe('Reach of report pages (D-125)', () => {
  it('offers the narrower reaches only where the page supports them', async () => {
    const c = (await as(db, A.admin, `select access_card() j`))[0].j;
    const pg = (k: string) => c.pages.find((p: any) => p.key === 'page:' + k);
    expect(pg('tracker').scopes).toEqual(['self', 'team']);
    expect(pg('attrition').scopes).toEqual(['team']);
    expect(pg('tasks').scopes).toBeNull();
    await expectError(set('tasks', 'executive', 'team'), /cannot be limited/);
    await expectError(set('attrition', 'auditor', 'self'), /cannot be limited/);
    await expectError(set('tracker', 'admin', 'team'), /fixed/);
    await expectError(as(db, A.bm1, `select page_set('page:tracker','bm','team')`), /Only Admin/);
  });

  it('Own team narrows a company-wide role; Only own narrows a manager; Full puts it back', async () => {
    const full = await rows(A.auditor), zm = await rows(A.zm1);
    expect(full).toBeGreaterThan(0); expect(zm).toBeGreaterThan(0);
    await set('status', 'auditor', 'team');
    expect(await rows(A.auditor)).toBeLessThan(full);          // an auditor has no team of their own
    expect((await as(db, A.auditor, `select app.sees_all() s`))[0].s).toBe(true);   // the limit lasts only for that page
    await set('status', 'zm', 'team');
    expect(await rows(A.zm1)).toBe(zm);                         // a ZM's reach is already own + team
    await set('status', 'zm', 'self');
    expect(await rows(A.zm1)).toBeLessThanOrEqual(zm);
    await set('status', 'auditor', 'full'); await set('status', 'zm', 'full');
    expect(await rows(A.auditor)).toBe(full); expect(await rows(A.zm1)).toBe(zm);
    expect(await rows(A.admin)).toBe(full);
  });

  it('Daily submissions: Only own shows just the person; Own team shows their team', async () => {
    const before = await missing(A.zm1);
    await set('live', 'zm', 'self');
    expect((await missing(A.zm1)).every((id: string) => id === P.zm1)).toBe(true);
    await set('live', 'zm', 'team');
    expect(await missing(A.zm1)).toEqual(before);
    await set('live', 'auditor', 'team');
    expect(await missing(A.auditor)).toEqual([]);
    await set('live', 'zm', 'full'); await set('live', 'auditor', 'full');
  });

  it('Hidden still hides, and the preview answer follows the card', async () => {
    await set('tracker', 'executive', 'hidden'); await set('status', 'executive', 'self'); await set('history', 'executive', 'team');
    expect((await as(db, A.e1, `select (whoami()->'hidden_pages') j`))[0].j).toEqual(['tracker']);
    await expectError(as(db, A.e1, `select tracker_export('2026-11-12')`), /turned off for your role/);
    const p = (await as(db, A.admin, `select pages_for_roles(array['executive']) j`))[0].j;
    expect(p.hidden).toEqual(['tracker']);
    expect(p.limited).toEqual({ status: 'self', history: 'team' });
    expect((await as(db, A.admin, `select pages_for_roles(array['bm']) j`))[0].j).toEqual({ hidden: [], limited: {} });
    await expectError(as(db, A.e1, `select pages_for_roles(array['executive'])`), /Only Admin/);
  });
});
