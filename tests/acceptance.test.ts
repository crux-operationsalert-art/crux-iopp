// SOW §18 acceptance scenarios + Master §20 Stage 3/9 access tests. Synthetic data only.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, clock, expectError, freshDb } from './db';
import { A, M, P, seed } from './fixtures';

let db: PGlite;
const D = '2026-11-10';                      // a Tuesday
const rows = (...r: [string, number, number, number][]) =>
  JSON.stringify(r.map(([c, e, cl, x]) => ({ client_location_id: c, entry: e, closure: cl, cancelled: x })));

beforeAll(async () => {
  db = await freshDb();
  await seed(db);
  await clock(db, `${D}T18:00:00+05:30`);
});

describe('S1/S5 executive daily entry', () => {
  it('saves two client rows separately; own total = sum; draft is not submitted', async () => {
    await as(db, A.e1, `select * from save_productivity($1, $2)`, [D, rows([M.cl1, 12, 9, 2], [M.cl2, 5, 4, 0])]);
    const r = await as(db, A.e1, `select sum(net_actioned)::int net, count(*)::int n from v_line_metrics where work_date=$1`, [D]);
    expect(r[0]).toEqual({ net: 19 + 9, n: 2 });
    const s = await as(db, A.e1, `select status from day_status where work_date=$1`, [D]);
    expect(s[0].status).toBe('draft');
  });
  it('rejects a client/location not allocated to the person (ID tampering)', async () => {
    await expectError(as(db, A.e1, `select * from save_productivity($1,$2)`, [D, rows([M.cl3, 1, 0, 0])]), /not allocated/);
  });
  it('rejects fractional and negative counts', async () => {
    await expectError(as(db, A.e1, `select * from save_productivity($1,$2)`, [D, rows([M.cl1, 1.5, 0, 0])]), /whole numbers/);
    await expectError(as(db, A.e1, `select * from save_productivity($1,$2)`, [D, rows([M.cl1, -1, 0, 0])]), /check constraint/);
  });
  it('cannot submit while an allocated row is missing; zero is a valid submission (S5)', async () => {
    await expectError(as(db, A.e2, `select * from submit_day($1)`, [D]), /no figures/);
    await as(db, A.e2, `select * from save_productivity($1,$2)`, [D, rows([M.cl1, 0, 0, 0])]);
    const s = await as(db, A.e2, `select status, late from submit_day($1)`, [D]);
    expect(s[0]).toEqual({ status: 'submitted', late: false });
  });
  it('duplicate submit is a no-op; submitted day is locked for edits', async () => {
    await as(db, A.e1, `select * from submit_day($1)`, [D]);
    const again = await as(db, A.e1, `select revision from submit_day($1)`, [D]);
    expect(again[0].revision).toBe(0);
    await expectError(as(db, A.e1, `select * from save_productivity($1,$2)`, [D, rows([M.cl1, 99, 0, 0])]), /already submitted/);
  });
  it('an executive sees only their own lines', async () => {
    const r = await as(db, A.e1, `select distinct person_id from productivity_lines`);
    expect(r.map((x: any) => x.person_id)).toEqual([P.e1]);
  });
  it('cannot write tables directly (no write policy / grant)', async () => {
    await expectError(as(db, A.e1, `insert into productivity_lines(person_id,work_date,client_location_id) values ($1,$2,$3)`,
      [P.e1, '2026-11-09', M.cl1]), /permission denied|row-level security/);
    await expectError(as(db, A.e1, `update day_status set status='submitted' where person_id=$1`, [P.e2]), /permission denied/);
  });
});

describe('S6/S7/S2 manager gate, on-behalf entry, roll-up and certification', () => {
  it('cannot act for someone outside the direct line', async () => {
    await expectError(as(db, A.bm1, `select * from save_productivity($1,$2,$3,'x')`, [D, rows([M.cl3, 1, 1, 0]), P.e3]), /direct reports/);
    await expectError(as(db, A.zm1, `select * from save_productivity($1,$2,$3,'x')`, [D, rows([M.cl1, 1, 1, 0]), P.e1]), /direct reports/);
  });
  it('blocks certification while BM own figures or team are unresolved', async () => {
    await expectError(as(db, A.zm1, `select * from certify_team($1)`, [D]), /Waiting on: .*SYNTH BA Nashik.*SYNTH BM Pune|Waiting on: .*SYNTH BM Pune/);
    await expectError(as(db, A.bm1, `select * from certify_team($1)`, [D]), /own contribution/);
  });
  it('on-behalf entry needs a reason and is labelled, and the employee is notified', async () => {
    await expectError(as(db, A.ba1, `select * from save_productivity($1,$2,$3)`, [D, rows([M.cl3, 10, 0, 0]), P.e3]), /reason is required/);
    await as(db, A.ba1, `select * from save_productivity($1,$2,$3,'Field visit, no phone signal')`, [D, rows([M.cl3, 10, 0, 0]), P.e3]);
    const ds = await as(db, A.ba1, `select status from submit_day($1,$2,'Field visit, no phone signal')`, [D, P.e3]);
    expect(ds[0].status).toBe('manager_entered');
    const l = await as(db, A.e3, `select source, entered_by from productivity_lines where work_date=$1`, [D]);
    expect(l[0]).toEqual({ source: 'on_behalf', entered_by: P.ba1 });
    const n = await as(db, A.e3, `select kind from notifications`);
    expect(n.map((x: any) => x.kind)).toContain('manager_entry');
  });
  it('team roll-up counts each line once; own contribution is separate; variance needs a reason', async () => {
    await as(db, A.bm1, `select * from save_productivity($1,$2)`, [D, rows([M.cl2, 3, 2, 0])]);
    await as(db, A.bm1, `select * from submit_day($1)`, [D]);
    await expectError(as(db, A.bm1, `select * from certify_team($1,'operations',999)`, [D]), /Give a reason/);
    const c = await as(db, A.bm1, `select team_totals, own_totals, calculated_total::int calc, variance from certify_team($1)`, [D]);
    expect(c[0].team_totals.net).toBe(28);           // E1 28 + E2 0
    expect(c[0].own_totals.net).toBe(5);
    expect(c[0].calc).toBe(33);
    expect(c[0].variance).toBeNull();
    await expectError(as(db, A.bm1, `select * from certify_team($1)`, [D]), /already certified/);
  });
  it('ZM certifies only after BA certifies; ZM roll-up includes all levels exactly once', async () => {
    await expectError(as(db, A.zm1, `select * from certify_team($1)`, [D]), /SYNTH BA Nashik \(team not certified\)/);
    await as(db, A.ba1, `select * from certify_team($1)`, [D]);
    const c = await as(db, A.zm1, `select team_totals from certify_team($1,'operations',44,'BM reported one late case')`, [D]);
    expect(c[0].team_totals.net).toBe(28 + 0 + 5 + 10);  // e1+e2+bm1+e3
  });
  it('absent / non-operational needs a reason and resolves the gate (S6)', async () => {
    await expectError(as(db, A.zm2, `select * from set_member_status($1,$2,'absent','')`, [P.e4, D]), /reason is required/);
    await as(db, A.zm2, `select * from set_member_status($1,$2,'absent','Sick, informed by phone')`, [P.e4, D]);
    const t = await as(db, A.zm2, `select status, resolved from team_status($1)`, [D]);
    expect(t[0]).toEqual({ status: 'absent', resolved: true });
  });
});

describe('S8/S9 submission window, grace and Admin reopen', () => {
  const D2 = '2026-11-11';
  it('accepts during grace (flagged late), refuses after 10:00 and refuses future dates', async () => {
    await clock(db, `${D2}T12:00:00+05:30`);
    await expectError(as(db, A.e1, `select * from save_productivity($1,$2)`, ['2026-11-12', rows([M.cl1, 1, 0, 0])]), /future date/);
    await as(db, A.e1, `select * from save_productivity($1,$2)`, [D2, rows([M.cl1, 1, 1, 0], [M.cl2, 0, 0, 0])]);
    await clock(db, '2026-11-12T09:59:00+05:30');
    const s = await as(db, A.e1, `select late from submit_day($1)`, [D2]);
    expect(s[0].late).toBe(true);
    await clock(db, '2026-11-12T10:00:00+05:30');
    await expectError(as(db, A.e2, `select * from save_productivity($1,$2)`, [D2, rows([M.cl1, 1, 0, 0])]), /window .* is closed/);
  });
  it('only Admin reopens, for a specific person and date; the reopen is audited', async () => {
    await expectError(as(db, A.oh, `select * from grant_reopen('submission',$1,'x',now()+interval '1 day',$2)`, [P.e2, D2]), /Only an Admin/);
    await as(db, A.admin, `select * from grant_reopen('submission',$1,'Network outage at branch','2026-11-12T18:00:00+05:30',$2)`, [P.e2, D2]);
    await as(db, A.e2, `select * from save_productivity($1,$2)`, [D2, rows([M.cl1, 2, 1, 0])]);
    await expectError(as(db, A.e3, `select * from save_productivity($1,$2)`, [D2, rows([M.cl3, 1, 0, 0])]), /closed/);
    const a = await as(db, A.admin, `select reason from audit_events where table_name='reopen_grants'`);
    expect(a[0].reason).toBe('Network outage at branch');
  });
});

describe('S10 target cascade and lock', () => {
  it('locks at the end of the 5th working day, skipping Sundays and holidays', async () => {
    const r = await db.query<{ t: string }>(`select to_char(app.target_lock_at('2026-11-01') at time zone 'Asia/Kolkata','YYYY-MM-DD HH24:MI') t`);
    expect(r.rows[0].t).toBe('2026-11-07 00:00');          // working days 2,3,4,5,6
    await db.exec(`insert into holidays(holiday_date,name,scope) values ('2026-11-04','SYNTH holiday','national')`);
    const r2 = await db.query<{ t: string }>(`select to_char(app.target_lock_at('2026-11-01') at time zone 'Asia/Kolkata','YYYY-MM-DD HH24:MI') t`);
    expect(r2.rows[0].t).toBe('2026-11-08 00:00');         // 2,3,5,6,7 — Saturday is a working day (D-08)
    await db.exec(`delete from holidays where name='SYNTH holiday'`);
  });
  it('cascades top-down within authority; versions are kept; locked after window', async () => {
    await clock(db, '2026-12-02T12:00:00+05:30');
    await as(db, A.oh, `select * from set_target('2026-12-01','revenue','zone',500000,$1)`, [M.z1]);
    await expectError(as(db, A.zm1, `select * from set_target('2026-12-01','revenue','zone',1,$1)`, [M.z1]), /not allowed/);
    await as(db, A.zm1, `select * from set_target('2026-12-01','revenue','branch',300000,null,$1)`, [M.b1]);
    await expectError(as(db, A.zm2, `select * from set_target('2026-12-01','revenue','branch',1,null,$1)`, [M.b1]), /not allowed/);
    await as(db, A.bm1, `select * from set_target('2026-12-01','revenue','person',15000,null,null,$1)`, [P.e1]);
    await as(db, A.bm1, `select * from set_target('2026-12-01','revenue','person',16000,null,null,$1)`, [P.e1]);
    await expectError(as(db, A.bm1, `select * from set_target('2026-12-01','revenue','person',1,null,null,$1,$2)`, [P.e1, M.cBOM]), /one style only/);
    await expectError(as(db, A.bm1, `select * from set_target('2026-12-01','revenue','person',1,null,null,$1)`, [P.e3]), /not allowed/);
    const v = await db.query(`select amount::int, version, is_current from target_allocations where person_id=$1 order by version`, [P.e1]);
    expect(v.rows).toEqual([{ amount: 15000, version: 1, is_current: false }, { amount: 16000, version: 2, is_current: true }]);
    await clock(db, '2026-12-08T09:00:00+05:30');   // Dec: 1,2,3,4,5 working → locked from 6 Dec 00:00
    await expectError(as(db, A.bm1, `select * from set_target('2026-12-01','revenue','person',17000,null,null,$1)`, [P.e1]), /locked/);
    await expectError(as(db, A.admin, `select * from set_target('2026-12-01','revenue','person',17000,null,null,$1)`, [P.e1]), /reason is required/);
    const t = await as(db, A.admin, `select after_lock from set_target('2026-12-01','revenue','person',17000,null,null,$1,null,'Client volume revised')`, [P.e1]);
    expect(t[0].after_lock).toBe(true);
    const chk = await as(db, A.oh, `select unallocated::int from v_target_allocation_check where zone_id=$1`, [M.z1]);
    expect(chk[0].unallocated).toBe(200000);
  });
});

describe('S11/S12 rate cards and revenue', () => {
  it('uses the rate in effect on the work date; partner ratio is not used in revenue (D-04)', async () => {
    await clock(db, '2026-10-28T12:00:00+05:30');
    await as(db, A.e1, `select * from save_productivity($1,$2)`, ['2026-10-28', rows([M.cl1, 0, 9, 0], [M.cl2, 0, 0, 0])]);
    const oct = await as(db, A.e1, `select rate::int, revenue::int from v_line_metrics where work_date='2026-10-28' and client_location_id=$1`, [M.cl1]);
    expect(oct[0]).toEqual({ rate: 750, revenue: 6750 });
    const nov = await as(db, A.e1, `select rate::int, revenue::int from v_line_metrics where work_date=$1 and client_location_id=$2`, [D, M.cl1]);
    expect(nov[0]).toEqual({ rate: 800, revenue: 7200 });
    const p = await as(db, A.ba1, `select revenue::int from v_line_metrics where person_id=$1 and work_date=$2`, [P.e3, D]);
    expect(p[0]).toEqual({ revenue: 5000 });
  });
  it('rejects overlapping rates and changes that touch a closed month', async () => {
    await expectError(db.exec(`insert into rate_cards(client_id,location_id,process_id,billable_event,rate,valid,reason)
      values ('${M.cSBI}','${M.lPune}','${M.pRV}','closure',230,'[2026-12-01,)','x')`), /conflicting key value violates exclusion/);
    await db.exec(`insert into closed_periods(month) values ('2026-10-01')`);
    await expectError(db.exec(`update rate_cards set rate = 999 where rate = 750`), /closed month/);
    const oct = await as(db, A.e1, `select revenue::int from v_line_metrics where work_date='2026-10-28' and client_location_id=$1`, [M.cl1]);
    expect(oct[0].revenue).toBe(6750);
  });
  it('only Admin maintains rate cards through the API', async () => {
    await expectError(as(db, A.oh, `update rate_cards set rate = 1 where rate = 225 returning id`).then((r) => {
      if (r.length === 0) throw new Error('row-level security: no rows'); }), /row-level security|permission denied/);
  });
});

describe('S13 cancellation and WIP', () => {
  it('cancellation reduces net actioned and closing WIP on the cancellation date', async () => {
    await db.exec(`insert into wip_openings(person_id,client_location_id,as_of,opening,reason)
                   values ('${P.e1}','${M.cl1}','2026-11-10',40,'SYNTH seed')`);
    const w = await as(db, A.e1, `select opening_wip, closing_wip, seeded from v_wip where work_date=$1 and client_location_id=$2`, [D, M.cl1]);
    expect(w[0]).toEqual({ opening_wip: 40, closing_wip: 41, seeded: true });   // 40 + 12 − 9 − 2
    const w2 = await as(db, A.e1, `select opening_wip, closing_wip from v_wip where work_date='2026-11-11' and client_location_id=$1`, [M.cl1]);
    expect(w2[0]).toEqual({ opening_wip: 41, closing_wip: 41 });                // +1 −1 −0
  });
});

describe('S14/S15/S3/S4 collections, bills and the Collections Head scope', () => {
  it('received 100,000 / reconciled 80,000 shows 20,000 unreconciled', async () => {
    await clock(db, `${D}T19:00:00+05:30`);
    const c = await as(db, A.e1, `select recon_status from save_collection($1,$2,100000,80000)`, [D, M.cSBI]);
    expect(c[0].recon_status).toBe('partially_reconciled');
    const v = await as(db, A.ch, `select unreconciled::int from v_collections where person_id=$1`, [P.e1]);
    expect(v[0].unreconciled).toBe(20000);
  });
  it('bills stay separate from collections and revenue', async () => {
    await as(db, A.e1, `select * from save_bill($1,$2,3,45000)`, [D, M.cSBI]);
    const r = await as(db, A.ch, `select received::int, reconciled::int, unreconciled::int, bill_count::int, bill_amount::int, outstanding::int
                                  from collections_summary($1,$1,'person')`, [D]);
    expect(r[0]).toEqual({ received: 100000, reconciled: 80000, unreconciled: 20000, bill_count: 3, bill_amount: 45000, outstanding: -55000 });
  });
  it('Collections Head sees collections but no case-level operations, audit or penalties', async () => {
    expect((await as(db, A.ch, `select count(*)::int n from productivity_lines`))[0].n).toBe(0);
    expect((await as(db, A.ch, `select count(*)::int n from audit_events`))[0].n).toBe(0);
    expect((await as(db, A.ch, `select count(*)::int n from penalty_ledger`))[0].n).toBe(0);
    expect((await as(db, A.ch, `select count(*)::int n from collection_entries`))[0].n).toBe(1);
  });
  it('a dual-function employee has a separate collections gate (S3)', async () => {
    await expectError(as(db, A.ch, `select * from certify_team($1,'collections')`, [D]), /SYNTH Exec One \(pending\)/);
    await as(db, A.e1, `select * from submit_collections_day($1)`, [D]);
    const c = await as(db, A.ch, `select calculated_total::int t from certify_team($1,'collections')`, [D]);
    expect(c[0].t).toBe(100000);
  });
  it('BM (operations line) does not see E1 collections; ZM2 sees nothing of zone West', async () => {
    expect((await as(db, A.bm1, `select count(*)::int n from collection_entries`))[0].n).toBe(0);
    expect((await as(db, A.zm2, `select count(*)::int n from productivity_lines where person_id in ($1,$2)`, [P.e1, P.e2]))[0].n).toBe(0);
  });
});

describe('Penalty ledger (D-11)', () => {
  it('direct report only, no duplicates, no payroll effect, visible to the employee but not peers', async () => {
    await expectError(as(db, A.bm1, `select * from propose_penalty($1,'MISSED_REPORT',$2,'late')`, [P.e3, D]), /direct reports/);
    await as(db, A.bm1, `select * from propose_penalty($1,'MISSED_REPORT',$2,'No report by 10:00')`, [P.e2, '2026-11-11']);
    await expectError(as(db, A.bm1, `select * from propose_penalty($1,'MISSED_REPORT',$2,'again')`, [P.e2, '2026-11-11']), /already exists/);
    await expectError(db.exec(`update penalty_ledger set payroll_effect = true`), /check constraint/);
    expect((await as(db, A.e2, `select count(*)::int n from penalty_ledger`))[0].n).toBe(1);
    expect((await as(db, A.e1, `select count(*)::int n from penalty_ledger`))[0].n).toBe(0);
    const ap = await as(db, A.e2, `select status from respond_penalty((select id from penalty_ledger limit 1), true, 'Reopen was granted')`);
    expect(ap[0].status).toBe('disputed');
    await expectError(as(db, A.bm1, `select * from decide_penalty((select id from penalty_ledger limit 1),'approved','x')`), /Only Admin or HR/);
  });
});

describe('S18/S19/S21 transfers, exits, tampering', () => {
  it('a transfer keeps prior-period ownership with the old manager', async () => {
    await db.exec(`update reporting_lines set valid = daterange(lower(valid), '2026-11-15') where person_id='${P.e2}' and function='operations';
                   insert into reporting_lines(person_id,manager_id,function,valid) values ('${P.e2}','${P.ba1}','operations','[2026-11-15,)')`);
    expect((await as(db, A.bm1, `select count(*)::int n from productivity_lines where person_id=$1 and work_date=$2`, [P.e2, D]))[0].n).toBe(1);
    expect((await as(db, A.ba1, `select count(*)::int n from productivity_lines where person_id=$1 and work_date=$2`, [P.e2, D]))[0].n).toBe(0);
    const ok = await db.query(`select app.is_direct_report($1,'operations','2026-11-20') x`, [P.e2]);
    expect(ok.rows).toBeDefined();
  });
  it('a reporting cycle is refused', async () => {
    await expectError(db.exec(`insert into reporting_lines(person_id,manager_id,function,valid) values ('${P.oh}','${P.e1}','operations','[2026-11-01,)')`), /Reporting cycle/);
  });
  it('an exited person loses access immediately; history remains for managers', async () => {
    await as(db, A.admin, `select deactivate_person($1,'2026-11-12','Resigned')`, [P.e4]);
    expect((await as(db, A.e4, `select count(*)::int n from persons`))[0].n).toBe(0);
    expect((await as(db, A.e4, `select whoami() w`))[0].w).toBeNull();
    expect((await as(db, A.zm2, `select count(*)::int n from day_status where person_id=$1`, [P.e4]))[0].n).toBe(1);
  });
  it('anonymous callers can do nothing', async () => {
    await expectError(as(db, null, `select count(*) from persons`), /permission denied/);
    await expectError(as(db, null, `select * from submit_day('2026-11-10')`), /permission denied/);
  });
  it('audit records are append-only even for admins', async () => {
    await expectError(as(db, A.admin, `delete from audit_events`), /permission denied|cannot be changed/);
    await expectError(db.exec(`update audit_events set reason='x'`), /cannot be changed/);
  });
});

describe('Dashboards and invitations', () => {
  it('ops_rollup respects RLS and groups by zone', async () => {
    const oh = await as(db, A.oh, `select label, net_actioned::int n from ops_rollup($1,$1,'zone')`, [D]);
    expect(oh).toEqual([{ label: 'SYNTH West', n: 43 }]);
    const bm = await as(db, A.bm1, `select sum(net_actioned)::int n from ops_rollup($1,$1,'person')`, [D]);
    expect(bm[0].n).toBe(33);
  });
  it('target_progress: N/A on zero target, remaining and labelled projection', async () => {
    await clock(db, '2026-11-02T11:00:00+05:30');
    await as(db, A.bm1, `select * from set_target('2026-11-01','net_actioned','person',0,null,null,$1)`, [P.e1]);
    const r = await as(db, A.e1, `select target::int, achievement_pct from target_progress('2026-11-01')`);
    expect(r[0]).toEqual({ target: 0, achievement_pct: null });
  });
  it('invitation expires after 48 working hours and claim links the verified email', async () => {
    await clock(db, '2026-11-07T15:00:00+05:30');   // Saturday 15:00 → 9h Sat, skip Sun, 24h Mon, 15h Tue
    await as(db, A.admin, `select * from create_team_member('SYNTH New Joiner','new@synth.test',null,'own_employee','Executive','executive',$1)`, [P.bm1]);
    const r = await db.query<{ t: string }>(`select to_char(invite_expires_at at time zone 'Asia/Kolkata','YYYY-MM-DD HH24:MI') t from persons where personal_email='new@synth.test'`);
    expect(r.rows[0].t).toBe('2026-11-10 15:00');
    const uid = '00000000-0000-0000-0000-00000000aaaa';
    await db.query(`insert into auth.users(id,email) values ($1,'NEW@synth.test')`, [uid]);
    const c = await as(db, uid, `select claim_my_person() id`);
    expect(c[0].id).not.toBeNull();
    expect((await as(db, uid, `select whoami()->>'full_name' n`))[0].n).toBe('SYNTH New Joiner');
  });
  it('a BM cannot create admins or people outside their team', async () => {
    await expectError(as(db, A.bm1, `select * from create_team_member('X','x@synth.test',null,'own_employee','X','admin',$1)`, [P.bm1]), /Only Admin\/HR/);
    await expectError(as(db, A.bm1, `select * from create_team_member('X','x@synth.test',null,'own_employee','X','executive',$1)`, [P.ba1]), /inside your own team/);
  });
});
