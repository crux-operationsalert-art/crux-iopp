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

describe('Collections by anyone on the client, one figure per client · location (D-59)', () => {
  it('a non-head enters, the head sees the same row and is told; totals are not doubled', async () => {
    await clock(db, '2026-11-19T18:00:00+05:30');
    const day = (await as(db, A.e1, `select my_collection_day('2026-11-19') j`))[0].j;
    const bom = day.find((x: any) => x.branch_id === M.b1 && x.client_id === M.cBOM);
    expect(bom).toBeTruthy();
    const row = (v: number) => JSON.stringify([{ branch_id: M.b1, client_id: M.cBOM, bill_count: 1, bill_amount: 100, rcv_lt30: v, rcv_30_90: 0, rcv_90_180: 0, rcv_gt180: 0, rec_lt30: v, rec_30_90: 0, rec_90_180: 0, rec_gt180: 0 }]);
    await as(db, A.e1, `select save_collection_day('2026-11-19',$1)`, [row(700)]);
    await as(db, A.e1, `select save_collection_day('2026-11-19',$1)`, [row(900)]);            // correction replaces, not adds
    expect((await db.query<any>(`select count(*)::int n, sum(rcv_lt30)::int s from collection_daily where entry_date='2026-11-19' and branch_id=$1 and client_id=$2`, [M.b1, M.cBOM])).rows[0])
      .toEqual({ n: 1, s: 900 });
    await expectError(as(db, A.e4, `select save_collection_day('2026-11-19',$1)`, [row(1)]), /do not work on that client/);
    await clock(db, '2026-11-18T12:00:00+05:30');
  });
});

describe('Bottom-up chain with absent managers (D-60)', () => {
  it('exec missing blocks; manager away → grand-manager acts for them and certifies for them; leave resolves', async () => {
    const D = '2026-11-24';
    await clock(db, `${D}T18:00:00+05:30`);
    await db.query(`insert into day_status(person_id, work_date, function, status, submitted_at) values ($1,$2,'operations','submitted',now())`, [P.e1, D]);
    // e2 has not reported: the BM is blocked
    await expectError(as(db, A.bm1, `select * from certify_team_detail($1,'operations')`, [D]), /SYNTH Exec Two \(pending\)/);
    // the ZM cannot act for e2 while the BM is at work
    await expectError(as(db, A.zm1, `select * from set_member_status($1,$2,'absent','x')`, [P.e2, D]), /direct reports/);
    await expectError(as(db, A.zm1, `select * from certify_for($1,$2)`, [P.bm1, D]), /Mark SYNTH BM Pune absent/);
    // the BM is absent: the ZM marks them, then acts for their team
    await as(db, A.zm1, `select * from set_member_status($1,$2,'absent','On leave without notice')`, [P.bm1, D]);
    await expectError(as(db, A.zm1, `select * from certify_for($1,$2)`, [P.bm1, D]), /Waiting on: SYNTH Exec Two/);
    await as(db, A.zm1, `select * from set_member_status($1,$2,'absent','Phone off')`, [P.e2, D]);
    const c = (await as(db, A.zm1, `select manager_id, certified_by from certify_for($1,$2)`, [P.bm1, D]))[0];
    expect(c).toEqual({ manager_id: P.bm1, certified_by: P.zm1 });
    expect((await as(db, A.bm1, `select count(*)::int n from notifications where kind='certified_for_you'`))[0].n).toBe(1);
    // the ZM's own gate: the BA's team — e3 on approved leave counts as resolved
    await db.query(`insert into attendance(person_id, work_date, status, source, reason) values ($1,$2,'planned_leave','leave','Approved leave')
                    on conflict (person_id, work_date) do update set status = excluded.status`, [P.e3, D]);
    const st = await as(db, A.ba1, `select full_name, status, resolved from team_status($1)`, [D]);
    expect(st).toEqual([{ full_name: 'SYNTH Exec Three', status: 'on_leave', resolved: true }]);
    await as(db, A.ba1, `select * from certify_team_detail($1,'operations')`, [D]);
    await as(db, A.zm1, `select * from certify_team_detail($1,'operations')`, [D]);
    // two levels away: the Ops Head can act for an exec only when every manager in between is away
    await expectError(as(db, A.oh, `select * from set_member_status($1,$2,'absent','x')`, [P.e1, '2026-11-25']), /direct reports/);
    await clock(db, '2026-11-18T12:00:00+05:30');
  });
});

describe('Executive Assistant and Product Head (D-61, D-62)', () => {
  it('an EA sees the principal\'s scope but no HR data and cannot change anything', async () => {
    await db.query(`insert into role_assignments(person_id, role, valid) values ($1, 'ea', '[2026-01-01,)')`, [P.e4]);
    await db.query(`insert into ea_assignments(ea_person, principal, valid) values ($1, $2, '[2026-01-01,)')`, [P.e4, P.oh]);
    expect((await as(db, A.e4, `select count(*)::int n from persons`))[0].n).toBeGreaterThan(8);
    expect((await as(db, A.e4, `select whoami() w`))[0].w.ea_for).toEqual(['SYNTH Ops Head']);
    expect((await as(db, A.e4, `select count(*)::int n from hr_compensation`))[0].n).toBe(0);
    expect((await as(db, A.e4, `select count(*)::int n from tasks where kind = 'salary_missing'`))[0].n).toBe(0);
    expect((await as(db, A.e4, `select count(*)::int n from audit_events`))[0].n).toBe(0);
    await expectError(as(db, A.e4, `select * from correct_team_line($1,'2026-11-10',$2,1,0,0,'x')`, [P.e1, M.cl1]), /only correct/);
    await expectError(as(db, A.e4, `select * from set_member_status($1,'2026-11-10','absent','x')`, [P.e1]), /direct reports/);
    expect((await as(db, A.e4, `select tracker_export('2026-11-10') t`))[0].t.mode).toBe('zm');
  });
  it('a Product Head sees the product everywhere and corrects an entry; the person and manager are told', async () => {
    await db.query(`insert into product_heads(person_id, client_id, product, valid) values ($1, $2, 'SBI', '[2026-01-01,)')`, [P.e3, M.cSBI]);
    const d = (await as(db, A.e3, `select product_dashboard('2026-11-01') d`))[0].d;
    expect(d.by_location.map((r: any) => r.client)).toEqual(expect.arrayContaining(['SYNTH-SBI']));
    expect(d.by_location.every((r: any) => r.client === 'SYNTH-SBI')).toBe(true);
    const lines = await as(db, A.e3, `select person, client from product_lines('2026-11-10')`);
    expect(lines.every((r: any) => r.client === 'SYNTH-SBI')).toBe(true);
    await as(db, A.e3, `select * from correct_team_line($1,'2026-11-10',$2,4,1,0,'Client portal shows 4')`, [P.e1, M.cl2]);
    expect((await as(db, A.e1, `select count(*)::int n from notifications where kind='entry_corrected'`))[0].n).toBeGreaterThan(0);
    await expectError(as(db, A.e3, `select * from correct_team_line($1,'2026-11-10',$2,1,0,0,'x')`, [P.e1, M.cl1]), /only correct/);   // BOM is not theirs
    await expectError(as(db, A.e2, `select product_dashboard('2026-11-01')`), /not Product Head/);
  });
});

describe('Names, assigned tasks, target reopen requests, alerts, new clients (D-63..D-66)', () => {
  it('names are tidied on save', async () => {
    expect((await db.query<any>(`select app.nice_name('  SYNTH   PERSON NAME ', 'person') a, app.nice_name('ASSISTANT BRANCH MANAGER', 'title') b,
      app.nice_name('Bengaluru + Rest Of Karnataka+Kerela', 'place') c, app.nice_name('Lucknow/ROUP - (Synth Head)', 'place') d, app.nice_name('IDBI Bank', 'client') e,
      app.nice_name('AVP - Business Intelligence and Growth', 'title') f`)).rows[0])
      .toEqual({ a: 'SYNTH Person Name', b: 'Assistant Branch Manager', c: 'Bengaluru + Rest of Karnataka + Kerela', d: 'Lucknow/ROUP - (SYNTH Head)', e: 'IDBI BANK', f: 'AVP - Business Intelligence and Growth' });
  });
  it('a manager assigns a task to the team and to a peer; not outside; the assignee asks to close; the assigner closes', async () => {
    expect((await as(db, A.bm1, `select assign_task($1,'Call the SBI branch manager','About pending files','2026-11-30') n`, [[P.e1, P.e2]]))[0].n).toBe(2);
    expect((await as(db, A.zm1, `select assign_task($1,'Share Nashik plan') n`, [[P.zm2]]))[0].n).toBe(1);              // peer
    await expectError(as(db, A.bm1, `select assign_task($1,'x')`, [[P.e4]]), /team, your peers/);
    await expectError(as(db, A.e1, `select assign_task($1,'x')`, [[P.e2]]), /Only managers/);
    const t = (await as(db, A.e1, `select id from my_tasks('open') where kind='assigned'`))[0];
    await as(db, A.e1, `select * from task_request_resolution($1,'Called, files sent')`, [t.id]);
    expect((await as(db, A.bm1, `select count(*)::int n from notifications where kind='task_resolution'`))[0].n).toBeGreaterThan(0);
    await expectError(as(db, A.e2, `select * from admin_decide_task($1,'resolve','ok')`, [t.id]), /Only Admin/);
    expect((await as(db, A.bm1, `select status from admin_decide_task($1,'resolve','Thanks')`, [t.id]))[0].status).toBe('resolved');
    expect((await as(db, A.bm1, `select count(*)::int n from my_tasks('all') where kind='assigned' and scope='assigned'`))[0].n).toBe(2);
  });
  it('person targets: direct manager only; after the lock a reopen request approved by Admin opens editing', async () => {
    await clock(db, '2026-12-03T10:00:00+05:30');
    expect((await as(db, A.zm1, `select save_targets('2026-12-01',$1) r`, [JSON.stringify([{ person_id: P.e1, revenue: 1 }])]))[0].r.rows[0].error).toMatch(/cannot set targets/);
    await clock(db, '2026-12-10T10:00:00+05:30');
    await expectError(as(db, A.bm1, `select request_target_reopen('2026-12-01','')`), /reason/);
    await as(db, A.bm1, `select request_target_reopen('2026-12-01','New client went live on 9 Dec')`);
    const req = (await as(db, A.admin, `select id from my_tasks('open') where kind='target_reopen'`))[0];
    await as(db, A.admin, `select * from admin_decide_task($1,'resolve','Approved')`, [req.id]);
    const r = (await as(db, A.bm1, `select save_targets('2026-12-01',$1,true,'New client') r`, [JSON.stringify([{ person_id: P.e1, revenue: 50000 }])]))[0].r;
    expect(r).toMatchObject({ errors: 0, applied: true });
    await clock(db, '2026-11-18T12:00:00+05:30');
  });
  it('Admin adds a client with a Product Head and sends an alert', async () => {
    const id = (await as(db, A.admin, `select add_client('synth new bank', null, $1, 'SYNTH NEW') id`, [P.e2]))[0].id;
    expect((await db.query<any>(`select name from clients where id = $1`, [id])).rows[0].name).toBe('SYNTH NEW BANK');
    expect((await as(db, A.e2, `select whoami() w`))[0].w.products).toEqual(['SYNTH NEW']);
    expect((await as(db, A.admin, `select send_alert($1,'New client SYNTH NEW BANK is live') n`, [[P.e2, P.bm1]]))[0].n).toBe(2);
    await expectError(as(db, A.e1, `select send_alert($1,'x')`, [[P.e2]]), /Only Admin/);
  });
});

describe('HR documents, police verification, HR repository (D-67..D-69)', () => {
  it('assign picker lists only people the manager may assign to', async () => {
    const ppl = await as(db, A.bm1, `select full_name, relation from assignable_people()`);
    expect(ppl.length).toBeGreaterThan(0);
    expect(ppl.some((p: any) => p.full_name === 'SYNTH Exec Four')).toBe(false);
  });
  it('documents: self and HR only; a manager handles police papers only', async () => {
    const path = `${P.e1}/aadhaar/x.pdf`;
    await as(db, A.e1, `select register_document($1,'aadhaar',$2,'x.pdf','application/pdf',1000)`, [P.e1, path]);
    await expectError(as(db, A.bm1, `select register_document($1,'aadhaar',$2,'y.pdf')`, [P.e1, `${P.e1}/aadhaar/y.pdf`]), /own documents/);
    await expectError(as(db, A.e1, `select register_document($1,'pan',$2,'z.pdf')`, [P.e1, `${P.e2}/pan/z.pdf`]), /does not match/);
    expect((await as(db, A.bm1, `select count(*)::int n from person_documents`))[0].n).toBe(0);
    expect((await as(db, A.hr, `select count(*)::int n from person_documents`))[0].n).toBe(1);
    expect((await as(db, A.oh, `select count(*)::int n from person_documents`))[0].n).toBe(0);
    await expectError(as(db, A.bm1, `select set_police_verification($1,'verified')`, [P.e1]), /certificate first/);
    await as(db, A.bm1, `select register_document($1,'police_verification',$2,'pv.pdf')`, [P.e1, `${P.e1}/police_verification/pv.pdf`]);
    expect((await as(db, A.bm1, `select count(*)::int n from person_documents`))[0].n).toBe(1);   // the police paper only
    await expectError(as(db, A.e2, `select set_police_verification($1,'applied','2026-11-10')`, [P.e1]), /managers or HR/);
    await expectError(as(db, A.bm1, `select set_police_verification($1,'not_required',null,null,null,'x')`, [P.e1]), /Only HR/);
    expect((await as(db, A.bm1, `select (set_police_verification($1,'verified')).status s`, [P.e1]))[0].s).toBe('verified');
    await expectError(as(db, A.e1, `select verify_document(id, true) from person_documents limit 1`), /Only HR/);
  });
  it('overdue police verification alarms climb the line weekly and HR gets a summary', async () => {
    await clock(db, '2026-12-20T10:00:00+05:30');
    await db.query(`select app.sync_police_verification()`);
    expect((await db.query<any>(`select count(*)::int n from tasks where kind='police_verification' and subject_id = $1 and status <> 'resolved'`, [P.e2])).rows[0].n).toBe(1);
    expect((await db.query<any>(`select count(*)::int n from tasks where kind='police_verification' and subject_id = $1 and status <> 'resolved'`, [P.e1])).rows[0].n).toBe(0);
    const n1 = (await db.query<any>(`select count(*)::int n from notifications where kind='police_verification' and message like 'OVERDUE%'`)).rows[0].n;
    await db.query(`select app.sync_police_verification()`);   // same week: no repeat
    expect((await db.query<any>(`select count(*)::int n from notifications where kind='police_verification' and message like 'OVERDUE%'`)).rows[0].n).toBe(n1);
    expect((await as(db, A.hr, `select count(*)::int n from my_tasks('open') where kind='police_verification_hr'`))[0].n).toBe(1);
    expect((await as(db, A.oh, `select count(*)::int n from tasks where kind='police_verification_hr'`))[0].n).toBe(0);
    expect((await as(db, A.bm1, `select count(*)::int n from police_status() where status <> 'verified' and overdue_days > 0`))[0].n).toBeGreaterThan(0);
    await clock(db, '2026-11-18T12:00:00+05:30');
  });
  it('the HR repository is HR / Admin only', async () => {
    const r = await as(db, A.hr, `select full_name, docs, police from hr_repository() where person_id = $1`, [P.e1]);
    expect(r[0].police).toBe('verified');
    expect(r[0].docs.aadhaar.n).toBe(1);
    await expectError(as(db, A.oh, `select * from hr_repository()`), /HR only/);
    await expectError(as(db, A.e1, `select * from hr_repository()`), /HR only/);
  });
});

describe('BI & Growth does not direct Operations (D-56)', () => {
  it('the BI role cannot assign tasks to Operations people or send alerts', async () => {
    await expectError(as(db, A.auditor, `select assign_task($1,'x')`, [[P.e1]]), /team, your peers/);
    await expectError(as(db, A.auditor, `select send_alert($1,'x')`, [[P.e1]]), /Only Admin/);
  });
});

describe('Received, Entry, rollover and the team split (D-70..D-72)', () => {
  it('Entry cannot exceed Received; closed + cancelled cannot exceed rollover + received', async () => {
    const cl = (await as(db, A.e1, `select (r->>'client_location_id') id from jsonb_array_elements((select my_day('2026-11-18')->'rows')) r limit 1`))[0].id;
    await expectError(as(db, A.e1, `select * from save_productivity('2026-11-18', $1)`, [JSON.stringify([{ client_location_id: cl, entry: 3, logged: 4, closure: 0, cancelled: 0 }])]), /cannot be more than Received/);
    await as(db, A.e1, `select * from save_productivity('2026-11-18', $1)`, [JSON.stringify([{ client_location_id: cl, entry: 5, logged: 4, closure: 1, cancelled: 0 }])]);
    const r = (await as(db, A.e1, `select r from jsonb_array_elements((select my_day('2026-11-18')->'rows')) r where r->>'client_location_id' = $1`, [cl]))[0].r;
    expect(r.entry).toBe(5); expect(r.logged).toBe(4);
    if (r.opening_pending != null) {
      await expectError(as(db, A.e1, `select * from save_productivity('2026-11-18', $1)`, [JSON.stringify([{ client_location_id: cl, entry: 5, logged: 4, closure: r.opening_pending + 6, cancelled: 0 }])]), /rollover \+ received/);
    }
  });
  it('the team split adds up', async () => {
    const b = (await as(db, A.bm1, `select team_breakdown('2026-11-01') b`))[0].b;
    const raw = (await db.query<any>(`select coalesce(sum(entry),0)::int r, coalesce(sum(closure),0)::int c, coalesce(sum(cancelled),0)::int x from productivity_lines
      where work_date between '2026-11-01' and '2026-11-18' and person_id in (select $1::uuid union select person_id from app.subtree($1, 'operations', '2026-11-18') union select person_id from app.subtree($1, 'collections', '2026-11-18'))`, [P.bm1])).rows[0];
    expect([Number(b.scope.received), Number(b.scope.closed), Number(b.scope.cancelled)]).toEqual([raw.r, raw.c, raw.x]);
    expect(Object.values(b.scope.buckets).reduce((a: number, v: any) => a + Number(v), 0)).toBe(Number(b.scope.pending));
    expect(b.hr.headcount).toBeGreaterThan(0);
    expect(b.people.some((p: any) => p.self)).toBe(true);
  });
  it('monthly receivables are a one-time entry', async () => {
    const pair = (await db.query<any>(`select branch_id, client_id from app.collection_pairs($1, '2026-11-18') where is_head limit 1`, [P.bm1])).rows[0];
    if (!pair) return;
    const row = JSON.stringify([{ ...pair, ar_lt30: 100, ar_30_90: 0, ar_90_180: 0, ar_gt180: 0 }]);
    await db.query(`update collection_ar set entered_at = app.clock() where month = '2026-11-01'`);   // as if entered earlier today
    await as(db, A.bm1, `select save_ar('2026-11-01', $1)`, [row]);
    await db.query(`update collection_ar set entered_at = app.clock() where month = '2026-11-01'`);
    await as(db, A.bm1, `select save_ar('2026-11-01', $1)`, [row]);                // same day: still editable
    await db.query(`update collection_ar set entered_at = entered_at - interval '2 days' where month = '2026-11-01'`);
    await expectError(as(db, A.bm1, `select save_ar('2026-11-01', $1)`, [row]), /already set/);
  });
});
