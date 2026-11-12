// 12 Nov: performance cycle audit (D-137) — every step notifies the next person; reminders; acknowledgement; history.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, clock, expectError, freshDb } from './db';
import { A, P, seed } from './fixtures';

let db: PGlite;
const notes = async (p: string) => (await db.query<any>(`select message from notifications where person_id=$1 and kind='review' order by created_at, id`, [p])).rows.map((r: any) => r.message);
const remind = async () => Number((await db.query<any>(`select app.performance_reminders() n`)).rows[0].n);
beforeAll(async () => { db = await freshDb(); await seed(db); });

describe('Performance cycle (D-137)', () => {
  it('reminds managers to set KPIs and attributes before the scorecard opens, once a day', async () => {
    await clock(db, '2026-11-20T10:00:00+05:30');
    expect(await remind()).toBeGreaterThan(0);
    expect((await notes(P.bm1)).some((m) => /do not have their KPIs and attributes set/.test(m))).toBe(true);
    const before = (await notes(P.bm1)).length; await remind();
    expect((await notes(P.bm1)).length).toBe(before);
  });

  it('reminds on Monday about weekly reviews, and tells the person when theirs is written', async () => {
    await clock(db, '2026-11-23T10:00:00+05:30');     // a Monday
    await remind();
    expect((await notes(P.bm1)).some((m) => /Weekly reviews are due/.test(m))).toBe(true);
    await as(db, A.bm1, `select save_weekly_review($1, '2026-11-16', 'Good week', 'Close pending cases')`, [P.e1]);
    expect((await notes(P.e1)).filter((m) => /weekly review for the week of 16 Nov is ready/.test(m)).length).toBe(1);
    await as(db, A.bm1, `select save_weekly_review($1, '2026-11-16', 'Good week, edited', 'Close pending cases')`, [P.e1]);
    expect((await notes(P.e1)).filter((m) => /weekly review/.test(m)).length).toBe(1);
  });

  it('self-review → manager → HR → the person, each told in turn; then acknowledged and kept in history', async () => {
    await clock(db, '2026-11-25T10:00:00+05:30');
    await remind();
    expect((await notes(P.e1)).some((m) => /self-review for November 2026 is open/.test(m))).toBe(true);
    await as(db, A.e1, `select self_score('2026-11-01', 7, 8, 'steady month')`);
    expect((await notes(P.bm1)).some((m) => /submitted their self-review for November 2026/.test(m))).toBe(true);
    await clock(db, '2026-11-27T10:00:00+05:30'); await remind();
    expect((await notes(P.bm1)).some((m) => /waiting for your score/.test(m))).toBe(true);
    await as(db, A.bm1, `select save_score($1, '2026-11-01', 7, 7, 'ok')`, [P.e1]);
    expect((await notes(P.e1)).some((m) => /Your manager has scored your November 2026 review/.test(m))).toBe(true);
    await expectError(as(db, A.e1, `select ack_score('2026-11-01', null)`), /no final score/);
    await clock(db, '2026-12-03T10:00:00+05:30'); await remind();
    expect((await notes(P.hr)).some((m) => /waiting for HR to confirm and lock/.test(m))).toBe(true);
    await as(db, A.hr, `select lock_score($1, '2026-11-01')`, [P.e1]);
    expect((await notes(P.e1)).some((m) => /score is final: \d+\.\d out of 10/.test(m))).toBe(true);
    await as(db, A.e1, `select ack_score('2026-11-01', 'I would like to discuss the KPI part')`);
    expect((await notes(P.hr)).some((m) => /commented on their November 2026 score/.test(m))).toBe(true);
    const h = (await as(db, A.e1, `select my_score_history() j`))[0].j;
    expect(h.length).toBe(1); expect(h[0].month).toBe('2026-11-01'); expect(h[0].ack_at).toBeTruthy();
    expect((await as(db, A.e2, `select my_score_history() j`))[0].j).toEqual([]);
  });
});
