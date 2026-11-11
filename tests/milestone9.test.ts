// 11 Nov: self check-in, self-planning and Commitment % (D-113).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, clock, expectError, freshDb } from './db';
import { A, M, P, seed } from './fixtures';

let db: PGlite;
beforeAll(async () => { db = await freshDb(); await seed(db); await clock(db, '2026-11-12T09:50:00+05:30'); });

describe('Check-in, planning, commitment (D-113)', () => {
  it('checks in, plans the day, and computes commitment from the entries', async () => {
    // not checked in yet
    expect((await as(db, A.e1, `select (my_plan(null)->>'checked_in_at') c`))[0].c).toBeNull();
    await as(db, A.e1, `select self_check_in('starting SBI batch')`);
    const p1 = (await as(db, A.e1, `select my_plan(null) j`))[0].j;
    expect(p1.checked_in_at).not.toBeNull();
    // plan 10 cases with a note
    await as(db, A.e1, `select save_plan(null, 10, $1, 'Clear the SBI Pune backlog')`, [JSON.stringify({ [M.cl1]: 10 })]);
    const p2 = (await as(db, A.e1, `select my_plan(null) j`))[0].j;
    expect([p2.planned_total, p2.plan_note, p2.commitment_pct]).toEqual([10, 'Clear the SBI Pune backlog', 0]);
    // they log 7 → commitment 70%
    await db.query(`insert into productivity_lines(person_id, work_date, client_location_id, entry) values ($1, '2026-11-12', $2, 7)`, [P.e1, M.cl1]);
    const p3 = (await as(db, A.e1, `select my_plan(null) j`))[0].j;
    expect([p3.actual_total, p3.commitment_pct]).toEqual([7, 70]);
    await as(db, A.e1, `select close_plan(null, 'Did 7, rest tomorrow')`);
    expect((await as(db, A.e1, `select (my_plan(null)->>'done_note') d`))[0].d).toBe('Did 7, rest tomorrow');
    // cannot plan a past day
    await expectError(as(db, A.e1, `select save_plan('2026-11-01', 5, null, null)`), /today or a future day/);
  });
  it('rolls up to a team view and a meter for managers', async () => {
    const t = (await as(db, A.bm1, `select team_commitment(null) j`))[0].j;
    expect(Array.isArray(t)).toBe(true);
    await expectError(as(db, A.e1, `select team_commitment(null)`), /managers and above/);
    // meter works for a plain person (themselves)
    const m = (await as(db, A.e1, `select commitment_meter(null) j`))[0].j;
    expect(m.n).toBe(1);
    expect(m.planned).toBe(1);        // e1 planned above
    expect(m.checked_in).toBe(1);
  });
});
