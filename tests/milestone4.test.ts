// Location heads, self-service clients, manager correction, automatic attendance, tool-built Zonal Tracker,
// target copy, settings. Synthetic data only.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, clock, expectError, freshDb } from './db';
import { A, M, P, seed } from './fixtures';

let db: PGlite;
const D = '2026-11-10';   // Tuesday
beforeAll(async () => { db = await freshDb(); await seed(db); await clock(db, `${D}T12:00:00+05:30`); });

describe('Location heads', () => {
  it('Admin sets heads; a client-specific head wins over the general one; a new head ends the old one', async () => {
    await expectError(as(db, A.zm1, `select * from set_location_head($1,$2,'zonal_manager')`, [M.b1, P.zm1]), /Admin/);
    await as(db, A.admin, `select * from set_location_head($1,$2,'zonal_manager',null,'2026-11-01','from file')`, [M.b1, P.zm1]);
    await as(db, A.admin, `select * from set_location_head($1,$2,'branch_head',null,'2026-11-01','general')`, [M.b1, P.bm1]);
    await as(db, A.admin, `select * from set_location_head($1,$2,'branch_head',$3,'2026-11-01','BOM only')`, [M.b1, P.ba1, M.cBOM]);
    const h = await db.query<any>(`select app.head_of($1,$2,'branch_head','2026-11-10') bom, app.head_of($1,$3,'branch_head','2026-11-10') sbi`, [M.b1, M.cBOM, M.cSBI]);
    expect(h.rows[0]).toEqual({ bom: P.ba1, sbi: P.bm1 });
    await as(db, A.admin, `select * from set_location_head($1,$2,'zonal_manager',null,'2026-11-05','reassigned')`, [M.b1, P.oh]);
    const z = await db.query<any>(`select person_id, upper(valid)::text u from location_heads where branch_id=$1 and head_role='zonal_manager' order by lower(valid)`, [M.b1]);
    expect(z.rows).toEqual([{ person_id: P.zm1, u: '2026-11-05' }, { person_id: P.oh, u: null }]);
  });
});

describe('Self-service clients', () => {
  it('a person sees every client with their active ones first and can tick / untick; a manager can for the team with a reason', async () => {
    const s = await as(db, A.e1, `select client_location_id, active from my_services()`);
    expect(s.length).toBe(2);                                                    // only clients at their own / their manager's locations (D-52)
    expect(s.every((r: any) => r.active)).toBe(true);
    await expectError(as(db, A.e1, `select set_service_active($1,true) r`, [M.cl3]), /not assigned to you/);
    expect(await as(db, A.admin, `select set_service_active($1,true,$2,'SYNTH cover') r`, [M.cl3, P.e1])).toEqual([{ r: 'active' }]);
    expect((await as(db, A.e1, `select count(*)::int n from my_services() where active`))[0].n).toBe(3);
    expect(await as(db, A.e1, `select set_service_active($1,false) r`, [M.cl3])).toEqual([{ r: 'inactive' }]);   // ticked today, nothing entered: gone at once (D-47)
    expect((await as(db, A.e1, `select count(*)::int n from my_services() where active`))[0].n).toBe(2);
    expect(await as(db, A.admin, `select set_service_active($1,true,$2,'SYNTH cover') r`, [M.cl3, P.e1])).toEqual([{ r: 'active' }]);   // ticked again for the tests below
    expect(await as(db, A.e1, `select set_service_active($1,false) r`, [M.cl2])).toEqual([{ r: 'inactive' }]);
    expect(await as(db, A.e1, `select set_service_active($1,true) r`, [M.cl2])).toEqual([{ r: 'active' }]);   // re-opened, history continuous
    await expectError(as(db, A.e3, `select set_service_active($1,true,$2)`, [M.cl1, P.e1]), /yourself or your team/);
    await expectError(as(db, A.bm1, `select set_service_active($1,true,$2)`, [M.cl4, P.e1]), /reason/);
    await expectError(as(db, A.bm1, `select set_service_active($1,true,$2,'Covering Kolkata')`, [M.cl4, P.e1]), /not assigned to you/);
    expect(await as(db, A.admin, `select set_service_active($1,true,$2,'Covering Kolkata')  r`, [M.cl4, P.e1])).toEqual([{ r: 'active' }]);
  });
  it('a manager corrects or removes a team member\'s entry with a note; the person is told', async () => {
    await as(db, A.e1, `select * from save_productivity($1,$2)`, [D, JSON.stringify([{ client_location_id: M.cl1, entry: 9, closure: 1, cancelled: 0 }, { client_location_id: M.cl2, entry: 0, closure: 0, cancelled: 0 }, { client_location_id: M.cl4, entry: 0, closure: 0, cancelled: 0 }, { client_location_id: M.cl3, entry: 0, closure: 0, cancelled: 0 }])]);
    await as(db, A.e1, `select * from submit_day($1)`, [D]);
    await expectError(as(db, A.e3, `select * from correct_team_line($1,$2,$3,1,1,0,'x')`, [P.e1, D, M.cl1]), /your team/);
    await expectError(as(db, A.bm1, `select * from correct_team_line($1,$2,$3,1,1,0,'')`, [P.e1, D, M.cl1]), /note/);
    const c = await as(db, A.bm1, `select entry, reason from correct_team_line($1,$2,$3,7,1,0,'Two were duplicates')`, [P.e1, D, M.cl1]);
    expect(c[0]).toEqual({ entry: 7, reason: 'Corrected by SYNTH BM Pune: Two were duplicates' });
    const r = await as(db, A.zm1, `select entry, closure from correct_team_line($1,$2,$3,null,null,null,'Wrong client',true)`, [P.e1, D, M.cl1]);
    expect(r[0]).toEqual({ entry: 0, closure: 0 });
    expect((await as(db, A.e1, `select count(*)::int n from notifications where kind='entry_corrected'`))[0].n).toBe(2);
  });
});

describe('Automatic attendance', () => {
  it('present when reported, pending while the window is open, absent after it closes; a manager confirmation wins', async () => {
    await db.exec(`update settings set value = '"2026-11-01"' where key = 'go_live_date'`);   // fixtures park go-live in 2099
    let b = await as(db, A.bm1, `select full_name, day_status, day_category, day_confirmed from attendance_board($1,$1,$2)`, [D, P.bm1]);
    expect(b.find((x: any) => x.full_name === 'SYNTH Exec One')).toMatchObject({ day_status: 'present', day_category: 'Present', day_confirmed: false });
    expect(b.find((x: any) => x.full_name === 'SYNTH Exec Two')).toMatchObject({ day_status: 'pending' });
    await clock(db, '2026-11-11T11:00:00+05:30');
    b = await as(db, A.bm1, `select full_name, day_status, day_sub from attendance_board($1,$1,$2)`, [D, P.bm1]);
    expect(b.find((x: any) => x.full_name === 'SYNTH Exec Two')).toMatchObject({ day_status: 'absent', day_sub: 'No show (not informed)' });
    await as(db, A.bm1, `select * from set_attendance($1,$2,'half_day','Left at 2 pm, informed')`, [P.e2, D]);
    b = await as(db, A.bm1, `select full_name, day_status, day_category, day_sub, day_confirmed from attendance_board($1,$1,$2)`, [D, P.bm1]);
    expect(b.find((x: any) => x.full_name === 'SYNTH Exec Two')).toMatchObject({ day_status: 'half_day', day_category: 'Present', day_sub: 'Half day', day_confirmed: true });
    const mine = await as(db, A.e1, `select full_name, present from attendance_board('2026-11-02',$1)`, [D]);
    expect(mine.length).toBe(1);
    await expectError(as(db, A.e3, `select * from attendance_board($1,$1,$2)`, [D, P.bm1]), /Not in your team/);
  });
});

describe('Zonal Tracker built by the tool', () => {
  it('targets × rate, MTD from entries less cancellations, today = MTD − yesterday, scoped to the viewer', async () => {
    await clock(db, '2026-11-02T10:00:00+05:30');
    await as(db, A.admin, `select * from set_target('2026-11-01','entry','branch',100,null,$1,null,$2,'plan')`, [M.b1, M.cBOM]);
    await clock(db, '2026-11-11T20:00:00+05:30');
    await as(db, A.e2, `select * from save_productivity('2026-11-11',$1)`, [JSON.stringify([{ client_location_id: M.cl1, entry: 6, closure: 5, cancelled: 1 }])]);
    const t = (await as(db, A.admin, `select zonal_tracker('2026-11-11') j`))[0].j;
    const bom = t.rows.find((r: any) => r.client === 'SYNTH-BOM' && r.location === 'SYNTH Pune');
    expect(bom).toMatchObject({ target_cases: 100, revenue_target: 80000, mtd_cases: 5, prev_cases: 0, reported_added: 5, stakeholder: 'SYNTH Ops Head', head: 'SYNTH BA Nashik' });
    expect(bom.mtd_revenue).toBe(4000);
    const e4 = (await as(db, A.e4, `select zonal_tracker('2026-11-11') j`))[0].j;
    expect(e4.rows.every((r: any) => r.location === 'SYNTH Kolkata')).toBe(true);
    const zm1 = (await as(db, A.zm1, `select zonal_tracker('2026-11-11') j`))[0].j;
    expect(zm1.rows.some((r: any) => r.location === 'SYNTH Pune')).toBe(true);
    const zm2 = (await as(db, A.zm2, `select zonal_tracker('2026-11-11') j`))[0].j;
    expect(zm2.rows.some((r: any) => r.location === 'SYNTH Pune')).toBe(false);
  });
  it('copy targets is a dry run until applied; only Admin (D-52)', async () => {
    await clock(db, '2026-12-01T10:00:00+05:30');
    expect((await as(db, A.admin, `select copy_targets('2026-12-01','2026-11-01') j`))[0].j).toEqual({ rows: 1, target_cases: 100, applied: false });
    await expectError(as(db, A.oh, `select copy_targets('2026-12-01','2026-11-01')`), /Only Admin/);
    expect((await db.query<any>(`select count(*)::int n from target_allocations where month='2026-12-01'`)).rows[0].n).toBe(0);
    await as(db, A.admin, `select copy_targets('2026-12-01','2026-11-01','targets',true)`);
    expect((await db.query<any>(`select amount::int a from target_allocations where month='2026-12-01' and is_current`)).rows[0].a).toBe(100);
    await expectError(as(db, A.zm1, `select copy_targets('2026-12-01','2026-11-01')`), /Only Admin/);
  });
});

describe('Settings', () => {
  it('Admin edits a setting in plain terms; wrong type or locked keys are refused', async () => {
    await as(db, A.admin, `select * from set_setting('shift_start','"09:30"')`);
    await expectError(as(db, A.admin, `select * from set_setting('shift_start','"9.30am"')`), /09:30/);
    await expectError(as(db, A.admin, `select * from set_setting('shift_start','930')`), /right type/);
    await expectError(as(db, A.admin, `select * from set_setting('allow_fake_clock','true')`), /cannot be changed/);
    await expectError(as(db, A.zm1, `select * from set_setting('shift_start','"09:30"')`), /Only Admin/);
  });
});
