// Agreement + profile gate, TAT buckets and tally, daily money for heads, misses/tasks with Admin decisions,
// rate proposals, salary, leader bulk upload, dashboard. Synthetic data only.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, clock, expectError, freshDb } from './db';
import { A, M, P, seed } from './fixtures';

let db: PGlite;
const row = (cl: string, e: number, c: number, x: number, b: number[] | null, note?: string) =>
  ({ client_location_id: cl, entry: e, closure: c, cancelled: x, ...(b ? { tat_0_1: b[0], tat_1_2: b[1], tat_2_4: b[2], tat_4_7: b[3], tat_7_15: b[4], tat_15p: b[5] } : {}), tat_note: note });
async function day(uid: string, d: string, rows: any[]) {
  await as(db, uid, `select * from save_productivity($1,$2)`, [d, JSON.stringify(rows)]);
  await as(db, uid, `select save_pending($1,$2)`, [d, JSON.stringify(rows.filter((r) => 'tat_0_1' in r))]);
  return as(db, uid, `select status from submit_day($1)`, [d]);
}
beforeAll(async () => {
  db = await freshDb(); await seed(db);
  await db.exec(`update settings set value = '"2026-11-09"' where key = 'go_live_date'`);
});

describe('Agreement and profile gate', () => {
  it('a person without agreement and profile cannot enter figures; accepting and completing unlocks it', async () => {
    await db.exec(`update hr_profiles set completed_at = null, pan_last4 = null where person_id = '${P.e2}';
                   update agreement_acceptances set version = version where false;`);
    await db.query(`insert into agreement_versions(version,title,body) values ('v2','t','SYNTH body v2')`);
    await db.exec(`update settings set value = '"v2"' where key = 'agreement_version'`);
    await clock(db, '2026-11-09T12:00:00+05:30');
    await expectError(as(db, A.e2, `select * from save_productivity('2026-11-09',$1)`, [JSON.stringify([row(M.cl1, 1, 0, 0, null)])]), /agreement/);
    expect((await as(db, A.e2, `select whoami() w`))[0].w).toMatchObject({ agreement_ok: false, profile_missing: ['PAN (last 4)'] });
    await expectError(as(db, A.e2, `select * from accept_agreement('v1','SYNTH Exec Two')`), /newer agreement/);
    const a = await as(db, A.e2, `select version, body_md5 from accept_agreement('v2','SYNTH Exec Two','test-agent')`);
    expect(a[0].version).toBe('v2'); expect(a[0].body_md5).toHaveLength(32);
    await expectError(as(db, A.e2, `select save_my_profile($1)`, [JSON.stringify({ pan_last4: 'AB1C', bank_ifsc: 'bad' })]), /bank_ifsc|check/);
    const pr = (await as(db, A.e2, `select save_my_profile(p) j from (select to_jsonb(h) || '{"pan_last4":"ZZ9Z"}'::jsonb p from hr_profiles h where person_id=$1) x`, [P.e2]))[0].j;
    expect(pr).toEqual({ missing: [], complete: true });
    expect((await as(db, A.e3, `select count(*)::int n from hr_profiles where person_id=$1`, [P.e2]))[0].n).toBe(0);   // private
    expect((await as(db, A.admin, `select count(*)::int n from agreement_acceptances where version='v2'`))[0].n).toBe(1);
    await db.exec(`update settings set value = '"v1"' where key = 'agreement_version'`);
  });
});

describe('TAT pending buckets', () => {
  it('buckets are compulsory, the first day sets the base, later days must tally or carry a note (raising a miss)', async () => {
    await clock(db, '2026-11-09T18:00:00+05:30');
    await expectError(day(A.e1, '2026-11-09', [row(M.cl1, 5, 2, 0, [1, 1, 1, 0, 0, 0]), row(M.cl2, 0, 0, 0, null)]), /incomplete/);
    expect(await day(A.e1, '2026-11-09', [row(M.cl1, 5, 2, 0, [1, 1, 1, 0, 0, 0]), row(M.cl2, 0, 0, 0, [0, 0, 0, 0, 0, 0])])).toEqual([{ status: 'submitted' }]);
    await clock(db, '2026-11-10T18:00:00+05:30');
    const md = (await as(db, A.e1, `select my_day('2026-11-10') j`))[0].j;
    expect(md.rows.find((r: any) => r.client_location_id === M.cl1).opening_pending).toBe(3);
    const r10 = (b: number[], note?: string) => [row(M.cl1, 4, 1, 1, b, note), row(M.cl2, 0, 0, 0, [0, 0, 0, 0, 0, 0])];
    await expectError(day(A.e1, '2026-11-10', r10([2, 1, 1, 0, 0, 0])), /expected 5 \(previous 3 \+ entry 4 − closure 1 − cancelled 1\)/);
    expect(await day(A.e1, '2026-11-10', r10([2, 1, 1, 0, 0, 0], 'One case moved to Nashik'))).toEqual([{ status: 'submitted' }]);
    const t = await as(db, A.bm1, `select kind, status, detail from tasks where kind='tat_mismatch'`);
    expect(t[0]).toMatchObject({ status: 'open', detail: { reported: 4, expected: 5 } });   // the manager sees it
  });
  it('a location head enters monthly receivables and daily collections; managers set targets; Collections Head can revise', async () => {
    await db.exec(`insert into location_heads(branch_id,person_id,head_role,valid) values ('${M.b1}','${P.e2}','branch_head','[2026-11-01,)')`);
    const day0 = (await as(db, A.e2, `select my_collection_day('2026-11-10') j`))[0].j;
    expect(day0.map((x: any) => x.client).sort()).toEqual(['SYNTH-BOM', 'SYNTH-SBI']);
    await expectError(day(A.e2, '2026-11-10', [row(M.cl1, 1, 0, 0, [1, 0, 0, 0, 0, 0])]), /collections/);
    const keys = day0.map((x: any) => ({ branch_id: x.branch_id, client_id: x.client_id }));
    // monthly receivables by age
    await expectError(as(db, A.e2, `select save_ar('2026-11-01',$1)`, [JSON.stringify(keys.map((k: any) => ({ ...k, ar_lt30: 1000 })))]), /four receivable/);
    await as(db, A.e2, `select save_ar('2026-11-01',$1)`, [JSON.stringify(keys.map((k: any) => ({ ...k, ar_lt30: 10000, ar_30_90: 5000, ar_90_180: 2000, ar_gt180: 1000 })))]);
    // daily: bills count + value, received and reconciled by age
    const full = { bill_count: 2, bill_amount: 750, rcv_lt30: 300, rcv_30_90: 200, rcv_90_180: 0, rcv_gt180: 0, rec_lt30: 300, rec_30_90: 100, rec_90_180: 0, rec_gt180: 0 };
    const save = (d: string, f: any) => as(db, A.e2, `select save_collection_day($1,$2)`, [d, JSON.stringify(keys.map((k: any) => ({ ...k, ...f })))]);
    await expectError(save('2026-11-10', { ...full, rec_gt180: undefined }), /required/);
    await save('2026-11-10', full); await save('2026-11-10', { ...full, bill_count: 4, bill_amount: 1650, rcv_lt30: 600, rcv_30_90: 400, rec_lt30: 600, rec_30_90: 200 });
    expect(await as(db, A.e2, `select status from submit_day('2026-11-10')`)).toEqual([{ status: 'submitted' }]);
    const bom = (await as(db, A.e2, `select my_collection_day('2026-11-10') j`))[0].j.find((x: any) => x.client === 'SYNTH-BOM');
    expect(bom.mtd).toMatchObject({ bc: 4, ba: 1650, r1: 600, r2: 400, c1: 600, c2: 200 });
    expect(bom.ar).toMatchObject({ ar_lt30: 10000, status: 'entered' });
    // the manager sets the month's collection target; the head cannot
    await clock(db, '2026-11-05T12:00:00+05:30');   // targets lock after the 6th
    await as(db, A.admin, `select set_target('2026-11-01','collections_received','branch',5000,null,$1,null,$2,'SYNTH')`, [M.b1, M.cBOM]);
    await clock(db, '2026-11-10T18:00:00+05:30');
    expect((await as(db, A.e2, `select my_collection_day('2026-11-10') j`))[0].j.find((x: any) => x.client === 'SYNTH-BOM').target).toBe(5000);
    await expectError(as(db, A.e2, `select set_target('2026-11-01','collections_received','branch',9,null,$1,null,$2,'x')`, [M.b1, M.cBOM]), /permission|not allowed|cannot|42501|Only/i);
    // Collections Head disputes and changes the receivables; the head's original stays and they cannot overwrite it
    await expectError(as(db, A.e2, `select review_ar('2026-11-01',$1,$2,'{}'::jsonb,'x')`, [M.b1, M.cBOM]), /Only/);
    await as(db, A.ch, `select review_ar('2026-11-01',$1,$2,$3,'Client ledger shows less')`, [M.b1, M.cBOM, JSON.stringify({ ar_lt30: 9000, ar_30_90: 5000, ar_90_180: 2000, ar_gt180: 0 })]);
    const v = (await as(db, A.ch, `select collections_view('2026-11-01') v`))[0].v;
    const r = v.rows.find((x: any) => x.client === 'SYNTH-BOM' && x.branch_id === M.b1);
    expect(r.ar).toMatchObject({ ar_lt30: 9000, ar_gt180: 0, status: 'revised', review_note: 'Client ledger shows less', original: { ar_lt30: 10000 } });
    expect(r.target).toBe(5000); expect(r.mtd.ba).toBe(1650);
    await expectError(as(db, A.e2, `select save_ar('2026-11-01',$1)`, [JSON.stringify([{ ...keys.find((k: any) => k.client_id === M.cBOM), ar_lt30: 1, ar_30_90: 1, ar_90_180: 1, ar_gt180: 1 }])]), /revised/);
    expect((await as(db, A.e2, `select count(*)::int n from notifications where kind = 'collections'`))[0].n).toBe(1);
    await expectError(as(db, A.e3, `select save_collection_day('2026-11-10',$1)`, [JSON.stringify(keys.map((k: any) => ({ ...k, ...full })))]), /do not work on that client/);
  });
  it('My day shows the target the manager assigned (read only) next to the figures', async () => {
    await clock(db, '2026-11-05T12:00:00+05:30');
    // option 2: client-wise cases; revenue is worked out from the rate (120 × ₹800), collection as given
    const tpl = (await as(db, A.bm1, `select target_template('2026-11-01') t`))[0].t;
    const tr = tpl.rows.find((x: any) => x.person_id === P.e1 && x.client_id === M.cBOM && x.branch_id === M.b1);
    expect(tr).toMatchObject({ rate: 800 });
    expect(tpl.people.some((x: any) => x.person_id === P.bm1)).toBe(false);   // not their own
    const rows = JSON.stringify([{ person_id: P.e1, branch_id: M.b1, client_id: M.cBOM, cases: 120, collection: 50000 }]);
    const pv = (await as(db, A.bm1, `select save_targets('2026-11-01',$1) r`, [rows]))[0].r;
    expect(pv).toMatchObject({ errors: 0, applied: false, totals: { revenue: 96000, collection: 50000, cases: 120 } });
    expect((await as(db, A.e1, `select my_targets('2026-11-10') t`))[0].t.revenue.target).toBeNull();   // preview wrote nothing
    await as(db, A.bm1, `select save_targets('2026-11-01',$1,true) r`, [rows]);
    let t = (await as(db, A.e1, `select my_targets('2026-11-10') t`))[0].t;
    const r = t.rows.find((x: any) => x.client_location_id === M.cl1);
    expect(r.mine).toMatchObject({ cases: 120, revenue: 96000, collection: 50000 });
    expect(r.location.cases).toBe(120);                                   // no branch target: the people's targets add up
    expect(t).toMatchObject({ style: 'client', set_by: 'SYNTH BM Pune', revenue: { target: 96000 }, collection: { target: 50000 } });
    // the people cannot set their own; someone outside the team cannot either
    const own = JSON.stringify([{ person_id: P.e1, revenue: 1 }]);
    expect((await as(db, A.e1, `select save_targets('2026-11-01',$1) r`, [own]))[0].r.errors).toBe(1);
    await expectError(as(db, A.e1, `select save_targets('2026-11-01',$1,true)`, [own]), /problems/);
    // option 1: switching to monthly totals retires the client-wise rows for those measures
    await as(db, A.bm1, `select save_targets('2026-11-01',$1,true) r`, [JSON.stringify([{ person_id: P.e1, revenue: 150000, collection: 60000 }])]);
    t = (await as(db, A.e1, `select my_targets('2026-11-10') t`))[0].t;
    expect(t).toMatchObject({ style: 'total', revenue: { target: 150000 }, collection: { target: 60000 } });
    // mixing styles for one person in one upload is refused
    const mixed = JSON.stringify([{ person_id: P.e1, revenue: 1 }, { person_id: P.e1, branch_id: M.b1, client_id: M.cBOM, cases: 1 }]);
    expect((await as(db, A.bm1, `select save_targets('2026-11-01',$1) r`, [mixed]))[0].r.errors).toBe(2);
    // the manager's roll-up shows the person's target in money
    const tt = (await as(db, A.bm1, `select team_targets('2026-11-01') t`))[0].t;
    expect(tt.people.find((x: any) => x.person_id === P.e1)).toMatchObject({ revenue_target: 150000, collection_target: 60000 });
    await clock(db, '2026-11-10T18:00:00+05:30');
    expect((await as(db, A.bm1, `select save_targets('2026-11-01',$1) r`, [own]))[0].r.rows[0].error).toMatch(/locked/);
  });
  it('team_lines shows the manager every line under them with pending totals', async () => {
    const t = await as(db, A.bm1, `select full_name, client, pending from team_lines('2026-11-10') where client='SYNTH-BOM' order by full_name`);
    expect(t).toEqual([{ full_name: 'SYNTH Exec One', client: 'SYNTH-BOM', pending: 4 }, { full_name: 'SYNTH Exec Two', client: 'SYNTH-BOM', pending: 1 }]);
    expect(await as(db, A.e3, `select count(*)::int n from team_lines('2026-11-10')`)).toEqual([{ n: 0 }]);
  });
});

describe('Misses and tasks', () => {
  it('a missed report becomes a miss for the person, visible to the manager; only Admin closes it after a request', async () => {
    await clock(db, '2026-11-12T11:00:00+05:30');
    await as(db, A.e1, `select sync_tasks(true)`);
    const mine = await as(db, A.e3, `select id, kind, status from my_tasks('open') where kind='missed_submission' and scope='mine'`);
    expect(mine.length).toBeGreaterThan(0);
    const id = mine[0].id;
    expect((await as(db, A.ba1, `select count(*)::int n from my_tasks('open') where id=$1`, [id]))[0].n).toBe(1);   // manager sees it
    expect((await as(db, A.e1, `select count(*)::int n from my_tasks('open') where id=$1`, [id]))[0].n).toBe(0);    // peer elsewhere does not
    await expectError(as(db, A.e3, `select * from task_reply($1,'')`, [id]), /reason/);
    await as(db, A.e3, `select * from task_reply($1,'Phone was lost')`, [id]);
    await as(db, A.e3, `select * from task_request_resolution($1,'Manager entered later')`, [id]);
    await expectError(as(db, A.ba1, `select * from admin_decide_task($1,'resolve')`, [id]), /Only Admin/);
    await as(db, A.admin, `select * from admin_decide_task($1,'ask_info','Attach the WhatsApp screenshot')`, [id]);
    expect((await as(db, A.e3, `select status from tasks where id=$1`, [id]))[0].status).toBe('info_requested');
    await as(db, A.admin, `select * from admin_decide_task($1,'resolve','OK')`, [id]);
    const ev = await as(db, A.e3, `select action from task_events where task_id=$1 order by at`, [id]);
    expect(ev.map((e: any) => e.action)).toEqual(['created', 'reply', 'request_resolution', 'ask_info', 'resolve']);
    await as(db, A.e1, `select sync_tasks(true)`);   // re-sync never reopens a resolved miss
    expect((await as(db, A.e3, `select status from tasks where id=$1`, [id]))[0].status).toBe('resolved');
  });
  it('a missing rate goes to the Zonal Manager; their proposal, once Admin approves, becomes the rate', async () => {
    await db.exec(`insert into location_heads(branch_id,person_id,head_role,valid) values ('${M.b3}','${P.zm2}','zonal_manager','[2026-11-01,)')`);
    await db.exec(`insert into productivity_lines(person_id,work_date,client_location_id,entry) values ('${P.e4}','2026-11-11','${M.cl4}',3)`);
    await as(db, A.e1, `select sync_tasks(true)`);
    const t = await as(db, A.zm2, `select id, owner_id from my_tasks('open') where kind='missing_rate'`);
    expect(t[0].owner_id).toBe(P.zm2);
    await expectError(as(db, A.zm2, `select * from task_request_resolution($1,'rate per agreement','{"rate":0}')`, [t[0].id]), /rate/);
    await as(db, A.zm2, `select * from task_request_resolution($1,'Client rate letter','{"rate":450,"earns_on":"entry","valid_from":"2026-11-01"}')`, [t[0].id]);
    await as(db, A.admin, `select * from admin_decide_task($1,'resolve','Approved')`, [t[0].id]);
    expect((await db.query<any>(`select rate::int r from rate_cards where client_id='${M.cSBI}' and location_id='${M.lX}'`)).rows[0].r).toBe(450);
  });
  it('onboarding to-dos go to the manager; salary to-dos go to HR only and close themselves when done (D-58)', async () => {
    await db.exec(`update persons set status='invited' where id='${P.e2}'`);
    await as(db, A.e1, `select sync_tasks(true)`);
    const on = await as(db, A.bm1, `select id from my_tasks('open') where kind='onboarding' and scope='mine'`);
    expect(on.length).toBe(1);
    expect((await as(db, A.bm1, `select count(*)::int n from my_tasks('open') where kind='salary_missing'`))[0].n).toBe(0);      // not the manager's
    expect((await as(db, A.auditor, `select count(*)::int n from my_tasks('open') where kind='salary_missing'`))[0].n).toBe(0);  // not BI / Leadership
    expect((await as(db, A.auditor, `select count(*)::int n from tasks where kind='salary_missing'`))[0].n).toBe(0);
    expect((await as(db, A.hr, `select count(*)::int n from my_tasks('open') where kind='salary_missing' and scope='mine'`))[0].n).toBeGreaterThan(1);
    await expectError(as(db, A.bm1, `select * from set_salary($1,25000,'2026-11-01')`, [P.e1]), /HR|Admin|manager/);
    await as(db, A.hr, `select * from set_salary($1,25000,'2026-11-01','Offer letter')`, [P.e1]);
    expect(await as(db, A.bm1, `select count(*)::int n from hr_compensation`)).toEqual([{ n: 0 }]);                         // manager cannot read salary
    expect(await as(db, A.e1, `select monthly_gross::int g from hr_compensation`)).toEqual([{ g: 25000 }]);
    expect((await as(db, A.auditor, `select count(*)::int n from audit_events where table_name = 'hr_compensation'`))[0].n).toBe(0);
    await db.exec(`update persons set status='active' where id='${P.e2}'`);
    await as(db, A.e1, `select sync_tasks(true)`);
    expect(await as(db, A.hr, `select kind, status from tasks where kind in ('onboarding') or (kind='salary_missing' and subject_id=$1)`, [P.e1]))
      .toEqual(expect.arrayContaining([{ kind: 'onboarding', status: 'resolved' }, { kind: 'salary_missing', status: 'resolved' }]));
    expect(await as(db, A.bm1, `select count(*)::int n from tasks where kind='add_team' and owner_id=$1`, [P.bm1])).toEqual([{ n: 1 }]);
  });
});

describe('Leader bulk upload and dashboard', () => {
  it('a branch manager can bulk-upload people into their own team only', async () => {
    await db.exec(`update persons set mobile='7700000555' where id='${P.bm1}'`);
    const ok = (await as(db, A.bm1, `select bulk_import('people',$1,false) j`, [JSON.stringify([{ full_name: 'SYNTH Bulk Exec', mobile: '7700002001', designation: 'Executive', role: 'executive' }])]))[0].j;
    expect(ok.applied).toBe(true);
    expect(await as(db, A.bm1, `select manager_name from my_team_people() where full_name='SYNTH Bulk Exec'`)).toEqual([{ manager_name: 'SYNTH BM Pune' }]);
    const bad = (await as(db, A.bm1, `select bulk_import('people',$1,true) j`, [JSON.stringify([{ full_name: 'X', mobile: '7700002002', designation: 'Zonal Manager', role: 'zm' }])]))[0].j;
    expect(bad.errors[0].error).toMatch(/Operations Head/);
    await expectError(as(db, A.bm1, `select bulk_import('rates','[]',true)`), /Only Admin/);
  });
  it('perf_dashboard returns this month from entered figures for the viewer\'s scope only', async () => {
    const d = (await as(db, A.bm1, `select perf_dashboard('2026-11-01') j`))[0].j;
    const nov = d.series.find((s: any) => s.month === '2026-11-01');
    expect(nov).toMatchObject({ source: 'app' });
    expect(Number(nov.cases)).toBeGreaterThan(0);
    const e4 = (await as(db, A.e4, `select perf_dashboard('2026-11-01') j`))[0].j;
    expect(e4.by_location.every((r: any) => r.location === 'SYNTH Kolkata')).toBe(true);
  });
});
