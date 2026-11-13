// 13 Nov: pause and resume functions (D-143); the scorecard is the measure (D-144/145); department heads (D-146).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, clock, expectError, freshDb } from './db';
import { A, P, seed } from './fixtures';

let db: PGlite;
const one = async (user: string, sql: string, params: any[] = []) => (await as(db, user, sql, params))[0];
beforeAll(async () => { db = await freshDb(); await seed(db); await clock(db, '2026-11-02T10:00:00+05:30'); });

describe('Pause and resume functions (D-143)', () => {
  it('only Admin can list and switch functions', async () => {
    const l = (await one(A.admin, `select modules_list() j`)).j;
    expect(l.map((m: any) => m.key)).toEqual(expect.arrayContaining(['attendance', 'payroll', 'hr_docs', 'letters']));
    await expectError(as(db, A.hr, `select modules_list()`), /Only Admin/);
    await expectError(as(db, A.e1, `select module_set('payroll', true)`), /Only Admin/);
  });

  it('a paused function leaves the menu for everyone, Admin included, and its pages refuse to open', async () => {
    await as(db, A.admin, `select module_set('payroll', true)`);
    await as(db, A.admin, `select module_set('hr_docs', true)`);
    for (const u of [A.admin, A.bm1, A.e1]) {
      const w = (await one(u, `select whoami() j`)).j;
      expect(w.hidden_pages).toEqual(expect.arrayContaining(['payroll', 'penalties', 'adm_compliance', 'adm_doccheck']));
      expect(w.paused_modules).toEqual(['payroll', 'hr_docs']);
    }
    await expectError(as(db, A.admin, `select app.page_enter('payroll')`), /paused by Admin/);
    // the View-as preview follows it too
    expect((await one(A.admin, `select pages_for_roles('{executive}') j`)).j.hidden).toEqual(expect.arrayContaining(['payroll']));
  });

  it('the profile gate rests while joining documents are paused', async () => {
    const w = (await one(A.e2, `select whoami() j`)).j;
    expect(w.profile_missing).toEqual([]);
  });

  it('raises none of its tasks or notifications while paused, and closes the open ones', async () => {
    await db.query(`select app.task_upsert('salary_missing', 'task', 'test:salary:1', $1, $2, 'Salary missing', '{}')`, [P.bm1, P.e1]);
    expect((await db.query<any>(`select count(*)::int c from tasks where dedupe_key = 'test:salary:1'`)).rows[0].c).toBe(0);
    await db.query(`insert into notifications(person_id, kind, message) values ($1, 'payroll', 'pay sheet ready')`, [P.e1]);
    expect((await db.query<any>(`select count(*)::int c from notifications where message = 'pay sheet ready'`)).rows[0].c).toBe(0);
    // other functions are unaffected
    await db.query(`insert into notifications(person_id, kind, message) values ($1, 'task', 'still here')`, [P.e1]);
    expect((await db.query<any>(`select count(*)::int c from notifications where message = 'still here'`)).rows[0].c).toBe(1);
  });

  it('resuming brings it back as it was', async () => {
    await as(db, A.admin, `select module_set('payroll', false)`);
    await as(db, A.admin, `select module_set('hr_docs', false)`);
    const w = (await one(A.e1, `select whoami() j`)).j;
    expect(w.hidden_pages).not.toContain('payroll');
    expect(w.paused_modules).toEqual([]);
    await db.query(`select app.task_upsert('salary_missing', 'task', 'test:salary:1', $1, $2, 'Salary missing', '{}')`, [P.bm1, P.e1]);
    expect((await db.query<any>(`select count(*)::int c from tasks where dedupe_key = 'test:salary:1' and status = 'open'`)).rows[0].c).toBe(1);
    // pausing again closes it; the change is in the activity log
    const r = (await one(A.admin, `select module_set('payroll', true) j`)).j;
    expect(r.tasks_closed).toBeGreaterThan(0);
    expect((await db.query<any>(`select count(*)::int c from audit_events where table_name = 'app_modules'`)).rows[0].c).toBeGreaterThan(0);
    await as(db, A.admin, `select module_set('payroll', false)`);
  });
});

describe('The scorecard is the measure (D-144/145)', () => {
  it('target achievement is an automatic KPI: null without a target, a percentage with one', async () => {
    await as(db, A.bm1, `select * from set_target('2026-11-01','revenue','person',15000,null,null,$1)`, [P.e1]);
    expect(Number((await db.query<any>(`select app.metric_actual('target_pct_ops', '2026-11-01', app.today(), 'person', null, null, $1, null) v`, [P.e1])).rows[0].v)).toBe(0);
    expect((await db.query<any>(`select app.metric_actual('target_pct_ops', '2026-11-01', app.today(), 'person', null, null, $1, null) v`, [P.e2])).rows[0].v).toBeNull();
  });

  it('Operations and Collections have default scorecards; applying never overwrites a manager’s choice', async () => {
    const d = (await one(A.admin, `select scorecard_defaults() j`)).j;
    const ops = d.departments.find((x: any) => x.department === 'Operations');
    expect(ops.kpis.map((k: any) => [k.name, Number(k.target)])).toEqual([
      ['Target Achievement – Rate %', 80], ['Cases Closed Beyond TAT (over 2 days) – Rate %', 5], ['Average Quality Score – Rate %', 98]]);
    expect(d.departments.find((x: any) => x.department === 'Collections').kpis.length).toBe(3);
    await expectError(as(db, A.bm1, `select scorecard_defaults_apply('Operations')`), /Only HR\/Admin/);
    await db.query(`update persons set department = 'Operations' where id in ($1, $2)`, [P.e1, P.e2]);
    const r1 = (await one(A.hr, `select scorecard_defaults_apply('Operations') j`)).j;
    expect(r1.applied).toBeGreaterThanOrEqual(2);
    expect((await one(A.e1, `select my_scorecard() j`)).j.lines.length).toBe(3);
    const r2 = (await one(A.hr, `select scorecard_defaults_apply('Operations') j`)).j;
    expect(r2.applied).toBe(0);
  });

  it('the reporting manager enters a result for their person; nobody else can', async () => {
    const k = (await db.query<any>(`select id from kpi_catalogue where name = 'Average Quality Score – Rate %'`)).rows[0].id;
    await as(db, A.bm1, `select kpi_entry_for($1, $2, 99, null)`, [P.e1, k]);
    await expectError(as(db, A.e2, `select kpi_entry_for($1, $2, 50, null)`, [P.e1, k]), /Only the reporting manager/);
    const auto = (await db.query<any>(`select id from kpi_catalogue where metric = 'target_pct_ops'`)).rows[0].id;
    await expectError(as(db, A.bm1, `select kpi_entry_for($1, $2, 50, null)`, [P.e1, auto]), /counted automatically/);
    const line = (await one(A.e1, `select my_scorecard() j`)).j.lines.find((l: any) => l.kpi_id === k);
    expect(Number(line.actual)).toBe(99);
    expect(Number(line.pct)).toBe(101);
  });

  it('with a scorecard, only its KPIs count — the old targets count only through the Target Achievement KPI', async () => {
    // e1: target 15000 with no revenue yet = 0%; KPIs: target achievement 0% (auto), quality 101%, TAT not entered
    const ach = Number((await db.query<any>(`select app.person_achievement($1, app.today()) a`, [P.e1])).rows[0].a);
    expect(ach).toBe(50.5);
    // swap the scorecard for one without Target Achievement: the target no longer pulls the score down
    const ids = (await db.query<any>(`select id, name from kpi_catalogue where department = 'Operations' and metric is null and name in ('Average Quality Score – Rate %', 'Cases Closed Beyond TAT (over 2 days) – Rate %', 'Quality Errors – Rate %')`)).rows;
    const attrs = (await db.query<any>(`select array_agg(id) a from (select id from attribute_catalogue where active order by name limit 3) x`)).rows[0].a;
    await as(db, A.bm1, `select scorecard_save($1, 'Operations', $2::jsonb, $3::uuid[])`, [P.e1, JSON.stringify(ids.map((r: any) => ({ kpi_id: r.id, target: r.name.startsWith('Average') ? 98 : 5, cadence: 'monthly', higher_better: r.name.startsWith('Average') }))), attrs]);
    expect(Number((await db.query<any>(`select app.person_achievement($1, app.today()) a`, [P.e1])).rows[0].a)).toBe(101);
    // the score sheet carries each line
    const sheet = (await one(A.bm1, `select score_preview($1, '2026-11-01', 7, 7) j`, [P.e1])).j;
    expect((sheet.sheet ?? sheet).kpi.measures.kpi_lines.length).toBe(3);
  });

  it('a person without a scorecard is still measured on their targets', async () => {
    await db.query(`update kpi_assignment set valid = daterange(lower(valid), lower(valid)) where person_id = $1`, [P.e4]);
    expect((await db.query<any>(`select app.person_achievement($1, app.today()) a`, [P.e4])).rows[0].a).toBeNull();
    await db.query(`insert into target_allocations(month, metric, level, person_id, amount, version, is_current, set_by, reason)
                    select month, metric, level, $1, amount, 1, true, set_by, 'test' from target_allocations where person_id = $2 and is_current limit 1`, [P.e4, P.e1]);
    expect(Number((await db.query<any>(`select app.person_achievement($1, app.today()) a`, [P.e4])).rows[0].a)).toBe(0);
  });
});

describe('Departments and heads (D-146)', () => {
  it('Legal & Compliance and Training exist with their designations; HR/Admin set the head', async () => {
    await as(db, A.hr, `select department_head_set('Training', $1)`, [P.hr]);
    await expectError(as(db, A.bm1, `select department_head_set('Training', $1)`, [P.bm1]), /Only HR\/Admin/);
    const l = (await one(A.admin, `select departments_list() j`)).j;
    expect(l.find((d: any) => d.name === 'Training').head_id).toBe(P.hr);
    expect(l.some((d: any) => d.name === 'Legal & Compliance')).toBe(true);
    const n = (await db.query<any>(`select count(*)::int c from designation_departments where department in ('Training', 'Legal & Compliance')`)).rows[0].c;
    expect(n).toBe(5);
  });
});

describe('Paused functions refuse their actions (D-143)', () => {
  it('a signed-in person cannot use a paused function; it works again once resumed', async () => {
    await as(db, A.admin, `select module_set('plan', true)`);
    await expectError(as(db, A.e1, `select self_check_in(null)`), /paused by Admin/);
    await as(db, A.admin, `select module_set('plan', false)`);
    await as(db, A.e1, `select self_check_in(null)`);
  });
});

describe('Performance only: alerts of paused functions are hidden (D-150)', () => {
  it('hides alerts a paused function already sent, including generic task alerts, and shows them again on resume', async () => {
    await db.query(`insert into notifications(person_id, kind, message, link) values ($1, 'task', 'Police verification for SYNTH — not started', '/tasks'), ($1, 'deadline', 'Today''s figures are not submitted yet', '/productivity')`, [P.e1]);
    const seen = async () => (await as(db, A.e1, `select message from notifications where message in ('Police verification for SYNTH — not started', 'Today''s figures are not submitted yet') order by message`)).map((r: any) => r.message);
    expect((await seen()).length).toBe(2);
    await as(db, A.admin, `select module_set('hr_docs', true)`);
    expect(await seen()).toEqual(["Today's figures are not submitted yet"]);
    await db.query(`insert into notifications(person_id, kind, message, link) values ($1, 'data_fix', 'Some of your details need correcting: PAN', '/profile?fix=1')`, [P.e1]);
    expect((await db.query<any>(`select count(*)::int c from notifications where kind = 'data_fix'`)).rows[0].c).toBe(0);
    await as(db, A.admin, `select module_set('hr_docs', false)`);
    expect((await seen()).length).toBe(2);
  });

  it('the attrition report can be paused like any function', async () => {
    await as(db, A.admin, `select module_set('people_reports', true)`);
    expect((await one(A.admin, `select whoami() j`)).j.hidden_pages).toContain('attrition');
    await as(db, A.admin, `select module_set('people_reports', false)`);
  });
});
