// 11 Nov: editable KPI library, who-has-what, and the Admin access card (D-121).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, clock, expectError, freshDb } from './db';
import { A, P, seed } from './fixtures';

let db: PGlite;
const q = async (sql: string, p: any[] = []) => (await db.query<any>(sql, p)).rows;
const sees = async (who: string, person: string) => (await as(db, who, `select app.can_view_person($1, app.today(), 'operations') v`, [person]))[0].v;
beforeAll(async () => { db = await freshDb(); await seed(db); await clock(db, '2026-11-12T10:00:00+05:30'); });

describe('KPI library edit (D-121)', () => {
  it('adds and edits with the same call, always producing the standard name', async () => {
    const add = (await as(db, A.admin, `select kpi_upsert(null,'Finance & Accounts','number of vendor bills checked','count','days',true,array['executive'],'Bills checked before payment',true) j`))[0].j;
    expect(add.name).toBe('Vendor Bills Checked – Volume');
    const ed = (await as(db, A.admin, `select kpi_upsert($1,'Finance & Accounts','vendor bill checking','time','hours',false,array['executive','lead'],'How long a check takes',true) j`, [add.kpi_id]))[0].j;
    expect(ed.name).toBe('Vendor Bill Checking – Turnaround Time');
    const row = (await q(`select unit, higher_better, levels from kpi_catalogue where id=$1`, [add.kpi_id]))[0];
    expect(row.unit).toBe('hours'); expect(row.higher_better).toBe(false); expect(row.levels.length).toBe(2);
    // cannot rename onto an existing KPI of the department, and only HR/Admin can edit
    await expectError(as(db, A.admin, `select kpi_upsert($1,'Finance & Accounts','invoices processed','count')`, [add.kpi_id]), /already has/);
    await expectError(as(db, A.bm1, `select kpi_upsert(null,'Operations','something new here','count')`), /Only HR\/Admin/);
    // an automatic KPI keeps its unit and direction when renamed
    const auto = (await q(`select id from kpi_catalogue where metric='closure'`))[0].id;
    await as(db, A.admin, `select kpi_upsert($1,'Operations','cases closed','count','days',false,null,'x',true)`, [auto]);
    expect((await q(`select higher_better, metric from kpi_catalogue where id=$1`, [auto]))[0]).toMatchObject({ higher_better: true, metric: 'closure' });
  });
});

describe('Access card (D-121)', () => {
  it('starts out matching today\'s behaviour', async () => {
    expect(await sees(A.bm1, P.e1)).toBe(true);     // own report
    expect(await sees(A.bm1, P.e3)).toBe(false);    // someone else's report
    expect(await sees(A.e3, P.e1)).toBe(false);
    expect(await sees(A.admin, P.e4)).toBe(true);
    const card = (await as(db, A.admin, `select access_card() j`))[0].j;
    expect(card.areas.length).toBe(8);
    expect(card.rules.length).toBe(33 * 13);
    expect(card.pages.length).toBe(25);
    await expectError(as(db, A.hr, `select access_card()`), /Only Admin/);
  });

  it('tightening a role to "only own" removes its view of the team at once', async () => {
    await as(db, A.admin, `select access_set('figures','bm','self')`);
    expect(await sees(A.bm1, P.e1)).toBe(false);
    expect(await sees(A.bm1, P.bm1)).toBe(true);    // own data is never taken away
    await as(db, A.admin, `select access_set('figures','bm','team')`);
    expect(await sees(A.bm1, P.e1)).toBe(true);
  });

  it('"everyone" opens it up, and "own team" narrows an org-wide role', async () => {
    await as(db, A.admin, `select access_set('figures','executive','all')`);
    expect(await sees(A.e3, P.e1)).toBe(true);
    await as(db, A.admin, `select access_set('figures','executive','team')`);
    expect(await sees(A.e3, P.e1)).toBe(false);
    // HR sees everyone's pay by default; at "own team" only people under them
    const pay = async () => (await as(db, A.hr, `select app.can_see_pay($1, '2026-11-01') v`, [P.e1]))[0].v;
    expect(await pay()).toBe(true);
    await as(db, A.admin, `select access_set('pay','hr_admin','team')`);
    expect(await pay()).toBe(false);
    await as(db, A.admin, `select access_set('pay','hr_admin','all')`);
  });

  it('keeps Admin fixed and refuses changes from anyone else', async () => {
    await expectError(as(db, A.admin, `select access_set('figures','admin','self')`), /fixed/);
    await expectError(as(db, A.hr, `select access_set('figures','bm','self')`), /Only Admin/);
    await expectError(as(db, A.admin, `select access_set('figures','bm','nothing')`), /Unknown level/);
  });

  it('lists who has which KPIs and attributes', async () => {
    const t = (await as(db, A.admin, `select scorecard_team() j`))[0].j;
    expect(t.rows[0]).toHaveProperty('kpi_list');
    expect(t.rows[0]).toHaveProperty('attr_list');
  });
});

describe('Access card — profiles are view-only (D-121)', () => {
  it('widening profiles lets a role open a profile but never makes them that person\'s manager', async () => {
    await expectError(as(db, A.e3, `select person_profile($1)`, [P.e1]), /Not permitted/);
    await as(db, A.admin, `select access_set('profiles','executive','all')`);
    expect((await as(db, A.e3, `select person_profile($1) j`, [P.e1]))[0].j).toBeTruthy();
    expect((await as(db, A.e3, `select app.above($1) v`, [P.e1]))[0].v).toBe(false);      // still not "above" them
    await as(db, A.admin, `select access_set('profiles','executive','team')`);
    await expectError(as(db, A.e3, `select person_profile($1)`, [P.e1]), /Not permitted/);
  });
});
