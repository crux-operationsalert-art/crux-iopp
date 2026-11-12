// 12 Nov: digital letters signed on the phone (D-131) and salary slips incl. past months (D-132); GST certificate dropped (D-130).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, clock, expectError, freshDb } from './db';
import { A, P, seed } from './fixtures';

let db: PGlite;
const SIG = 'data:image/png;base64,' + 'A'.repeat(600);
const tpl = async (name: string) => (await db.query<any>(`select id from letter_templates where name=$1`, [name])).rows[0].id as string;
beforeAll(async () => {
  db = await freshDb(); await seed(db); await clock(db, '2026-11-12T10:00:00+05:30');
  await db.query(`update persons set designation='Executive', department='Operations', joined_on='2025-04-01' where id=$1`, [P.e1]);
  await db.query(`update persons set mobile='9811100011' where id=$1`, [P.e1]);
  await db.query(`update hr_profiles set joining_date='2025-04-01' where person_id=$1`, [P.e1]);
  await db.query(`update persons set resource_type='partner' where id=$1`, [P.ba1]);
  await db.query(`insert into hr_compensation(person_id, monthly_gross, effective_from, kind, reason, note) values ($1, 25000, '2025-04-01', 'joining', 'joining', 'joining')`, [P.e1]);
});

describe('GST certificate (D-130)', () => {
  it('is no longer offered to a Business Associate', async () => {
    const t = (await as(db, A.hr, `select document_types($1) j`, [P.ba1]))[0].j.types;
    expect(t).not.toContain('gst_certificate'); expect(t).toContain('security_cheque');
  });
});

describe('Digital letters (D-131)', () => {
  let id = '';
  it('fills a template for the person, with the designation’s roles & responsibilities, and lists what is still blank', async () => {
    const p = (await as(db, A.hr, `select letter_preview($1,$2,'{}') j`, [P.e1, await tpl('Appointment letter with roles and responsibilities')]))[0].j;
    expect(p.body).toContain('Rs. 25,000'); expect(p.body).toContain('Rs. 3,00,000'); expect(p.body).toContain('1 Apr 2025');
    expect(p.body).toContain('Complete the cases allocated each day');
    expect(p.missing.sort()).toEqual(['notice_days', 'probation_months']);
    await expectError(as(db, A.bm1, `select letter_preview($1,$2,'{}')`, [P.e1, await tpl('Offer letter')]), /HR only/);
  });

  it('uses the person’s own responsibilities when HR has written them, and goes back when cleared', async () => {
    await as(db, A.hr, `select person_responsibilities_save($1, $2)`, [P.e1, '- Handle BOM cases for Pune only.']);
    expect((await as(db, A.hr, `select person_responsibilities_get($1) j`, [P.e1]))[0].j).toEqual({ text: '- Handle BOM cases for Pune only.', own: true });
    await as(db, A.hr, `select person_responsibilities_save($1, '')`, [P.e1]);
    expect((await as(db, A.hr, `select person_responsibilities_get($1) j`, [P.e1]))[0].j.own).toBe(false);
    await as(db, A.hr, `select role_profile_save('Executive', 'Operations', '- Operations-only duty.')`);
    expect((await as(db, A.e1, `select person_responsibilities_get($1) j`, [P.e1]))[0].j.text).toBe('- Operations-only duty.');
  });

  it('will not issue with blank fields; issues, notifies, and only the person can sign', async () => {
    const t = await tpl('Appointment letter with roles and responsibilities');
    const half = (await as(db, A.hr, `select letter_preview($1,$2,'{}') j`, [P.e1, t]))[0].j;
    await expectError(as(db, A.hr, `select letter_issue($1,'appointment',$2,$3,true)`, [P.e1, half.title, half.body]), /still blank/);
    const full = (await as(db, A.hr, `select letter_preview($1,$2,$3) j`, [P.e1, t, JSON.stringify({ notice_days: '30', probation_months: '6' })]))[0].j;
    expect(full.missing).toEqual([]);
    const r = (await as(db, A.hr, `select letter_issue($1,'appointment',$2,$3,true) j`, [P.e1, full.title, full.body]))[0].j;
    id = r.id; expect(r.ref_no).toMatch(/^CRUX\/APP\/2026\/\d{4}$/);
    expect((await db.query<any>(`select count(*)::int n from notifications where person_id=$1 and kind='letter'`, [P.e1])).rows[0].n).toBe(1);
    await expectError(as(db, A.e2, `select letter_get($1)`, [id]), /not found/);
    await expectError(as(db, A.bm1, `select letter_get($1)`, [id]), /not found/);              // a manager cannot read it
    await expectError(as(db, A.hr, `select letter_sign($1,'HR',$2,'ua')`, [id, SIG]), /not found/);
    await expectError(as(db, A.e1, `select letter_sign($1,'SYNTH E1',null,'ua')`, [id]), /Draw your signature/);
    await as(db, A.e1, `select letter_sign($1,'SYNTH E1',$2,'ua')`, [id, SIG]);
    const l = (await as(db, A.e1, `select letter_get($1) j`, [id]))[0].j;
    expect(l.status).toBe('signed'); expect(l.signed_name).toBe('SYNTH E1'); expect(l.intact).toBe(true); expect(l.signature).toBe(SIG);
    await expectError(as(db, A.e1, `select letter_sign($1,'SYNTH E1',$2,'ua')`, [id, SIG]), /already signed/);
    await expectError(as(db, A.hr, `select letter_close($1,'changed my mind')`, [id]), /already signed/);
    expect((await as(db, A.e1, `select letters_list() j`))[0].j.length).toBe(1);
    expect((await as(db, A.e2, `select letters_list() j`))[0].j.length).toBe(0);
  });

  it('exit letters, declining and withdrawing; bulk issue skips people with blanks', async () => {
    const t = await tpl('Relieving letter');
    const p = (await as(db, A.hr, `select letter_preview($1,$2,$3) j`, [P.e1, t, JSON.stringify({ last_working_day: '30 Nov 2026' })]))[0].j;
    expect(p.needs_signature).toBe(false);
    const a = (await as(db, A.hr, `select letter_issue($1,'relieving',$2,$3,false) j`, [P.e1, p.title, p.body]))[0].j;
    await as(db, A.e1, `select letter_close($1,'My joining date is wrong')`, [a.id]);
    expect((await as(db, A.hr, `select letter_get($1) j`, [a.id]))[0].j.status).toBe('declined');
    const b = (await as(db, A.hr, `select letter_issue($1,'warning','Warning letter','This is a formal warning about late reporting.',true) j`, [P.e2]))[0].j;
    await as(db, A.hr, `select letter_close($1,'issued by mistake')`, [b.id]);
    expect((await as(db, A.e2, `select letters_list() j`))[0].j.length).toBe(0);          // a withdrawn letter disappears for the person
    const res = (await as(db, A.hr, `select letter_issue_bulk($1, $2::uuid[], $3) j`, [await tpl('Confirmation of employment'), `{${P.e1},${P.e2}}`, JSON.stringify({ effective_date: '1 Dec 2026' })]))[0].j;
    expect(res.issued).toBe(2); expect(res.skipped).toEqual([]);
    const res2 = (await as(db, A.hr, `select letter_issue_bulk($1, $2::uuid[], '{}') j`, [await tpl('Confirmation of employment'), `{${P.e3}}`]))[0].j;
    expect(res2.issued).toBe(0); expect(res2.skipped[0].missing).toEqual(['effective_date']);
  });

  it('templates and the letterhead are HR/Admin only to change', async () => {
    await expectError(as(db, A.bm1, `select letter_template_save(null,'other','My letter','Some text that is long enough.',true,true)`), /HR only/);
    await as(db, A.hr, `select letter_template_save(null,'other','Laptop handover','Dear {{name}}, you have received a laptop {{asset_tag}}.',true,true)`);
    await expectError(as(db, A.hr, `select letter_template_save(null,'other','Laptop handover','Dear {{name}}, you have received a laptop.',true,true)`), /already has that name/);
    await expectError(as(db, A.e1, `select company_asset_set('letterhead','data:image/png;base64,AAAA')`), /Only HR/);
    await as(db, A.admin, `select company_asset_set('letterhead','data:image/png;base64,AAAA')`);
    const h = (await as(db, A.e1, `select letterhead() j`))[0].j;
    expect(h.letterhead).toBe('data:image/png;base64,AAAA'); expect(h.name).toBeTruthy();
  });
});

describe('Letters that carry their effect (D-133)', () => {
  it('a salary revision letter updates the salary record when sent; nothing is half done if it cannot', async () => {
    await expectError(as(db, A.hr, `select letter_issue_with($1,'increment','Salary revision letter','Your salary is revised to Rs. 28,000 from 1 Dec 2026.',true, 28000, null, null)`, [P.e2]), /date the revised salary starts/);
    expect((await db.query<any>(`select count(*)::int n from letters where person_id=$1 and kind='increment'`, [P.e2])).rows[0].n).toBe(0);
    const r = (await as(db, A.hr, `select letter_issue_with($1,'increment','Salary revision letter','Your salary is revised to Rs. 28,000 from 1 Dec 2026.',true, 28000, '2026-12-01', null) j`, [P.e1]))[0].j;
    expect(r.effect).toEqual({ new_gross: 28000, effective: '2026-12-01' });
    const c = (await db.query<any>(`select monthly_gross::int g, effective_from::text f, reason from hr_compensation where person_id=$1 order by effective_from desc limit 1`, [P.e1])).rows[0];
    expect(c.g).toBe(28000); expect(c.f).toBe('2026-12-01'); expect(c.reason).toContain(r.ref_no);
    await expectError(as(db, A.bm1, `select letter_issue_with($1,'increment','Salary revision letter','Your salary is revised to Rs. 28,000 from 1 Dec 2026.',true, 28000, '2026-12-01', null)`, [P.e1]), /HR only/);
  });

  it('an exit letter records the last working day and flags the exit once that day has passed', async () => {
    await as(db, A.hr, `select letter_issue_with($1,'resignation_acceptance','Acceptance of resignation','Your resignation is accepted; last working day 10 Nov 2026.',true, null, null, '2026-11-10')`, [P.e4]);
    await as(db, A.hr, `select letter_issue_with($1,'resignation_acceptance','Acceptance of resignation','Your resignation is accepted; last working day 30 Nov 2026.',true, null, null, '2026-11-30')`, [P.e3]);
    const hr = (await as(db, A.hr, `select letters_list() j`))[0].j;
    expect(hr.find((l: any) => l.person_id === P.e4 && l.kind === 'resignation_acceptance').exit_due).toBe(true);
    expect(hr.find((l: any) => l.person_id === P.e3 && l.kind === 'resignation_acceptance').exit_due).toBe(false);
    expect((await as(db, A.e4, `select letters_list() j`))[0].j[0].exit_due).toBeUndefined();
    await as(db, A.hr, `select deactivate_person($1,'2026-11-10','Exit letter')`, [P.e4]);
    expect((await as(db, A.hr, `select letters_list() j`))[0].j.find((l: any) => l.person_id === P.e4 && l.kind === 'resignation_acceptance').exit_due).toBe(false);
  });
});

describe('Salary slips (D-132)', () => {
  it('checks a past-months sheet before applying it', async () => {
    const mob = (await db.query<any>(`select mobile from persons where id=$1`, [P.e1])).rows[0].mobile;
    const rows = [
      { mobile: mob, month: '2026-04', paid_days: '30', basic: '12500', hra: '6250', allowances: '6250', pf: '1500', pt: '200', net: '23300' },
      { mobile: mob, month: '2026-05', basic: '12500', allowances: '12500', pf: '1500', net: '20000' },     // does not add up
      { mobile: '9999999999', month: '2026-04', basic: '10000' },                                             // unknown person
      { mobile: mob, month: '2026-11', basic: '10000' },                                                      // not a past month
      { mobile: mob, month: '2026-06', basic: 'abc' },
    ];
    await expectError(as(db, A.bm1, `select payslip_history_upload($1,false)`, [JSON.stringify(rows)]), /HR only/);
    const c = (await as(db, A.hr, `select payslip_history_upload($1,false) j`, [JSON.stringify(rows)]))[0].j;
    expect(c.ok).toBe(1); expect(c.applied).toBe(false);
    expect(c.problems.map((p: any) => p.row)).toEqual([2, 3, 4, 5]);
    expect(c.problems[0].why).toMatch(/does not equal net pay/);
    expect((await as(db, A.e1, `select payslips() j`))[0].j).toEqual([]);
    await as(db, A.hr, `select payslip_history_upload($1,true)`, [JSON.stringify(rows.slice(0, 1))]);
  });

  it('the person, HR and nobody else can open the slip', async () => {
    expect((await as(db, A.e1, `select payslips() j`))[0].j).toEqual([{ month: '2026-04-01', net: 23300, source: 'uploaded' }]);
    const s = (await as(db, A.e1, `select payslip(null,'2026-04-01') j`))[0].j;
    expect(s.gross).toBe(25000); expect(s.deductions_total).toBe(1700); expect(s.net).toBe(23300); expect(s.paid_days).toBe(30);
    expect(s.earnings.map((e: any) => e.label)).toEqual(['Basic', 'House rent allowance', 'Other allowances']);
    await as(db, A.hr, `select payslip($1,'2026-04-01')`, [P.e1]);
    await expectError(as(db, A.e2, `select payslip($1,'2026-04-01')`, [P.e1]), /Not permitted/);
    await expectError(as(db, A.bm1, `select payslips($1)`, [P.e1]), /Not permitted/);
    await expectError(as(db, A.e1, `select payslip(null,'2026-03-01')`), /no salary slip/);
  });
});
