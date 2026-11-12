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

describe('Team actions, tidy tasks and the activity log (D-138, D-139)', () => {
  it('a manager can mark attendance for anyone below them, in any reporting line — not for others', async () => {
    await clock(db, '2026-12-04T10:00:00+05:30');
    await as(db, A.zm1, `select set_attendance($1, '2026-12-03', 'absent', 'did not report')`, [P.e1]);            // two levels down
    await expectError(as(db, A.zm1, `select set_attendance($1, '2026-12-03', 'absent', 'x')`, [P.e4]), /people in your team/);
    await expectError(as(db, A.e2, `select set_attendance($1, '2026-12-03', 'absent', 'x')`, [P.e1]), /people in your team/);
    await db.query(`select set_config('app.reason','test',false)`);
    await db.query(`insert into reporting_lines(person_id, manager_id, function, valid) values ($1, $2, 'bi', '[2026-01-01,)')`, [P.e4, P.auditor]);
    await as(db, A.auditor, `select set_attendance($1, '2026-12-03', 'absent', 'on leave')`, [P.e4]);                // a non-operations line
  });

  it('the log records the device and network address, and covers scores, access rules and letters', async () => {
    const before = Number((await db.query<any>(`select count(*) n from audit_events where table_name in ('access_rules','letter_templates','weekly_reviews')`)).rows[0].n);
    await as(db, A.admin, `select page_set('page:chat','executive','hidden')`); await as(db, A.admin, `select page_set('page:chat','executive','full')`);
    await as(db, A.hr, `select letter_template_save(null,'other','Audit check','Dear {{name}}, this is only a check.',true,true)`);
    expect(Number((await db.query<any>(`select count(*) n from audit_events where table_name in ('access_rules','letter_templates','weekly_reviews')`)).rows[0].n)).toBeGreaterThanOrEqual(before + 3);
    const a = (await db.query<any>(`select row_id, actor_person from audit_events where table_name='access_rules' order by at desc limit 1`)).rows[0];
    expect(a.row_id).toBe('page:chat|executive'); expect(a.actor_person).toBe(P.admin);
  });

  it('opening the app is logged once per device per half hour; only Admin and the Auditor read it', async () => {
    const info = JSON.stringify({ device_id: 'dev-1', device: 'Chrome on Android', platform: 'Android', screen: '412x915', tz: 'Asia/Kolkata', lat: '18.5204', lng: '73.8567', accuracy: '25' });
    await as(db, A.e1, `select log_access('sign_in', $1)`, [info]); await as(db, A.e1, `select log_access('open', $1)`, [info]); await as(db, A.e1, `select log_access('open', $1)`, [info]);
    const l = (await as(db, A.admin, `select access_log_list('2026-12-01','2026-12-31', $1) j`, [P.e1]))[0].j;
    expect(l.length).toBe(1); expect(l[0].device).toBe('Chrome on Android'); expect(l[0].lat).toBe(18.5204); expect(l[0].devices).toBe(1);
    await as(db, A.auditor, `select access_log_list()`);
    await expectError(as(db, A.bm1, `select access_log_list()`), /Only Admin and the Auditor/);
    await expectError(as(db, A.hr, `select access_log_list()`), /Only Admin and the Auditor/);
  });
});

describe('A chat for a task (D-141)', () => {
  it('opens one conversation per task with the people on it; outsiders cannot', async () => {
    await clock(db, '2026-12-04T10:00:00+05:30');
    await as(db, A.bm1, `select assign_task($1::uuid[], 'Clear the BOM pendency', 'By Friday', null, 'team', $2, 'daily')`, [`{${P.e1},${P.e2}}`, P.e1]);
    const id = (await db.query<any>(`select id from tasks where title='Clear the BOM pendency' limit 1`)).rows[0].id;
    const th = (await as(db, A.e1, `select task_chat($1) t`, [id]))[0].t;
    expect((await as(db, A.bm1, `select task_chat($1) t`, [id]))[0].t).toBe(th);                      // the same thread for everyone
    const members = (await db.query<any>(`select person_id from chat_members where thread_id=$1`, [th])).rows.map((r: any) => r.person_id).sort();
    expect(members).toEqual([P.bm1, P.e1, P.e2].sort());
    await as(db, A.e2, `select chat_send($1, 'I will take the Pune cases', null)`, [th]);
    await expectError(as(db, A.e4, `select task_chat($1)`, [id]), /Task not found/);
  });
});
