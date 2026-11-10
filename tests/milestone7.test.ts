// 10 Nov: ID numbers from scans, profile completion + deadline, full profile visibility, salary HR-only, collections pairs.
// Synthetic data only (the Aadhaar / PAN / account numbers below are made up; the Aadhaar ones pass the checksum).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, clock, expectError, freshDb } from './db';
import { A, M, P, seed } from './fixtures';

let db: PGlite;
beforeAll(async () => {
  db = await freshDb(); await seed(db);
  await clock(db, '2026-11-12T12:00:00+05:30');
});

describe('ID numbers from scanned documents (D-87)', () => {
  it('validates, stores the full number, and shows it only to the person, HR and Admin', async () => {
    expect((await db.query<any>(`select app.verhoeff_ok('234567890124') a, app.verhoeff_ok('234567890125') b`)).rows[0]).toEqual({ a: true, b: false });
    await expectError(as(db, A.e1, `select save_identity($1, $2)`, [P.e1, JSON.stringify({ kind: 'aadhaar', number: '2345 6789 0125' })]), /not a valid Aadhaar/);
    await as(db, A.e1, `select save_identity($1, $2)`, [P.e1, JSON.stringify({ kind: 'aadhaar', number: '2345 6789 0124', name: 'SYNTH Exec One', dob: '1990-01-01' })]);
    await expectError(as(db, A.e2, `select save_identity($1, $2)`, [P.e2, JSON.stringify({ kind: 'aadhaar', number: '234567890124' })]), /already recorded/);
    await expectError(as(db, A.e1, `select save_identity($1, $2)`, [P.e1, JSON.stringify({ kind: 'pan', number: 'ABCDE1234' })]), /not a valid PAN/);
    await as(db, A.e1, `select save_identity($1, $2)`, [P.e1, JSON.stringify({ kind: 'pan', number: 'abcpe1234f', name: 'SYNTH EXEC ONE' })]);
    await expectError(as(db, A.e1, `select save_identity($1, $2)`, [P.e1, JSON.stringify({ kind: 'bank', number: '12345', ifsc: 'SYNB0000001' })]), /9 to 18 digits/);
    await expectError(as(db, A.e1, `select save_identity($1, $2)`, [P.e1, JSON.stringify({ kind: 'bank', number: '123456789012', ifsc: 'SYNB1000001' })]), /IFSC/);
    const pr = (await as(db, A.e1, `select save_identity($1, $2) j`, [P.e1, JSON.stringify({ kind: 'bank', number: '1234 5678 9012', ifsc: 'synb0000001', bank_name: 'SYNTH Bank', edited: true })]))[0].j;
    expect(pr.missing).not.toContain('PAN card (scan)');
    // someone else cannot record or read the numbers; nobody reads the table directly
    await expectError(as(db, A.e2, `select save_identity($1, $2)`, [P.e1, JSON.stringify({ kind: 'pan', number: 'ABCPE1234F' })]), /Only the person, HR or Admin/);
    await expectError(as(db, A.e1, `select * from hr_identity`), /permission denied/);
    const own = (await as(db, A.e1, `select person_profile($1) j`, [P.e1]))[0].j;
    expect([own.identity.aadhaar, own.identity.pan, own.identity.bank_account, own.full_ids]).toEqual(['234567890124', 'ABCPE1234F', '123456789012', true]);
    const hr = (await as(db, A.hr, `select person_profile($1) j`, [P.e1]))[0].j;
    expect(hr.identity.aadhaar).toBe('234567890124');
    const mgr = (await as(db, A.bm1, `select person_profile($1) j`, [P.e1]))[0].j;          // manager: full profile, masked IDs
    expect([mgr.identity.aadhaar, mgr.identity.pan, mgr.identity.bank_account, mgr.full_ids]).toEqual(['XXXXXXXX0124', 'XXXXXX234F', 'XXXXXXXX9012', false]);
    expect(mgr.profile.emergency_phone).toBe('9000000000');
    expect(mgr.identity.bank_source).toBe('edited');                                         // corrected after the scan: HR checks
    await expectError(as(db, A.e2, `select person_profile($1)`, [P.e1]), /Not permitted/);   // a peer
    await expectError(as(db, A.e1, `select person_profile($1)`, [P.bm1]), /Not permitted/);  // upwards
    // the change log keeps who / what / when, never the number
    const log = await as(db, A.hr, `select kind, source from identity_log where person_id = $1 order by id`, [P.e1]);
    expect(log.map((r: any) => r.kind)).toEqual(['aadhaar', 'pan', 'bank']);
    expect(JSON.stringify(await db.query(`select * from audit_events where table_name = 'hr_identity'`).then((r) => r.rows))).not.toContain('234567890124');
    // payroll export: full account number for HR only
    expect((await db.query<any>(`select hr_profiles.bank_account_last4 from hr_profiles where person_id = $1`, [P.e1])).rows[0].bank_account_last4).toBe('9012');
  });
});

describe('Profile completion and the 3-day deadline (D-88)', () => {
  it('shows %, keeps the app open for 3 days, then blocks entry until complete', async () => {
    await db.exec(`update settings set value = '"2026-11-12T00:00:00Z"' where key = 'profile_gate_from'`);
    const w = (await as(db, A.e2, `select whoami() w`))[0].w;
    expect(w.profile.pct).toBeGreaterThan(0); expect(w.profile.pct).toBeLessThan(100);
    expect(w.profile.blocking).toBe(false);
    expect(w.profile.missing).toEqual(expect.arrayContaining(['Aadhaar card (scan)', 'PAN card (scan)', 'qualification certificate (upload)']));
    await clock(db, '2026-11-16T12:00:00+05:30');
    expect((await as(db, A.e2, `select whoami() w`))[0].w.profile.blocking).toBe(true);
    await expectError(as(db, A.e2, `select * from save_productivity('2026-11-16', '[]'::jsonb)`), /complete your profile/);
    expect((await as(db, A.admin, `select whoami() w`))[0].w.profile.blocking).toBe(false);   // the Admin account is never locked out
    // complete it: scans + qualification certificate
    await as(db, A.e2, `select save_identity($1, $2)`, [P.e2, JSON.stringify({ kind: 'aadhaar', number: '345678901238' })]);
    await as(db, A.e2, `select save_identity($1, $2)`, [P.e2, JSON.stringify({ kind: 'pan', number: 'XYZPE6789K' })]);
    await as(db, A.e2, `select save_identity($1, $2)`, [P.e2, JSON.stringify({ kind: 'bank', number: '000123456789', ifsc: 'SYNB0000002' })]);
    await as(db, A.e2, `select register_document($1, 'qualification', $2, 'degree.pdf', 'application/pdf', 1000)`, [P.e2, `${P.e2}/qualification/x-degree.pdf`]);
    const w2 = (await as(db, A.e2, `select whoami() w`))[0].w;
    expect([w2.profile.pct, w2.profile.blocking, w2.profile_missing]).toEqual([100, false, []]);
    expect((await db.query<any>(`select completed_at is not null c from hr_profiles where person_id = $1`, [P.e2])).rows[0].c).toBe(true);
    await db.exec(`update settings set value = '"2099-01-01T00:00:00Z"' where key = 'profile_gate_from'`);
    await clock(db, '2026-11-12T12:00:00+05:30');
  });
  it('lists uploaded documents that can still be read for numbers', async () => {
    await as(db, A.e3, `select register_document($1, 'pan', $2, 'pan.jpg', 'image/jpeg', 1000)`, [P.e3, `${P.e3}/pan/x-pan.jpg`]);
    expect((await as(db, A.e3, `select doc_type from scannable_documents($1)`, [P.e3])).map((r: any) => r.doc_type)).toEqual(['pan']);
    expect((await as(db, A.hr, `select count(*)::int n from scannable_documents($1)`, [P.e3]))[0].n).toBe(1);
    await expectError(as(db, A.bm1, `select * from scannable_documents($1)`, [P.e3]), /Not permitted/);
  });
});

describe('Daily updates as client tiles (D-91)', () => {
  it('shows only my scope; validates a client once everyone has reported; reminders and absences only within my team', async () => {
    await clock(db, '2026-11-12T15:00:00+05:30');
    const D = '2026-11-12';
    await as(db, A.e1, `select * from save_productivity($1,$2)`, [D, JSON.stringify([{ client_location_id: M.cl1, entry: 5, closure: 2, cancelled: 0 }])]);
    const mine = (await as(db, A.e1, `select daily_board($1) b`, [D]))[0].b;
    expect(Object.keys(mine.people)).toEqual([P.e1]);                                      // an executive sees only themself
    expect(mine.manager).toBe(false);
    const t1 = mine.tiles.find((t: any) => t.members.some((m: any) => m.recv === 5));
    expect(t1.self).toMatchObject({ recv: 5, closed: 2, mtd_recv: 5 });
    expect(t1.members.every((m: any) => m.person_id === P.e1)).toBe(true);

    const bm = (await as(db, A.bm1, `select daily_board($1) b`, [D]))[0].b;
    expect(bm.manager).toBe(true);
    expect(Object.keys(bm.people).sort()).toEqual([P.bm1, P.e1, P.e2].sort());          // never e3 / e4 (other teams)
    const tile = bm.tiles.find((t: any) => t.members.some((m: any) => m.person_id === P.e2));
    expect(tile.team.recv).toBeGreaterThanOrEqual(5);
    await expectError(as(db, A.bm1, `select validate_client($1,$2,$3)`, [D, tile.branch_id, tile.client_id]), /Not reported/);
    // remind / mark absent: only people below me
    expect((await as(db, A.bm1, `select nudge_people($1,$2) n`, [[P.e2], D]))[0].n).toBe(1);
    expect((await as(db, A.bm1, `select nudge_people($1,$2) n`, [[P.e2], D]))[0].n).toBe(0);          // not twice in 30 minutes
    await expectError(as(db, A.bm1, `select nudge_people($1,$2)`, [[P.e3], D]), /only people in your team/);
    await expectError(as(db, A.bm1, `select team_mark_absent($1,$2,'x')`, [P.e3, D]), /only people in your team/);
    await expectError(as(db, A.e1, `select validate_client($1,$2,$3)`, [D, tile.branch_id, tile.client_id]), /Only a manager/);
    // everyone on the client reports or is marked absent → validate
    await as(db, A.zm1, `select team_mark_absent($1,$2,'Phone off, not reachable')`, [P.e2, D]);          // two levels up is allowed
    expect((await as(db, A.bm1, `select count(*)::int n from notifications where kind = 'team' and message like '%absent%'`))[0].n).toBeGreaterThan(0);   // e2's own manager is told
    const waiting = (await as(db, A.bm1, `select daily_board($1) b`, [D]))[0].b.tiles.find((t: any) => t.branch_id === tile.branch_id && t.client_id === tile.client_id)
      .members.filter((m: any) => !m.resolved).map((m: any) => m.person_id);
    for (const p of waiting) {
      const uid = Object.entries(P).find(([, v]) => v === p)![0] as keyof typeof A;
      await as(db, A[uid], `select * from submit_day($1)`, [D]).catch(() => as(db, A.bm1, `select team_mark_absent($1,$2,'test')`, [p, D]));
    }
    const r = (await as(db, A.bm1, `select validate_client($1,$2,$3) r`, [D, tile.branch_id, tile.client_id]))[0].r;
    expect(r.validated).toBe(true);
    const after = (await as(db, A.bm1, `select daily_board($1) b`, [D]))[0].b.tiles.find((t: any) => t.branch_id === tile.branch_id && t.client_id === tile.client_id);
    expect(after.validated_at).not.toBeNull();
    expect((await as(db, A.e2, `select count(*)::int n from client_validations`))[0].n).toBe(0);                 // not readable below
  });
});

describe('Collections rows only for the responsible head (D-86b)', () => {
  it('a ticked person gets a collections row only for clients they actually work on (D-59 kept)', async () => {
    const n = async (p: string) => (await db.query<any>(`select count(*)::int n from app.collection_pairs($1, '2026-11-12') where not is_head`, [p])).rows[0].n;
    expect(await n(P.e2)).toBe(0);                      // ticked but no figures in the last 30 days
    expect(await n(P.e1)).toBeGreaterThan(0);           // entered figures on the client this month
  });
});


describe('Collections list only for served clients (D-86)', () => {
  it("a head's collections list skips branch–client pairs nobody works on", async () => {
    await db.query(`insert into location_heads(branch_id, person_id, head_role, valid, reason)
                    select cl.branch_id, $1, 'branch_head', '[2026-01-01,)', 'synthetic' from client_locations cl where cl.id = $2`, [P.bm1, M.cl2]);
    const before = (await db.query<any>(`select count(*)::int n from app.money_pairs($1, '2026-11-12')`, [P.bm1])).rows;
    await db.exec(`select set_config('app.reason', 'test', false); update allocations set valid = daterange(lower(valid), '2026-11-01') where client_location_id in
                   (select id from client_locations where branch_id = (select branch_id from client_locations where id = '${M.cl2}'))`);
    const after = (await db.query<any>(`select count(*)::int n from app.money_pairs($1, '2026-11-12')`, [P.bm1])).rows;
    expect(before[0].n).toBeGreaterThan(0);
    expect(after[0].n).toBeLessThan(before[0].n);
  });
});

describe('Salary self-declaration, calculator, PT, reminders (D-92..D-96)', () => {
  const calc = async (p: object) => (await db.query<any>(`select app.salary_calc($1) c`, [JSON.stringify(p)])).rows[0].c;
  it('works out the break-up from CTC or from in-hand, with the ₹25,000 PF ceiling and Maharashtra PT', async () => {
    // CTC ₹4,80,000, PF, no PLB, November: gross 40,000; basic 20,000; HRA 8,000; special 12,000; PF 2,400 + 2,400; PT 200
    const a = await calc({ mode: 'ctc', amount: 480000, pf: true, plb: false, month: '2026-11-01' });
    expect([a.gross, a.basic, a.hra, a.special, a.pf_employee, a.pf_employer, a.esi_employee, a.pt, a.in_hand, a.ctc_annual])
      .toEqual([40000, 20000, 8000, 12000, 2400, 2400, 0, 200, 35000, 480000]);
    // the same in-hand gives back the same gross
    const b = await calc({ mode: 'inhand', amount: 35000, pf: true, plb: false, month: '2026-11-01' });
    expect(b.gross).toBe(40000);
    // PLB 20% is part of CTC and not in the monthly pay
    const c = await calc({ mode: 'ctc', amount: 480000, pf: true, plb: true, plb_pct: 20, month: '2026-11-01' });
    expect([c.gross, c.plb_annual, c.ctc_annual, c.fixed_annual]).toEqual([32000, 96000, 480000, 384000]);
    // PF wage capped at ₹25,000: basic 30,000 → PF on 25,000
    expect((await calc({ mode: 'ctc', amount: 720000, pf: true, plb: false })).pf_employee).toBe(3000);
    // February PT ₹300; a woman earning up to ₹25,000 pays no PT in Maharashtra; ESI under ₹21,000
    expect((await calc({ mode: 'ctc', amount: 480000, pf: true, plb: false, month: '2027-02-01' })).pt).toBe(300);
    const w = await calc({ mode: 'ctc', amount: 240000, pf: true, plb: false, gender: 'female', month: '2026-11-01' });
    expect([w.gross, w.pt, w.esi_employee, w.esi_employer]).toEqual([20000, 0, 150, 650]);
    // PF cannot be dropped at or below the ceiling; it can above it
    const f = await calc({ mode: 'ctc', amount: 480000, pf: false, plb: false });
    expect([f.pf, f.pf_forced]).toEqual([true, true]);
    const g = await calc({ mode: 'ctc', amount: 1200000, pf: false, plb: false });
    expect([g.pf, g.pf_employee, g.pf_optout_allowed]).toEqual([false, 0, true]);
    // other states
    expect((await db.query<any>(`select app.pt_monthly('KA', 30000, 'male', 11) a, app.pt_monthly('DL', 90000, 'male', 11) b, app.pt_monthly('ZZ', 30000, 'male', 11) c`)).rows[0]).toEqual({ a: '150', b: '0', c: null });
  });
  it('people declare, HR approves, and approval becomes the salary record; Admin can switch it off', async () => {
    await clock(db, '2026-11-12T12:00:00+05:30');
    const r = (await as(db, A.e4, `select declare_salary($1) r`, [JSON.stringify({ mode: 'inhand', amount: 35000, pf: true, plb: true, plb_pct: 20 })]))[0].r;
    expect(r.calc.gross).toBe(40000);
    expect((await as(db, A.e4, `select my_salary() s`))[0].s.declarations[0].status).toBe('proposed');
    await expectError(as(db, A.zm2, `select * from salary_declarations_list('proposed')`), /HR \/ Admin only/);   // the manager does not see it
    await expectError(as(db, A.e4, `select * from salary_declarations`), /permission denied/);
    const list = await as(db, A.hr, `select * from salary_declarations_list('proposed') where person_id = $1`, [P.e4]);
    await expectError(as(db, A.hr, `select decide_salary_declaration($1, false)`, [list[0].id]), /reason/);
    await as(db, A.hr, `select decide_salary_declaration($1, true, 'Checked with offer letter')`, [list[0].id]);
    const s = (await as(db, A.e4, `select my_salary() s`))[0].s;
    expect([Number(s.current.monthly_gross), s.declarations[0].status]).toEqual([40000, 'approved']);
    expect((await db.query<any>(`select plb_opted, plb_pct::int p from hr_profiles where person_id = $1`, [P.e4])).rows[0]).toEqual({ plb_opted: true, p: 20 });
    await db.exec(`update settings set value = 'false' where key = 'salary_self_service'`);
    await expectError(as(db, A.e4, `select declare_salary($1)`, [JSON.stringify({ mode: 'ctc', amount: 500000 })]), /switched off/);
    await db.exec(`update settings set value = 'true' where key = 'salary_self_service'`);
    await expectError(as(db, A.ba1, `select declare_salary($1)`, [JSON.stringify({ mode: 'ctc', amount: 500000 })]), /monthly claim/);
  });
  it('sends profile / salary reminders five times a day and install reminders to browser users', async () => {
    const n = (await db.query<any>(`select app.people_reminders(true) n`)).rows[0].n;
    expect(n).toBeGreaterThan(0);
    expect((await db.query<any>(`select app.people_reminders(true) n`)).rows[0].n).toBe(0);                // not twice for the same slot
    const msg = (await as(db, A.e1, `select message from notifications where kind = 'profile' order by created_at desc limit 1`))[0].message;
    expect(msg).toMatch(/Your profile is \d+% complete/);
    await as(db, A.e1, `select report_client(false, false, 'test')`);
    await clock(db, '2026-11-12T11:10:00+05:30');
    await db.query(`select app.people_reminders()`);
    expect((await as(db, A.e1, `select count(*)::int n from notifications where kind = 'install'`))[0].n).toBe(1);
    await as(db, A.e1, `select report_client(true, true, 'test')`);
    await clock(db, '2026-11-12T17:10:00+05:30');
    await db.query(`select app.people_reminders()`);
    expect((await as(db, A.e1, `select count(*)::int n from notifications where kind = 'install'`))[0].n).toBe(1);   // installed now: no more
  });
});
