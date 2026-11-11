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
  await clock(db, '2026-11-26T10:00:00+05:30');   // inside the 25th–5th scoring window
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

describe('Review flow: self-review initiates -> direct manager scores -> HR locks (D-115)', () => {
  it('needs the self-review first, and only the DIRECT manager may score', async () => {
    // before a self-review, the manager cannot score
    await expectError(as(db, A.bm1, `select save_score($1,$2,6,7,'x')`, [P.e1, monNov]), /self-review/);
    // the person starts the review
    await as(db, A.e1, `select self_score($1,7,7,'my take') j`, [monNov]);
    expect((await as(db, A.e1, `select (my_review($1)->>'self_done') s`, [monNov]))[0].s).toBe('true');

    // zm1 is e1's manager's manager — NOT the direct manager — and HR is nobody's manager: both blocked
    await expectError(as(db, A.zm1, `select save_score($1,$2,6,7,null)`, [P.e1, monNov]), /direct manager/);
    await expectError(as(db, A.hr, `select save_score($1,$2,6,7,null)`, [P.e1, monNov]), /direct manager/);

    // the direct manager scores
    await as(db, A.bm1, `select save_score($1,$2,6,7,'solid month') j`, [P.e1, monNov]);
    expect((await as(db, A.bm1, `select (score_preview($1,$2,null,null)->>'status') s`, [P.e1, monNov]))[0].s).toBe('scored');

    // the person cannot see the final until HR/Admin locks
    expect((await as(db, A.e1, `select (my_review($1)->>'locked') l`, [monNov]))[0].l).toBe('false');
    await expectError(as(db, A.bm1, `select lock_score($1,$2)`, [P.e1, monNov]), /Only HR\/Admin/);
    await as(db, A.hr, `select lock_score($1,$2) j`, [P.e1, monNov]);
    const mr = (await as(db, A.e1, `select my_review($1) j`, [monNov]))[0].j;
    expect(mr.locked).toBe(true);
    expect(mr.final).not.toBeNull();
    expect(mr.breakdown).toBeTruthy();

    // locked rejects a manager edit; HR reopens
    await expectError(as(db, A.bm1, `select save_score($1,$2,9,9,'bump')`, [P.e1, monNov]), /locked/);
    await as(db, A.hr, `select reopen_score($1,$2) j`, [P.e1, monNov]);
    await as(db, A.bm1, `select save_score($1,$2,7,7,'revised') j`, [P.e1, monNov]);
    await expectError(as(db, A.bm1, `select save_score($1,$2,11,6,null)`, [P.e1, monNov]), /between 0 and 10/);
  });

  it('closes the scorecard outside the 25th–5th window', async () => {
    await clock(db, '2026-11-12T10:00:00+05:30');     // day 12 -> closed
    await expectError(as(db, A.e2, `select self_score($1,7,7,null)`, [monNov]), /25th to the 5th/);
    await expectError(as(db, A.bm1, `select save_score($1,$2,6,7,null)`, [P.e2, monNov]), /25th to the 5th/);
    expect((await as(db, A.e1, `select (my_review($1)->>'window_open') w`, [monNov]))[0].w).toBe('false');
    await clock(db, '2026-11-26T10:00:00+05:30');     // restore the window
  });

  it('scopes team_scores to direct reports for a manager, everyone for HR', async () => {
    const bm = (await as(db, A.bm1, `select team_scores($1) j`, [monNov]))[0].j;
    expect(bm.window_open).toBe(true);
    expect(bm.can_lock).toBe(false);
    const ids = bm.rows.map((r: any) => r.person_id);
    expect(ids).toContain(P.e1); expect(ids).toContain(P.e2);   // direct reports
    expect(ids).not.toContain(P.e3);                            // reports to ba1, not bm1
    const hr = (await as(db, A.hr, `select team_scores($1) j`, [monNov]))[0].j;
    expect(hr.can_lock).toBe(true);
    expect(hr.rows.length).toBeGreaterThan(bm.rows.length);     // HR sees everyone
  });
});

describe('Weekly review (D-115)', () => {
  it('only the direct manager writes; the person and HR can read', async () => {
    await expectError(as(db, A.zm1, `select save_weekly_review($1,'2026-11-23','x','y')`, [P.e1]), /direct manager/);
    await as(db, A.bm1, `select save_weekly_review($1,'2026-11-23','Cleared the SBI backlog','Start fresh allocations') j`, [P.e1]);
    const seen = (await as(db, A.bm1, `select weekly_reviews($1,8) j`, [P.e1]))[0].j;
    expect(seen.length).toBe(1);
    expect(seen[0].review_note).toMatch(/SBI backlog/);
    const own = (await as(db, A.e1, `select weekly_reviews($1,8) j`, [P.e1]))[0].j;   // the person can read theirs
    expect(own.length).toBe(1);
  });
});
