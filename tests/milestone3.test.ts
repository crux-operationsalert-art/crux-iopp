// Attendance & leave, manager roll-up, bulk upload, daily tracker import. Synthetic data only.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, clock, expectError, freshDb } from './db';
import { A, M, P, seed } from './fixtures';

let db: PGlite;
const D = '2026-11-10';
beforeAll(async () => { db = await freshDb(); await seed(db); });

describe('Attendance', () => {
  it('check-in is retired for users (attendance comes from reporting, milestone 4); the stored rule still works for service use', async () => {
    await clock(db, `${D}T09:58:00+05:30`);
    await expectError(as(db, A.e1, `select status from check_in()`), /permission denied/);
    const svc = async (uid: string, sql: string) => { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: uid })]); return (await db.query<any>(sql)).rows; };
    expect((await svc(A.e1, `select status from check_in()`))[0].status).toBe('present');
    await clock(db, `${D}T10:40:00+05:30`);
    expect((await svc(A.e2, `select status, minutes_late from check_in()`))[0]).toEqual({ status: 'late', minutes_late: 40 });
    await clock(db, `${D}T13:00:00+05:30`);
    expect((await svc(A.e2, `select status from check_out()`))[0].status).toBe('half_day');
  });
  it('a manager marks a direct report absent with a reason; not someone else\'s report', async () => {
    await as(db, A.bm1, `select * from set_attendance($1,$2,'absent','No show, phone off')`, [P.e1, '2026-11-09']);
    await expectError(as(db, A.bm1, `select * from set_attendance($1,$2,'absent','x')`, [P.e3, '2026-11-09']), /direct reports/);
    await expectError(as(db, A.bm1, `select * from set_attendance($1,$2,'absent','')`, [P.e1, '2026-11-09']), /reason/);
  });
  it('leave: request → manager approves → attendance marked; shrinkage and unplanned streak counted', async () => {
    const lr = await as(db, A.e1, `select id, short_notice from request_leave('2026-11-11','2026-11-12','planned','personal','Family function')`);
    expect(lr[0].short_notice).toBe(true);
    await expectError(as(db, A.e1, `select * from decide_leave($1, true)`, [lr[0].id]), /manager/);
    await as(db, A.bm1, `select * from decide_leave($1, true, 'OK')`, [lr[0].id]);
    await as(db, A.bm1, `select * from set_attendance($1,'2026-11-06','absent','No show')`, [P.e1]);
    await as(db, A.bm1, `select * from set_attendance($1,'2026-11-07','absent','No show')`, [P.e1]);
    await clock(db, '2026-11-12T18:00:00+05:30');
    const s = await as(db, A.bm1, `select full_name, planned_leave, absent, unplanned_streak from attendance_summary('2026-11-02','2026-11-12') where person_id=$1`, [P.e1]);
    expect(s[0]).toMatchObject({ planned_leave: 2, absent: 3, unplanned_streak: 3 });   // 6, 7, 9 Nov — Sunday skipped (D-10)
    expect((await as(db, A.e3, `select count(*)::int n from attendance where person_id=$1`, [P.e1]))[0].n).toBe(0);   // peer cannot see
  });
});

describe('Manager roll-up beside own entry', () => {
  it('certify_team_detail requires a reason when certified figures differ from team + own', async () => {
    await clock(db, `${D}T18:00:00+05:30`);
    const rows = (cl: string, e: number, c: number, x: number) => JSON.stringify([{ client_location_id: cl, entry: e, closure: c, cancelled: x }]);
    await as(db, A.e1, `select * from save_productivity($1,$2)`, [D, JSON.stringify([{ client_location_id: M.cl1, entry: 5, closure: 3, cancelled: 1 }, { client_location_id: M.cl2, entry: 0, closure: 0, cancelled: 0 }])]);
    await as(db, A.e1, `select * from submit_day($1)`, [D]);
    await as(db, A.e2, `select * from save_productivity($1,$2)`, [D, rows(M.cl1, 2, 2, 0)]);
    await as(db, A.e2, `select * from submit_day($1)`, [D]);
    await as(db, A.bm1, `select * from save_productivity($1,$2)`, [D, rows(M.cl2, 1, 0, 0)]);
    await as(db, A.bm1, `select * from submit_day($1)`, [D]);
    const team = await as(db, A.bm1, `select client, entry::int, closure::int from day_report($1,'team') order by client`, [D]);
    expect(team).toEqual([{ client: 'SYNTH-BOM', entry: 7, closure: 5 }, { client: 'SYNTH-SBI', entry: 0, closure: 0 }]);
    await expectError(as(db, A.bm1, `select * from certify_team_detail($1,'operations','{"entry":9,"closure":5,"cancelled":1}')`, [D]), /differ.*reason/);
    const c = await as(db, A.bm1, `select certified_value::int v, certified_detail, reason from certify_team_detail($1,'operations','{"entry":9,"closure":5,"cancelled":1}','One late case')`, [D]);
    expect(c[0].v).toBe(13); expect(c[0].reason).toMatch(/One late case \[entry 9 vs 8\]/);
  });
});

describe('Leader team list', () => {
  it('a branch manager sees only their subtree; an executive sees nobody; admin sees everyone', async () => {
    const bm = await as(db, A.bm1, `select full_name, manager_name from my_team_people()`);
    const names = bm.map((r: any) => r.full_name);
    expect(names.length).toBeGreaterThan(0);
    expect(bm.every((r: any) => r.manager_name)).toBe(true);
    const zm = await as(db, A.zm1, `select person_id from my_team_people()`);
    expect(zm.map((r: any) => r.person_id)).toEqual(expect.arrayContaining([P.bm1, P.e1]));
    expect(zm.map((r: any) => r.person_id)).not.toContain(P.e4);
    expect((await as(db, A.e1, `select count(*)::int n from my_team_people()`))[0].n).toBe(0);
    expect((await as(db, A.admin, `select count(*)::int n from my_team_people()`))[0].n).toBeGreaterThan(zm.length);
  });
});

describe('Bulk upload', () => {
  it('check run writes nothing; errors are row-level; a clean file applies all rows', async () => {
    await clock(db, '2026-11-12T12:00:00+05:30');
    const ppl = [{ full_name: 'SYNTH Bulk One', mobile: '7700001001', email: 'b1@synth.test', designation: 'Executive', role: 'executive', reports_to_mobile: '' },
                 { full_name: 'SYNTH Bulk Two', mobile: '7700001002', email: 'b2@synth.test', designation: 'Executive', role: 'nonsense' }];
    await db.exec(`update persons set mobile='7700000555' where id='${P.bm1}'`);
    ppl[0].reports_to_mobile = '7700000555';
    const bad = (await as(db, A.admin, `select bulk_import('people',$1,false) j`, [JSON.stringify(ppl)]))[0].j;
    expect(bad.applied).toBe(false); expect(bad.errors[0].row).toBe(2);
    expect((await db.query<any>(`select count(*)::int n from persons where full_name like 'SYNTH Bulk%'`)).rows[0].n).toBe(0);
    const chk = (await as(db, A.admin, `select bulk_import('people',$1,true) j`, [JSON.stringify([ppl[0]])]))[0].j;
    expect(chk).toMatchObject({ ok: 1, applied: false });
    const ok = (await as(db, A.admin, `select bulk_import('people',$1,false) j`, [JSON.stringify([ppl[0]])]))[0].j;
    expect(ok.applied).toBe(true);
    const al = (await as(db, A.admin, `select bulk_import('allocations',$1,false) j`,
      [JSON.stringify([{ mobile: '7700001001', client: 'SSBI', location: 'SPUN', process: 'RV', valid_from: '12-11-2026' }])]))[0].j;
    expect(al).toMatchObject({ applied: true });
    const rt = (await as(db, A.admin, `select bulk_import('rates',$1,false) j`,
      [JSON.stringify([{ client: 'SYNTH-SBI', location: 'SYNTH Pune', process: 'RV', rate: 999, valid_from: '2026-12-01' }])]))[0].j;
    expect(rt.applied).toBe(true);   // supersedes: the open-ended 225 rate now ends 30 Nov
    expect((await db.query<any>(`select upper(valid)::text u from rate_cards where rate=225`)).rows[0].u).toBe('2026-12-01');
    await expectError(as(db, A.bm1, `select bulk_import('zones','[]',true)`), /Only Admin/);
  });
  it('every upload type runs clean with its template example', async () => {
    const ex: Record<string, any[]> = {
      zones: [{ name: 'SYNTH Zone B', region: 'West' }],
      branches: [{ name: 'SYNTH Branch B', type: 'own', state: 'MH', city: 'Pune', zone: 'SZ1', valid_from: '2026-11-01' }],
      locations: [{ name: 'SYNTH Loc B', city: 'Pune', state: 'MH' }],
      clients: [{ name: 'SYNTH Client B', family: 'SYNTH' }],
      services: [{ client: 'SYNTH-BOM', location: 'SYNTH Kolkata', process: 'RV', branch: 'SB3', valid_from: '2026-11-01' }],
      rates: [{ client: 'SYNTH-SBI', location: 'SYNTH Nashik', process: 'RV', earns_on: 'entry', rate: 300, valid_from: '2026-11-01' }],
      allocations: [{ mobile: '7700001001', client: 'SYNTH-BOM', location: 'SYNTH Pune', process: 'RV', function: 'operations', valid_from: '2026-11-12' }],
      targets: [{ month: '2026-12', metric: 'entry', level: 'zone', amount: 500, zone: 'SZ1', reason: 'plan' }],
      holidays: [{ date: '25-12-2026', name: 'Christmas', scope: 'national' }],
      partner_ratios: [{ branch: 'SB2', partner_pct: 80, valid_from: '2026-12-01', agreement_ref: 'SYNTH-AG', reason: 'agreement' }],
      wip_openings: [{ mobile: '7700001001', client: 'SYNTH-SBI', location: 'SYNTH Pune', valid_from: '2026-11-12', opening: 4, reason: 'count' }],
    };
    for (const [k, rows] of Object.entries(ex)) {
      const j = (await as(db, A.admin, `select bulk_import($1,$2,true) j`, [k, JSON.stringify(rows)]))[0].j;
      expect({ k, errors: j.errors }).toEqual({ k, errors: [] });
    }
    // dry runs leave nothing behind
    expect((await db.query<any>(`select count(*)::int n from zones where name='SYNTH Zone B'`)).rows[0].n).toBe(0);
  });
});

describe('Daily tracker import → Revenue Status data', () => {
  it('imports two days; status data carries previous MTD for the day\'s addition', async () => {
    const row = (mtd: number, rev: number) => ({ zone: 'SYNTH Zone Q', region: 'West', location: 'SYNTH Loc Q', client: 'SYNTH Client Q',
      stakeholder: 'SYNTH Stake', target_cases: 100, revenue_target: 75000, mtd_cases: mtd, mtd_revenue: rev, reported_added: 2, source_row: 7 });
    await as(db, A.admin, `select import_tracker_day('2026-11-09','t.xlsx',$1)`, [JSON.stringify([row(10, 7500)])]);
    await as(db, A.admin, `select import_tracker_day('2026-11-10','t.xlsx',$1)`, [JSON.stringify([row(14, 10500)])]);
    const d = (await as(db, A.admin, `select revenue_status_data('2026-11-10') j`))[0].j;
    expect((await as(db, A.e1, `select revenue_status_data('2026-11-10') j`))[0].j.rows ?? []).toEqual([]);   // not their location (D-52)
    expect(d.prev_as_of).toBe('2026-11-09');
    expect(d.rows[0]).toMatchObject({ mtd_revenue: 10500, prev_revenue: 7500, stakeholder: 'SYNTH Stake' });
    const rc = await db.query<any>(`select rate::int from rate_cards where reason like 'Zonal Tracker 2026-11-09%'`);
    expect(rc.rows[0].rate).toBe(750);
    await expectError(as(db, A.zm1, `select import_tracker_day('2026-11-10','t',$1)`, [JSON.stringify([row(1, 1)])]), /Only Admin/);
    expect((await as(db, A.e1, `select revenue_status_data('2026-11-10') j`))[0].j.rows).toEqual([]);
  });
});
