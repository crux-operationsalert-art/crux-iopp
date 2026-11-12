// 12 Nov: papers by kind of person — agreement + security cheque for BAs, employment papers for employees (D-129).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, clock, expectError, freshDb } from './db';
import { A, P, seed } from './fixtures';

let db: PGlite;
const reg = (who: string, person: string, type: string) => as(db, who, `select register_document($1,$2,$3,'f.pdf','application/pdf',1000)`, [person, type, `${person}/${type}/x-f.pdf`]);
beforeAll(async () => { db = await freshDb(); await seed(db); await clock(db, '2026-11-12T10:00:00+05:30'); await db.query(`update persons set resource_type='partner' where id=$1`, [P.ba1]); });

describe('Papers by kind of person (D-129)', () => {
  it('offers employment papers to an employee and agreement papers to a Business Associate', async () => {
    const e = (await as(db, A.e1, `select document_types($1) j`, [P.e1]))[0].j, b = (await as(db, A.hr, `select document_types($1) j`, [P.ba1]))[0].j;
    expect(e.partner).toBe(false); expect(b.partner).toBe(true);
    expect(e.types.slice(0, 4)).toEqual(['offer_letter', 'increment_letter', 'relieving_letter', 'joining_form']);
    expect(e.types).not.toContain('partner_agreement'); expect(e.types).not.toContain('security_cheque'); expect(e.types).not.toContain('agreement');
    expect(b.types.slice(0, 2)).toEqual(['partner_agreement', 'security_cheque']);
    expect(b.types).not.toContain('offer_letter'); expect(b.types).not.toContain('increment_letter');
  });

  it('refuses the wrong kind of paper and accepts the right one', async () => {
    await expectError(reg(A.hr, P.e1, 'security_cheque'), /for Business Associates/);
    await expectError(reg(A.hr, P.e1, 'partner_agreement'), /for Business Associates/);
    await expectError(reg(A.hr, P.ba1, 'offer_letter'), /for CRUX employees/);
    await reg(A.hr, P.e1, 'relieving_letter'); await reg(A.e1, P.e1, 'offer_letter');
    await reg(A.hr, P.ba1, 'partner_agreement'); await reg(A.hr, P.ba1, 'security_cheque');
    await reg(A.e1, P.e1, 'aadhaar');
  });
});
