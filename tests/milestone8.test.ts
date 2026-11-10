// 10 Nov (later): banks list + validation, data correctness, in-app activity (D-103..D-106).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, clock, expectError, freshDb } from './db';
import { A, P, seed } from './fixtures';

let db: PGlite;
beforeAll(async () => { db = await freshDb(); await seed(db); await clock(db, '2026-11-12T12:00:00+05:30'); });

describe('Banks in India (D-103)', () => {
  it('takes the bank from the IFSC and refuses an invalid typed name', async () => {
    // a real IFSC → bank derived, typed rubbish ignored
    await as(db, A.e3, `select save_identity($1, $2)`, [P.e3, JSON.stringify({ kind: 'bank', number: '123456789012', ifsc: 'HDFC0001234', bank_name: 'bango bango' })]);
    expect((await as(db, A.e3, `select person_profile($1) j`, [P.e3]))[0].j.identity.bank_name).toBe('HDFC Bank');
    // an IFSC code we do not hold + a rubbish name → refused for the person
    await expectError(as(db, A.e3, `select save_identity($1, $2)`, [P.e3, JSON.stringify({ kind: 'bank', number: '123456789012', ifsc: 'ZZZZ0001234', bank_name: 'bango bango' })]), /do not recognise/);
    // an IFSC code we do not hold but a real bank name typed → accepted
    await as(db, A.e3, `select save_identity($1, $2)`, [P.e3, JSON.stringify({ kind: 'bank', number: '123456789012', ifsc: 'ZZZZ0001234', bank_name: 'Saraswat Co-operative Bank' })]);
    expect((await as(db, A.e3, `select person_profile($1) j`, [P.e3]))[0].j.identity.bank_name).toBe('Saraswat Co-operative Bank');
    // the picker list and helpers
    expect((await as(db, A.e1, `select count(*)::int n from bank_list()`))[0].n).toBeGreaterThan(50);
    expect((await as(db, A.e1, `select app.bank_for_ifsc('utib0001') b`))[0].b).toBe('Axis Bank');
    expect((await as(db, A.e1, `select app.is_known_bank('bango bango') b`))[0].b).toBe(false);
    expect((await as(db, A.e1, `select app.is_known_bank('STATE BANK OF INDIA') b`))[0].b).toBe(true);
    // Admin can add a bank that is missing
    await expectError(as(db, A.e1, `select add_bank('ABCD', 'Test Bank')`), /Only Admin/);
    await as(db, A.admin, `select add_bank('ABCD', 'New Example Bank')`);
    expect((await as(db, A.e1, `select app.bank_for_ifsc('abcd0009999') b`))[0].b).toBe('New Example Bank');
  });
});

describe('Data correctness (D-104)', () => {
  it('lists each person\'s wrong details and gives HR a data-quality view', async () => {
    // e3 has no identity yet → high-severity gaps
    const mine = (await as(db, A.e3, `select my_data_issues() j`))[0].j;
    // (e3 saved a bank earlier in the bank test run? that is a different db instance per file; here fresh) 
    expect(mine.map((x: any) => x.code)).toEqual(expect.arrayContaining(['aadhaar', 'pan']));
    // e1: valid aadhaar/pan but a wrong bank (unknown IFSC + unrecognised name, as if typed before validation)
    await db.query(`insert into hr_identity(person_id, aadhaar_number, pan_number, bank_account_number, bank_ifsc, bank_name)
      values ($1, '234567890124', 'ABCPE1234F', '123456789012', 'ZZZZ0001234', 'bango bango')
      on conflict (person_id) do update set bank_ifsc = 'ZZZZ0001234', bank_name = 'bango bango', aadhaar_number='234567890124', pan_number='ABCPE1234F', bank_account_number='123456789012'`, [P.e1]);
    const i1 = (await as(db, A.e1, `select my_data_issues() j`))[0].j;
    expect(i1.find((x: any) => x.code === 'bank_name')).toBeTruthy();
    expect(i1.find((x: any) => x.code === 'aadhaar')).toBeFalsy();
    // HR dashboard
    await expectError(as(db, A.e2, `select data_quality()`), /Only HR and Admin/);
    const dq = (await as(db, A.hr, `select data_quality() j`))[0].j;
    expect(dq.total_people).toBeGreaterThan(0);
    expect(dq.by_problem.find((x: any) => x.code === 'bank_name').count).toBeGreaterThanOrEqual(1);
    expect(dq.people.find((x: any) => x.person_id === P.e1)).toBeTruthy();
    // the daily correction nudge files once, to the person, and not twice
    const n1 = (await db.query<any>(`select app.remind_data_corrections() n`)).rows[0].n;
    expect(n1).toBeGreaterThan(0);
    expect((await db.query<any>(`select app.remind_data_corrections() n`)).rows[0].n).toBe(0);
    expect((await db.query<any>(`select count(*)::int c from notifications where kind='data_fix' and person_id=$1`, [P.e1])).rows[0].c).toBe(1);
  });
  it('reports operational gaps for managers (not reported, untallied notes)', async () => {
    const a = (await as(db, A.bm1, `select ops_anomalies() j`))[0].j;
    expect(a).toHaveProperty('not_reported');
    expect(a).toHaveProperty('untallied');
    await expectError(as(db, A.e1, `select ops_anomalies()`), /managers and above/);
  });
});

describe('In-app engagement (D-105)', () => {
  it('records time by hour and shows it to HR/Admin only', async () => {
    await as(db, A.e1, `select record_activity(300)`);   // 5 min, at 12:00 IST (clock set in beforeAll)
    await as(db, A.e1, `select record_activity(120)`);
    const a = (await as(db, A.hr, `select person_activity($1) j`, [P.e1]))[0].j;
    expect(a.total_seconds).toBe(420);
    expect(a.by_hour[12]).toBe(420);
    expect(a.busiest_hour).toBe(12);
    // not visible to a peer / self (only HR + Admin)
    await expectError(as(db, A.e2, `select person_activity($1)`, [P.e1]), /Only HR and Admin/);
    await expectError(as(db, A.e1, `select person_activity($1)`, [P.e1]), /Only HR and Admin/);
    // the table is not readable directly
    await expectError(as(db, A.e1, `select * from app_activity`), /permission denied/);
  });
});

describe('Admin usage report (D-109)', () => {
  it('aggregates in-app time for HR/Admin and refuses others', async () => {
    await as(db, A.e1, `select record_activity(600)`);
    await as(db, A.e2, `select record_activity(300)`);
    const r = (await as(db, A.admin, `select usage_report(30) j`))[0].j;
    expect(r.total_seconds).toBeGreaterThanOrEqual(900);
    expect(r.active_people).toBe(2);
    expect(r.by_hour[12]).toBe(r.total_seconds);   // all activity was at 12:00 IST
    expect(r.people.find((p: any) => p.person_id === P.e1).total_seconds).toBeGreaterThanOrEqual(600);
    await expectError(as(db, A.e1, `select usage_report(30)`), /Only HR and Admin/);
  });
});
