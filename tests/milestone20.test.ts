// 12 Nov: HR document check — the uploaded document beside the recorded details (D-126).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, clock, expectError, freshDb } from './db';
import { A, P, seed } from './fixtures';

let db: PGlite;
const queue = async (who = A.hr) => (await as(db, who, `select doc_check_queue() j`))[0].j as any[];
const item = async (person: string, kind: string) => (await queue()).find((x) => x.person_id === person && x.kind === kind);
const upload = async (who: string, person: string, type: string, f: string) =>
  (await as(db, who, `select register_document($1,$2,$3,$4,'image/jpeg',1000) id`, [person, type, `${person}/${type}/${f}`, f]))[0].id as string;
beforeAll(async () => { db = await freshDb(); await seed(db); await clock(db, '2026-11-12T10:00:00+05:30'); });

describe('Document check (D-126)', () => {
  it('lists an upload with no details first, and HR records them from the image', async () => {
    const doc = await upload(A.e1, P.e1, 'aadhaar', 'front.jpg');
    let it = await item(P.e1, 'aadhaar');
    expect(it.state).toBe('no_details'); expect(it.doc.id).toBe(doc); expect(it.number).toBeNull();
    expect((await queue())[0].state).toBe('no_details');
    await expectError(as(db, A.hr, `select doc_check_done($1,'aadhaar',$2,null)`, [P.e1, doc]), /no number recorded/);
    await expectError(as(db, A.hr, `select doc_check_done($1,'aadhaar',$2,$3)`, [P.e1, doc, JSON.stringify({ number: '2345 6789 0125' })]), /not a valid Aadhaar/);
    await as(db, A.hr, `select doc_check_done($1,'aadhaar',$2,$3)`, [P.e1, doc, JSON.stringify({ number: '2345 6789 0124', name: 'SYNTH Exec One', dob: '1990-01-01' })]);
    it = await item(P.e1, 'aadhaar');
    expect(it.state).toBe('done'); expect(it.number).toBe('234567890124'); expect(it.source).toBe('hr'); expect(it.doc.verified).toBe(true); expect(it.dob).toBe('1990-01-01');
  });

  it('details the person scanned wait for HR to compare; HR can correct them', async () => {
    const doc = await upload(A.e2, P.e2, 'pan', 'pan.jpg');
    await as(db, A.e2, `select save_identity($1,$2)`, [P.e2, JSON.stringify({ kind: 'pan', number: 'ABCPE1234F', name: 'SYNTH EXEC TWO', doc_id: doc })]);
    let it = await item(P.e2, 'pan');
    expect(it.state).toBe('to_check'); expect(it.number).toBe('ABCPE1234F'); expect(it.source).toBe('scan');
    await as(db, A.hr, `select doc_check_done($1,'pan',$2,$3)`, [P.e2, doc, JSON.stringify({ number: 'ABCPE1234G', name: 'SYNTH EXEC TWO' })]);
    it = await item(P.e2, 'pan');
    expect(it.state).toBe('done'); expect(it.number).toBe('ABCPE1234G'); expect(it.source).toBe('hr');
  });

  it('other documents are verified or sent back from the same list; a sent-back file leaves it', async () => {
    const q = await upload(A.e1, P.e1, 'qualification', 'degree.jpg');
    expect((await item(P.e1, 'qualification')).state).toBe('to_check');
    await as(db, A.hr, `select doc_check_done($1,'qualification',$2,null)`, [P.e1, q]);
    expect((await item(P.e1, 'qualification')).state).toBe('done');
    const b = await upload(A.e1, P.e1, 'bank', 'cheque.jpg');
    await as(db, A.hr, `select verify_document($1,false,'photo is blurred')`, [b]);
    expect(await item(P.e1, 'bank')).toBeUndefined();
  });

  it('a bulk read by HR is recorded as read from the document and still waits for HR to compare', async () => {
    const doc = await upload(A.e3, P.e3, 'pan', 'pan3.jpg');
    await as(db, A.hr, `select save_identity($1,$2)`, [P.e3, JSON.stringify({ kind: 'pan', number: 'ABCPK1234H', name: 'SYNTH EXEC THREE', doc_id: doc, auto: true })]);
    const it = await item(P.e3, 'pan');
    expect(it.state).toBe('to_check'); expect(it.source).toBe('scan'); expect(it.doc.verified).toBe(false); expect(it.number).toBe('ABCPK1234H');
    await expectError(as(db, A.bm1, `select save_identity($1,$2)`, [P.e3, JSON.stringify({ kind: 'pan', number: 'ABCPK1234H', auto: true })]), /Only the person, HR or Admin/);
  });

  it('a corrected copy becomes the current file without another notice to HR; the original is kept', async () => {
    const first = await upload(A.e4, P.e4, 'aadhaar', 'sideways.jpg');
    const n0 = (await db.query<any>(`select count(*)::int n from notifications where kind = 'hr_document'`)).rows[0].n;
    const fixed = await upload(A.admin, P.e4, 'aadhaar', 'corrected-sideways.jpg');
    expect((await db.query<any>(`select count(*)::int n from notifications where kind = 'hr_document'`)).rows[0].n).toBe(n0);
    const it = await item(P.e4, 'aadhaar');
    expect(it.doc.id).toBe(fixed); expect(it.doc.uploads).toBe(2);
    expect((await db.query<any>(`select count(*)::int n from person_documents where id = $1 and not rejected`, [first])).rows[0].n).toBe(1);
  });

  it('is for HR and Admin only, and Admin can turn it off for HR', async () => {
    await expectError(as(db, A.bm1, `select doc_check_queue()`), /Only HR/);
    await expectError(as(db, A.bm1, `select doc_check_done($1,'aadhaar',null,null)`, [P.e1]), /Only HR/);
    await as(db, A.admin, `select page_set('page:adm_doccheck','hr_admin','hidden')`);
    await expectError(as(db, A.hr, `select doc_check_queue()`), /turned off/);
    expect((await queue(A.admin)).length).toBeGreaterThan(0);
  });
});
