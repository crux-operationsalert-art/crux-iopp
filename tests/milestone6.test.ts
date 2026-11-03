// Leadership access, collections-only access, role-based Zonal Tracker export, reopen many, record-only penalty,
// leave taken, attrition, month close, backup + restore, scheduled sync. Synthetic data only.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { as, clock, expectError, freshDb } from './db';
import { A, M, P, seed } from './fixtures';

let db: PGlite;
const CH = '00000000-0000-0000-0000-000000000099', CHA = '00000000-0000-0000-1000-000000000099';
const line = (cl: string, e: number, c: number, x: number) => ({ client_location_id: cl, entry: e, closure: c, cancelled: x });

beforeAll(async () => {
  db = await freshDb(); await seed(db);
  await db.exec(`
    insert into auth.users(id,email) values ('${CHA}','chair@synth.test');
    insert into persons(id,full_name,resource_type,status,auth_user_id,designation) values ('${CH}','SYNTH Chairman','own_employee','active','${CHA}','Chairman');
    insert into role_assignments(person_id,role,valid) values ('${CH}','leadership','[2026-01-01,)');
    insert into reporting_lines(person_id,manager_id,function,valid) values ('${P.oh}','${CH}','operations','[2026-01-01,)');
    insert into hr_profiles(person_id, date_of_birth, joining_date, current_address, permanent_address, city, state, pincode, emergency_name,
      emergency_relation, emergency_phone, pan_last4, aadhaar_last4, bank_name, bank_ifsc, bank_account_last4, highest_qualification, firm_name, completed_at)
      select '${CH}', date_of_birth, joining_date, current_address, permanent_address, city, state, pincode, emergency_name, emergency_relation, emergency_phone,
             pan_last4, aadhaar_last4, bank_name, bank_ifsc, bank_account_last4, highest_qualification, firm_name, now() from hr_profiles limit 1;
    insert into agreement_acceptances(person_id, version, typed_name, body_md5) values ('${CH}','v1','SYNTH Chairman','x');
    insert into location_heads(branch_id,person_id,head_role,valid) values
      ('${M.b1}','${P.zm1}','zonal_manager','[2026-01-01,)'), ('${M.b2}','${P.zm1}','zonal_manager','[2026-01-01,)'),
      ('${M.b3}','${P.zm2}','zonal_manager','[2026-01-01,)'), ('${M.b1}','${P.bm1}','branch_head','[2026-01-01,)');
    insert into import_batches(id, source, file_name, status) values ('00000000-0000-0000-0000-000000000777','synthetic','synthetic.xlsx','committed');
    insert into tracker_monthly(batch_id, month, as_of, zone_name, branch_id, client_id, location_name, client_name, actual_cases, actual_revenue, billing_amount, head_name, source_row, source_columns, region)
      values ('00000000-0000-0000-0000-000000000777','2026-10-01','2026-10-30','SYNTH West','${M.b1}','${M.cBOM}','SYNTH Pune','SYNTH-BOM',40,30000,25000,'SYNTH Former Head',1,'synthetic','West');`);
  await clock(db, '2026-11-10T12:00:00+05:30');
  await as(db, A.e1, `select * from save_productivity('2026-11-10',$1)`, [JSON.stringify([line(M.cl1, 5, 2, 1), line(M.cl2, 3, 1, 0)])]);
  await as(db, A.e2, `select * from save_productivity('2026-11-10',$1)`, [JSON.stringify([line(M.cl1, 4, 0, 0)])]);
  await as(db, A.e4, `select * from save_productivity('2026-11-10',$1)`, [JSON.stringify([line(M.cl4, 7, 0, 0)])]);
});

describe('Leadership and collections-only access', () => {
  it('the Chairman sees the whole business but cannot enter figures', async () => {
    const w = (await as(db, CHA, `select whoami() w`))[0].w;
    expect(w).toMatchObject({ leadership: true, ops_blind: false });
    const t = (await as(db, CHA, `select tracker_export('2026-11-10') t`))[0].t;
    expect(t.mode).toBe('full');
    expect(new Set(t.rows.map((r: any) => r.location))).toEqual(new Set(['SYNTH Pune', 'SYNTH Nashik Partner', 'SYNTH Kolkata']));
    expect((await as(db, CHA, `select count(*)::int n from productivity_lines`))[0].n).toBe(4);
    await expectError(as(db, CHA, `select * from save_productivity('2026-11-10',$1)`, [JSON.stringify([line(M.cl1, 1, 0, 0)])]), /allocat|not|agreement/i);
  });
  it('a Collections Head without an operations role sees collections, not operations figures', async () => {
    expect((await as(db, A.ch, `select whoami() w`))[0].w.ops_blind).toBe(true);
    await expectError(as(db, A.ch, `select perf_dashboard('2026-11-01')`), /collections only/);
    await expectError(as(db, A.ch, `select tracker_export('2026-11-10')`), /collections only/);
    expect((await as(db, A.ch, `select count(*)::int n from productivity_lines where person_id <> $1`, [P.e1]))[0].n).toBe(0);
  });
});

describe('Zonal Tracker export follows who downloads it', () => {
  it('Admin / leadership: every location; the Operations Head only through the team (D-52)', async () => {
    expect((await as(db, A.oh, `select tracker_export('2026-11-10') t`))[0].t.mode).not.toBe('full');
    const t = (await as(db, A.admin, `select tracker_export('2026-11-10') t`))[0].t;
    expect(t.mode).toBe('full');
    const bom = t.rows.find((r: any) => r.location === 'SYNTH Pune' && r.client === 'SYNTH-BOM');
    expect(bom).toMatchObject({ entry: 9, closure: 2, cancelled: 1, mtd: 8, prev_mtd: 0, rate: 800, stakeholder: 'SYNTH ZM West', head: 'SYNTH BM Pune' });
    expect(t.history.find((h: any) => h.location === 'SYNTH Pune' && h.client === 'SYNTH-BOM')).toMatchObject({ cases: 40, billing: 25000 });
  });
  it('Zonal Manager: only their locations', async () => {
    const t = (await as(db, A.zm1, `select tracker_export('2026-11-10') t`))[0].t;
    expect(t.mode).toBe('zm');
    expect(new Set(t.rows.map((r: any) => r.location))).toEqual(new Set(['SYNTH Pune', 'SYNTH Nashik Partner']));
  });
  it('Branch Manager: their team, person by person', async () => {
    const t = (await as(db, A.bm1, `select tracker_export('2026-11-10') t`))[0].t;
    expect(t.mode).toBe('team');
    expect(t.rows).toEqual([]);
    expect(new Set(t.people.map((r: any) => r.person))).toEqual(new Set(['SYNTH Exec One', 'SYNTH Exec Two']));
    expect(t.people.find((r: any) => r.person === 'SYNTH Exec One' && r.client === 'SYNTH-BOM')).toMatchObject({ entry: 5, mtd: 4, manager: 'SYNTH BM Pune' });
  });
  it('Executive: only their own figures', async () => {
    const t = (await as(db, A.e2, `select tracker_export('2026-11-10') t`))[0].t;
    expect(t.mode).toBe('self');
    expect(t.people.map((r: any) => r.person)).toEqual(['SYNTH Exec Two']);
  });
  it('history stays with the person recorded then; entered figures stay with whoever entered them', async () => {
    const d = (await as(db, A.oh, `select perf_dashboard('2026-11-01') d`))[0].d;
    const names = new Set(d.by_person.map((r: any) => r.person));
    expect(names.has('SYNTH Former Head')).toBe(true);
    expect(d.by_person.find((r: any) => r.person === 'SYNTH Exec Four' && r.month === '2026-11-01').cases).toBe(7);
    expect(d.by_person.some((r: any) => r.person === 'SYNTH BM Pune' && r.month === '2026-11-01')).toBe(false);
  });
});

describe('Admin tools', () => {
  it('reopens many people / locations / dates at once', async () => {
    await expectError(as(db, A.bm1, `select grant_reopen_many(null, $1, '2026-11-03', '2026-11-04', 'x', now() + interval '1 day')`, [[M.b1]]), /Admin/);
    await expectError(as(db, A.admin, `select grant_reopen_many(null, $1, '2026-10-01', '2026-11-04', 'x', now() + interval '1 day')`, [[M.b1]]), /31 days/);
    const r = (await as(db, A.admin, `select grant_reopen_many($1, $2, '2026-11-03', '2026-11-04', 'SYNTH network outage', '2026-11-11T12:00:00+05:30')`, [[P.e4], [M.b1]]))[0].grant_reopen_many;
    expect(r).toEqual({ people: 5, grants: 10 });   // e1, e2, bm1 (allocated), zm1 (head), e4 (named) × 2 days
  });
  it('a missed report records a ₹5,000 penalty proposal with no pay effect', async () => {
    await db.exec(`update settings set value = '"2026-11-09"' where key = 'go_live_date'`);
    await clock(db, '2026-11-11T11:00:00+05:30');
    await as(db, A.admin, `select sync_tasks(true)`);
    const p = await db.query<any>(`select l.amount::int amount, l.status, l.payroll_effect from penalty_ledger l join penalty_rules r on r.id = l.rule_id
                                     where r.code = 'missed_report' and l.person_id = '${P.e3}' and l.event_date = '2026-11-10'`);
    expect(p.rows).toEqual([{ amount: 5000, status: 'proposed', payroll_effect: false }]);
  });
  it('the scheduled sync runs without anyone signed in and flags heads who did not report collections', async () => {
    await db.query(`select app.sync_all()`);
    const t = await db.query<any>(`select count(*)::int n from tasks where kind = 'collections_missing' and subject_id = '${P.bm1}' and ref_date = '2026-11-10'`);
    expect(t.rows[0].n).toBe(1);
  });
  it('leave taken per month for a manager\'s team', async () => {
    await db.exec(`insert into attendance(person_id, work_date, status, source, reason, set_by) values ('${P.e1}','2026-11-09','planned_leave','manager','SYNTH leave','${P.bm1}')`);
    const r = await as(db, A.bm1, `select full_name, planned::int from leave_taken(2026, $1) where month = '2026-11-01' and full_name = 'SYNTH Exec One'`, [P.bm1]);
    expect(r).toEqual([{ full_name: 'SYNTH Exec One', planned: 1 }]);
    await expectError(as(db, A.e1, `select * from leave_taken(2026, $1)`, [P.bm1]), /team/);
  });
  it('attrition by month', async () => {
    await db.exec(`update persons set joined_on = '2026-01-01'; update persons set exited_on = '2026-11-05' where id = '${P.e3}'`);
    const r = await as(db, A.oh, `select opening, left_ from attrition('2026-11-01','2026-11-30')`);
    expect(r[0].left_).toBe(1);
    await expectError(as(db, A.e1, `select * from attrition('2026-11-01','2026-11-30')`), /Only/);
  });
  it('month close: checklist, Admin only, finished months only', async () => {
    const c = (await as(db, A.admin, `select month_close_check('2026-11-01') c`))[0].c;
    expect(c).toMatchObject({ closed: false, cases: 18 });
    await expectError(as(db, A.admin, `select close_month('2026-11-01','x')`), /finished month/);
    await expectError(as(db, A.oh, `select close_month('2026-10-01','x')`), /Admin/);
    expect((await as(db, A.admin, `select close_month('2026-10-01','SYNTH October closed') c`))[0].c.closed).toBe(true);
  });
  it('backup downloads every table and restores into a fresh database with identical counts', async () => {
    await expectError(as(db, A.oh, `select admin_backup()`), /Admin/);
    const b = (await as(db, A.admin, `select admin_backup() b`))[0].b;
    expect(b.format).toBe('crux-iopp-backup-v1');
    const fresh = await freshDb();
    await fresh.exec(readFileSync(join(__dirname, '..', 'tools', 'restore_backup.sql'), 'utf8'));
    await fresh.exec(`delete from settings; delete from agreement_versions; delete from penalty_rules;`);   // seeded by migrations; the backup carries them
    const res = (await fresh.query<any>(`select restore_backup($1::jsonb) r`, [JSON.stringify(b)])).rows[0].r;
    for (const [t, rows] of Object.entries<any[]>(b.tables)) expect([t, res[t]]).toEqual([t, rows.length]);
    const same = await fresh.query<any>(`select count(*)::int n, sum(entry)::int e from productivity_lines`);
    expect(same.rows[0]).toEqual({ n: 4, e: 19 });
  });
});

describe('Phone notifications', () => {
  it('a new task notifies its owner; only people who allowed notifications get a push, once', async () => {
    await as(db, A.e1, `select save_push_subscription('https://push.synth.test/e1','k1','a1','SYNTH phone')`);
    await expectError(as(db, A.e1, `select push_batch()`), /permission/);            // the sender only
    await db.query(`select app.task_upsert('add_team','task','synth:push:1',$1,$1,'SYNTH add your team','{}'::jsonb)`, [P.e1]);
    const b = (await db.query<any>(`select public.push_batch() b`)).rows[0].b;
    expect(b.filter((x: any) => x.endpoint === 'https://push.synth.test/e1').map((x: any) => x.body)).toContain('SYNTH add your team');
    expect(b.every((x: any) => x.endpoint === 'https://push.synth.test/e1')).toBe(true);   // nobody else subscribed
    expect((await db.query<any>(`select public.push_batch() b`)).rows[0].b).toEqual([]);   // not sent twice
    await db.query(`select public.push_result('https://push.synth.test/e1', false)`);
    expect((await as(db, A.e1, `select disabled_at is not null d from push_subscriptions`))[0].d).toBe(true);
    expect((await as(db, A.e2, `select count(*)::int n from push_subscriptions`))[0].n).toBe(0);   // private
  });
});

describe('Partner commercial details (SOW 6.3)', () => {
  it('Admin records agreement and security cheque; others cannot read or write; changes are audited', async () => {
    await as(db, A.admin, `insert into partner_agreements(branch_id, agreement_signed, signed_on, cheque_received, cheque_amount, cheque_number, cheque_bank) values ($1, true, '2026-10-01', true, 50000, '123456', 'SYNTH Bank')`, [M.b1]);
    expect((await as(db, A.e1, `select count(*)::int n from partner_agreements`))[0].n).toBe(0);
    await expectError(as(db, A.e1, `insert into partner_agreements(branch_id) values ($1)`, [M.b2]), /row-level|permission|policy/i);
    await expectError(as(db, A.admin, `insert into partner_agreements(branch_id, cheque_number) values ($1, '12')`, [M.b2]), /check/i);
    expect((await as(db, A.admin, `select count(*)::int n from audit_events where table_name = 'partner_agreements'`))[0].n).toBe(1);
  });
});

describe('Reminders (SOW 16.1)', () => {
  it('pending people get a deadline reminder once, managers get the list, grace and target-lock reminders follow', async () => {
    const cnt = async (kind: string, who?: string) => (await db.query<any>(`select count(*)::int n from notifications where kind = $1 ${who ? 'and person_id = $2' : ''}`, who ? [kind, who] : [kind])).rows[0].n;
    await clock(db, '2026-11-17T20:10:00+05:30');
    await db.query(`select app.reminders()`);
    expect(await cnt('deadline', P.e1)).toBe(1);
    await db.query(`select app.reminders()`);
    expect(await cnt('deadline', P.e1)).toBe(1);                       // once per slot
    await clock(db, '2026-11-17T22:10:00+05:30');
    await db.query(`select app.reminders()`);
    expect(await cnt('deadline', P.e1)).toBe(2);
    expect(await cnt('team_deadline')).toBeGreaterThan(0);
    await clock(db, '2026-11-18T08:10:00+05:30');
    await db.query(`select app.reminders()`);
    expect(await cnt('grace', P.e1)).toBe(1);
    await clock(db, '2026-12-04T10:10:00+05:30');                        // Dec targets lock at the end of 5 Dec (5th working day)
    await db.query(`select app.reminders()`);
    expect(await cnt('target_lock')).toBeGreaterThan(0);
    await clock(db, '2026-11-18T12:00:00+05:30');
  });
});

describe('Unplanned absence streak (acceptance 16)', () => {
  it('more than 3 working days absent without leave creates one explanation task for the manager', async () => {
    await clock(db, '2026-11-27T12:00:00+05:30');
    await db.query(`select app.sync_absence_streaks()`);
    await db.query(`select app.sync_absence_streaks()`);
    const t = (await db.query<any>(`select owner_id, subject_id, detail from tasks where kind = 'absence_streak' and subject_id = $1`, [P.e3])).rows;
    expect(t.length).toBe(1);
    expect(t[0].detail.days).toBeGreaterThan(3);
    await clock(db, '2026-11-18T12:00:00+05:30');
  });
});

describe('Confidentiality follows assignment, not title (D-52)', () => {
  it('an Operations Head with nobody reporting to them sees only themselves', async () => {
    const pid = '00000000-0000-0000-0000-000000000777', uid = '00000000-0000-0000-1000-000000000777';
    await db.query(`insert into auth.users(id,email) values ($1,'oh2@synth.test')`, [uid]);
    await db.query(`insert into persons(id,full_name,personal_email,resource_type,status,auth_user_id) values ($1,'SYNTH Ops Head Two','oh2@synth.test','own_employee','active',$2)`, [pid, uid]);
    await db.query(`insert into role_assignments(person_id,role,valid) values ($1,'ops_head','[2026-01-01,)')`, [pid]);
    const n = async (sql: string) => (await as(db, uid, sql))[0];
    expect((await n(`select count(*)::int n from persons where id <> '${pid}'`)).n).toBe(0);
    expect((await n(`select count(*)::int n from productivity_lines`)).n).toBe(0);
    expect((await n(`select count(*)::int n from allocations`)).n).toBe(0);
    expect((await n(`select count(*)::int n from tracker_monthly`)).n).toBe(0);
    expect((await n(`select count(*)::int n from rate_cards`)).n).toBe(0);
    expect((await n(`select count(*)::int n from location_heads`)).n).toBe(0);
    expect((await n(`select count(*)::int n from collection_daily`)).n).toBe(0);
    expect((await n(`select count(*)::int n from target_allocations where level <> 'org'`)).n).toBe(0);
    expect((await n(`select target_template('2026-11-01') t`)).t.people).toEqual([]);
    expect((await n(`select collections_view('2026-11-01') v`)).v.rows).toEqual([]);
    expect((await n(`select tracker_export('2026-11-10') t`)).t.rows ?? []).toEqual([]);
    expect((await n(`select perf_dashboard('2026-11-01') p`)).p.by_location).toEqual([]);
    expect((await as(db, uid, `select person_id from attendance_board('2026-11-10','2026-11-10',null)`)).every((r: any) => r.person_id === pid)).toBe(true);
    await expectError(as(db, uid, `select * from target_progress('2026-11-01','branch',null,$1,null)`, [M.b1]), /Not permitted/);
    // the original Operations Head still sees their team
    expect((await as(db, A.oh, `select count(*)::int n from persons`))[0].n).toBeGreaterThan(5);
  });
});

describe('Ticking clients stays within your locations (D-52)', () => {
  it('someone with no link to a location cannot see or tick its clients', async () => {
    const s = await as(db, A.e4, `select branch_id from my_services()`);
    expect(s.every((r: any) => r.branch_id !== M.b1)).toBe(true);
    const cl1 = M.cl1;   // SYNTH Pune — not e4's or e4's manager's location
    await expectError(as(db, A.e4, `select set_service_active($1,true)`, [cl1]), /not assigned to you/);
  });
});

describe('My day: month to date and opening (P1)', () => {
  it('operations rows carry MTD before today; non-heads see the collections of their clients read only', async () => {
    const t = (await as(db, A.e1, `select my_targets('2026-11-10') t`))[0].t;
    const r = t.rows.find((x: any) => x.client_location_id === M.cl1);
    expect(r.prev).toHaveProperty('entry'); expect(r.prev).toHaveProperty('revenue');
    const o = (await as(db, A.e1, `select my_collection_others('2026-11-10') j`))[0].j;
    expect(Array.isArray(o)).toBe(true);
    expect(o.every((x: any) => 'head' in x && 'agg' in x)).toBe(true);
    const heads = (await as(db, A.e1, `select my_collection_day('2026-11-10') j`))[0].j;
    expect(heads.every((x: any) => 'prev' in x)).toBe(true);
  });
});

describe('Two-step sign-in for privileged roles (D-54)', () => {
  it('when required, Admin powers need an aal2 session; other roles are unaffected', async () => {
    await db.query(`update settings set value = 'true' where key = 'privileged_mfa_required'`);
    expect((await as(db, A.admin, `select app.is_admin() a`))[0].a).toBe(false);          // aal1 session
    await db.exec(`set role authenticated`);
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: A.admin, aal: 'aal2' })]);
    expect((await db.query<any>(`select app.is_admin() a`)).rows[0].a).toBe(true);
    await db.exec(`reset role`);
    expect((await as(db, A.oh, `select app.has_role('ops_head') a`))[0].a).toBe(true);
    expect((await as(db, A.admin, `select my_mfa_status() s`))[0].s).toMatchObject({ required: true, privileged: true, aal: 'aal1' });
    await db.query(`update settings set value = 'false' where key = 'privileged_mfa_required'`);
    expect((await as(db, A.admin, `select app.is_admin() a`))[0].a).toBe(true);
  });
});

describe('Sunday / holiday work (acceptance 17)', () => {
  it('hours recorded, manager approves, report shows it, nothing touches pay', async () => {
    await clock(db, '2026-11-17T12:00:00+05:30');
    await expectError(as(db, A.e1, `select save_extra_work('2026-11-16','10:00','18:00',60)`), /normal working day/);
    const w = (await as(db, A.e1, `select * from save_extra_work('2026-11-15','10:00','18:00',60,'SYNTH backlog')`))[0];
    expect(w.minutes).toBe(420);
    await expectError(as(db, A.e1, `select decide_extra_work($1,true)`, [w.id]), /manager/);
    await expectError(as(db, A.e2, `select decide_extra_work($1,true)`, [w.id]), /manager/);
    await as(db, A.bm1, `select decide_extra_work($1,true)`, [w.id]);
    const r = await as(db, A.bm1, `select full_name, hours::float h, status, counted_as from extra_work_report('2026-11-01','2026-11-30')`);
    expect(r).toEqual([{ full_name: 'SYNTH Exec One', h: 7, status: 'approved', counted_as: '1 day' }]);
    expect(await as(db, A.zm2, `select * from extra_work_report('2026-11-01','2026-11-30')`)).toEqual([]);
    await clock(db, '2026-11-18T12:00:00+05:30');
  });
});

describe('BI & Growth and reconciliation (D-56, D-57)', () => {
  it('an auditor sees all but cannot set targets or tick clients; reconciliation status and gap task', async () => {
    await clock(db, '2026-11-05T12:00:00+05:30');
    expect((await as(db, A.auditor, `select count(*)::int n from persons`))[0].n).toBeGreaterThan(10);
    await expectError(as(db, A.auditor, `select set_target('2026-11-01','revenue','org',1)`), /not allowed/);
    await expectError(as(db, A.auditor, `select set_service_active($1,true)`, [M.cl1]), /does not report daily figures/);
    expect((await db.query<any>(`select app.recon_status(100000, 80000) a, app.recon_status(100, 120) b, app.recon_status(100, 100) c, app.recon_status(50, 0) d`)).rows[0])
      .toEqual({ a: 'partially_reconciled', b: 'reconciled_over', c: 'reconciled', d: 'pending' });
    await clock(db, '2026-11-18T12:00:00+05:30');
    await db.query(`update settings set value = '"2026-11-01"' where key = 'go_live_date'`);
    await db.query(`select app.sync_recon_gaps()`);
    const t = (await db.query<any>(`select title, detail from tasks where kind = 'recon_gap'`)).rows;
    expect(t.every((x: any) => Number(x.detail.received) > Number(x.detail.reconciled))).toBe(true);
  });
});
