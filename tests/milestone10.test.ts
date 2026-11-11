// 11 Nov: weekly review + monthly performance score /10 (D-114).
// 0.75 KPI + 0.25 Attributes, with automatic fairness adjustments that move a hand-given score.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, clock, expectError, freshDb } from './db';
import { A, M, P, seed } from './fixtures';

let db: PGlite;
const monNov = '2026-11-01';
beforeAll(async () => {
  db = await freshDb();
  await seed(db);
  await clock(db, '2026-11-12T10:00:00+05:30');
  // e2 overshoots: target 10 entries, did 11 -> 110% achievement.
  await db.query(`insert into target_allocations(month,metric,level,person_id,amount) values ($1,'entry','person',$2,10)`, [monNov, P.e2]);
  await db.query(`insert into productivity_lines(person_id,work_date,client_location_id,entry) values ($1,'2026-11-11',$2,11)`, [P.e2, M.cl1]);
  // e3 undershoots: target 10, did 3 -> 30% achievement.
  await db.query(`insert into target_allocations(month,metric,level,person_id,amount) values ($1,'entry','person',$2,10)`, [monNov, P.e3]);
  await db.query(`insert into productivity_lines(person_id,work_date,client_location_id,entry) values ($1,'2026-11-11',$2,3)`, [P.e3, M.cl3]);
});

describe('KPI score auto-adjusts from the numbers (D-114)', () => {
  it('lifts a modest score when achievement is strong and the final stays internally consistent', async () => {
    const k = (await db.query<any>(`select app.kpi_score($1,'2026-11-12',6) j`, [P.e2])).rows[0].j;
    expect(k.measures.achievement_pct).toBe(110);
    expect(Number(k.adjustments.achievement)).toBe(1);         // >=110% -> +1
    const sum = Object.values(k.adjustments).reduce((a: number, v: any) => a + Number(v), 0);
    expect(Number(k.final)).toBe(Math.max(0, Math.min(10, 6 + sum)));  // final = clamp(given + adjustments)
  });
  it('drops a generous score when achievement is poor', async () => {
    const k = (await db.query<any>(`select app.kpi_score($1,'2026-11-12',8) j`, [P.e3])).rows[0].j;
    expect(k.measures.achievement_pct).toBe(30);
    expect(Number(k.adjustments.achievement)).toBe(-2);        // <60% -> -2
    expect(Number(k.final)).toBeLessThan(8);
  });
});

describe('Attributes auto-adjust — even 10/10 moves (D-114)', () => {
  it('subtracts for team shrinkage so a perfect attribute score still drops', async () => {
    // one of zm2's reports leaves this month
    await db.query(`update persons set status='exited', exited_on='2026-11-05' where id=$1`, [P.e4]);
    const a = (await db.query<any>(`select app.attr_score($1,'2026-11-12',10) j`, [P.zm2])).rows[0].j;
    expect(a.is_manager).toBe(true);
    expect(a.measures.team_exits).toBe(1);
    expect(Number(a.adjustments.team_shrinkage)).toBe(-2);     // 1 of 1 left -> full -2
    expect(Number(a.final)).toBe(8);                           // 10 given, still lands at 8
  });
  it('blends 75/25 into a final out of 10', async () => {
    const s = (await db.query<any>(`select app.score_sheet($1,'2026-11-12',10,10) j`, [P.zm2])).rows[0].j;
    // zm2 has no personal target (kpi stays 10) and attr drops to 8 -> 0.75*10 + 0.25*8 = 9.5
    expect(Number(s.final)).toBe(9.5);
  });
});

describe('Scoring flow: manager scores -> HR/Admin locks (D-114)', () => {
  it('runs the full submit / lock / reveal cycle with the right gates', async () => {
    // manager previews and submits
    const pv = (await as(db, A.bm1, `select score_preview($1,'2026-11-12',null,null) j`, [P.e1]))[0].j;
    expect(pv.sheet).toBeTruthy();
    await as(db, A.bm1, `select save_score($1,'2026-11-12',6,7,'solid month') j`, [P.e1]);
    expect((await as(db, A.bm1, `select score_preview($1,'2026-11-12',null,null) j`, [P.e1]))[0].j.status).toBe('submitted');

    // the person cannot see it until HR/Admin locks
    expect((await as(db, A.e1, `select my_score('2026-11-12') j`))[0].j.available).toBe(false);

    // a manager cannot lock
    await expectError(as(db, A.bm1, `select lock_score($1,'2026-11-12')`, [P.e1]), /Only HR\/Admin can lock/);
    // HR locks, person now sees the breakdown
    await as(db, A.hr, `select lock_score($1,'2026-11-12') j`, [P.e1]);
    const mine = (await as(db, A.e1, `select my_score('2026-11-12') j`))[0].j;
    expect(mine.available).toBe(true);
    expect(mine.final).not.toBeNull();
    expect(mine.breakdown).toBeTruthy();

    // a locked month rejects a manager edit, but HR can reopen
    await expectError(as(db, A.bm1, `select save_score($1,'2026-11-12',9,9,'bump')`, [P.e1]), /locked/);
    await as(db, A.hr, `select reopen_score($1,'2026-11-12') j`, [P.e1]);
    await as(db, A.bm1, `select save_score($1,'2026-11-12',7,7,'revised') j`, [P.e1]);
  });

  it('refuses a score from someone who is not the manager, and bad numbers', async () => {
    await expectError(as(db, A.e3, `select save_score($1,'2026-11-12',6,6,null)`, [P.e1]), /Not permitted/);
    await expectError(as(db, A.bm1, `select save_score($1,'2026-11-12',11,6,null)`, [P.e1]), /between 0 and 10/);
  });
});

describe('Weekly review (D-114)', () => {
  it('a manager records a weekly review and both sides can read it', async () => {
    await as(db, A.bm1, `select save_weekly_review($1,'2026-11-09','Cleared the SBI backlog','Start fresh allocations') j`, [P.e1]);
    const seen = (await as(db, A.bm1, `select weekly_reviews($1,6) j`, [P.e1]))[0].j;
    expect(seen.length).toBe(1);
    expect(seen[0].review_note).toMatch(/SBI backlog/);
    // the person can read their own reviews
    const own = (await as(db, A.e1, `select weekly_reviews($1,6) j`, [P.e1]))[0].j;
    expect(own.length).toBe(1);
  });
});
