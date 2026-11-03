// Owner decisions of 03 Nov 2026 (D-03 revenue, D-13 activation login, D-19 tracker import). Synthetic data only.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, clock, expectError, freshDb } from './db';
import { A, M, P, seed } from './fixtures';

let db: PGlite;
beforeAll(async () => { db = await freshDb(); await seed(db); await clock(db, '2026-11-10T12:00:00+05:30'); });

describe('D-03 revenue = (entry − cancelled) × rate', () => {
  it('earns on entry (WIP + closure) and a cancellation reverses it; closure does not earn twice', async () => {
    await db.exec(`insert into rate_cards(client_id,location_id,process_id,rate,valid,reason)
                   values ('${M.cSBI}','${M.lX}','${M.pRV}',260,'[2026-11-01,)','synthetic default event')`);
    const ev = await db.query<any>(`select billable_event, reverse_cancellations from rate_cards where rate = 260`);
    expect(ev.rows[0].reverse_cancellations).toBe(true);
    expect(ev.rows[0].billable_event).toBe('entry');
    await as(db, A.e4, `select * from save_productivity('2026-11-10',$1)`, [JSON.stringify([{ client_location_id: M.cl4, entry: 10, closure: 6, cancelled: 2 }])]);
    const r = await as(db, A.zm2, `select billable_qty, revenue::int from v_line_metrics where person_id=$1`, [P.e4]);
    expect(r[0]).toEqual({ billable_qty: 8, revenue: 2080 });     // (10 − 2) × 260
  });
});

describe('D-13 activation-code login (no email, no stored password)', () => {
  it('admin issues a one-time code; wrong code counts attempts; right code redeems once', async () => {
    await db.exec(`update persons set mobile = '7700000011' where id = '${P.e2}'`);
    const out = await as(db, A.admin, `select issue_activation($1) j`, [P.e2]);
    const { code, login_id } = out[0].j;
    expect(code).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
    expect(login_id).toBe('7700000011');
    const stored = await db.query<any>(`select code_hash from app.activation_codes where person_id = $1`, [P.e2]);
    expect(stored.rows[0].code_hash).not.toContain(code.replace('-', ''));
    expect((await db.query(`select * from redeem_activation('7700000011','00000-00000')`)).rows).toHaveLength(0);
    const ok = await db.query<any>(`select login_email from redeem_activation('+91 77000 00011', $1)`, [code.toLowerCase()]);
    expect(ok.rows[0].login_email).toBe('m7700000011@login.crux-iopp.app');
    expect((await db.query(`select * from redeem_activation('7700000011',$1)`, [code])).rows).toHaveLength(0);   // single use
  });
  it('a manager can issue codes only inside their tree; an executive cannot; clients cannot redeem', async () => {
    await as(db, A.bm1, `select issue_activation($1)`, [P.e1]);
    await expectError(as(db, A.bm1, `select issue_activation($1)`, [P.e3]), /own team/);
    await expectError(as(db, A.e1, `select issue_activation($1)`, [P.e2]), /own team/);
    await expectError(as(db, A.e1, `select * from redeem_activation('x','y')`), /permission denied/);
  });
  it('five wrong attempts lock the code', async () => {
    const out = await as(db, A.admin, `select issue_activation($1) j`, [P.e2]);
    for (let i = 0; i < 5; i++) expect((await db.query(`select * from redeem_activation('7700000011','11111-11111')`)).rows).toHaveLength(0);
    const a = await db.query<any>(`select attempts from app.activation_codes where person_id = $1`, [P.e2]);
    expect(a.rows[0].attempts).toBe(5);
    expect((await db.query(`select * from redeem_activation('7700000011',$1)`, [out[0].j.code])).rows).toHaveLength(0);
  });
});

describe('D-19 tracker import through staging', () => {
  it('stages with a token, commits masters + history once, and keeps figures as recorded', async () => {
    const b = (await db.query<any>(`insert into import_batches(source,file_name,as_of) values ('tracker','SYNTH.xlsx','2026-10-30') returning id`)).rows[0].id;
    await db.query(`insert into app.import_tokens values ($1, extensions.crypt('tok-123', extensions.gen_salt('bf')), now() + interval '1 hour')`, [b]);
    const fact = (n: number, month: string, loc: string, client: string, cases: number, rev: number) => ({ row_no: n, kind: 'fact',
      payload: { zone: 'SYNTH Zone T', region: 'West', location: loc, client, month, actual_cases: cases, actual_revenue: rev,
                 billing_amount: rev * 0.9, source_row: 10 + n, source_columns: 'S,T,U' } });
    const rows = [fact(1, '2026-09-01', 'SYNTH Loc T', 'SYNTH Client T', 100, 75000), fact(2, '2026-10-01', 'SYNTH Loc T', 'SYNTH Client T', 80, 60000),
                  { row_no: 3, kind: 'rate', payload: { location: 'SYNTH Loc T', client: 'SYNTH Client T', rate: 750, valid_from: '2026-10-01', basis: 'Oct 2026 revenue target ÷ target cases' } },
                  { row_no: 4, kind: 'exception', payload: { issue: 'blended rate', location: 'SYNTH Loc T' } }];
    await expectError(as(db, null, `select stage_import_rows($1,'tok-123',$2)`, [b, JSON.stringify(rows)]), /permission denied/);   // closed between imports
    await db.exec(`grant execute on function public.stage_import_rows(uuid, text, jsonb) to anon`);                               // import runbook step
    await expectError(as(db, null, `select stage_import_rows($1,'wrong',$2)`, [b, JSON.stringify(rows)]), /Invalid or expired/);
    expect((await as(db, null, `select stage_import_rows($1,'tok-123',$2) n`, [b, JSON.stringify(rows)]))[0].n).toBe(4);
    const res = (await db.query<any>(`select app.commit_tracker_batch($1) r`, [b])).rows[0].r;
    expect(res.facts).toBe(2); expect(res.rates).toBe(1); expect(res.exceptions).toBe(1);
    await expectError(db.query(`select app.commit_tracker_batch($1)`, [b]), /not in staged/);
    await expectError(as(db, null, `select stage_import_rows($1,'tok-123',$2)`, [b, JSON.stringify(rows)]), /Invalid or expired/);
    const h = await as(db, A.admin, `select label, actual_cases::int c, actual_revenue::int r from tracker_history('2026-09-01','2026-10-31','month')`);
    expect(h).toEqual([{ label: 'Sep 2026', c: 100, r: 75000 }, { label: 'Oct 2026', c: 80, r: 60000 }]);
    expect((await as(db, A.e1, `select count(*)::int n from tracker_monthly`))[0].n).toBe(0);
    const rc = await db.query<any>(`select rate::int, billable_event from rate_cards where reason like 'Zonal Tracker%'`);
    expect(rc.rows[0]).toEqual({ rate: 750, billable_event: 'entry' });
  });
});
