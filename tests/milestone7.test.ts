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
