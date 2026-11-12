// 11 Nov: scorecards — managers set 3–5 KPIs + 3–5 attributes from a department library (D-120).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, clock, expectError, freshDb } from './db';
import { A, M, P, seed } from './fixtures';

let db: PGlite;
const q = async (sql: string, p: any[] = []) => (await db.query<any>(sql, p)).rows;
const kid = async (name: string) => (await q(`select id from kpi_catalogue where name=$1`, [name]))[0].id;
const aid = async (name: string) => (await q(`select id from attribute_catalogue where name=$1`, [name]))[0].id;
beforeAll(async () => { db = await freshDb(); await seed(db); await clock(db, '2026-11-26T10:00:00+05:30'); });

describe('Scorecards (D-120)', () => {
  it('ships a library of at least 5 KPIs for every department, and enough attributes', async () => {
    const depts = await q(`select department, count(*)::int n from kpi_catalogue where system group by 1`);
    expect(depts.length).toBeGreaterThanOrEqual(8);
    for (const d of depts) expect(d.n).toBeGreaterThanOrEqual(5);
    expect((await q(`select count(*)::int n from attribute_catalogue`))[0].n).toBeGreaterThanOrEqual(10);
  });

  it('shows a manager only the KPIs of the person\'s department, recommended for their level first', async () => {
    const s = (await as(db, A.bm1, `select scorecard_person($1) j`, [P.e1]))[0].j;
    expect(s.department).toBe('Operations');
    expect(s.library.every((k: any) => k.department === 'Operations')).toBe(true);
    expect(s.library[0].recommended).toBe(true);
    expect(s.attribute_library.length).toBeGreaterThanOrEqual(10);
    // someone who is not the reporting manager cannot open it
    await expectError(as(db, A.e3, `select scorecard_person($1)`, [P.e1]), /reporting manager/);
    await expectError(as(db, A.zm2, `select scorecard_person($1)`, [P.e1]), /reporting manager/);
  });

  it('enforces 3–5 KPIs and 3–5 attributes, and keeps the scorecard until it is changed', async () => {
    const k = [await kid('Cases Closed – Volume'), await kid('Cases Closed Within TAT – Rate %'), await kid('Quality Errors – Rate %')];
    const at = [await aid('Ownership & Accountability'), await aid('Quality of Work'), await aid('Communication')];
    const kp = (ids: string[]) => JSON.stringify(ids.map((id) => ({ kpi_id: id, target: 100, cadence: 'monthly', higher_better: true })));
    await expectError(as(db, A.bm1, `select scorecard_save($1,'Operations',$2::jsonb,$3::uuid[])`, [P.e1, kp(k.slice(0, 2)), at]), /3 to 5 KPIs/);
    await expectError(as(db, A.bm1, `select scorecard_save($1,'Operations',$2::jsonb,$3::uuid[])`, [P.e1, kp(k), at.slice(0, 2)]), /3 to 5 attributes/);
    await expectError(as(db, A.e3, `select scorecard_save($1,'Operations',$2::jsonb,$3::uuid[])`, [P.e1, kp(k), at]), /reporting manager/);
    await as(db, A.bm1, `select scorecard_save($1,'Operations',$2::jsonb,$3::uuid[])`, [P.e1, kp(k), at]);
    const team = (await as(db, A.bm1, `select scorecard_team() j`))[0].j;
    const row = team.rows.find((r: any) => r.person_id === P.e1);
    expect(row.kpis).toBe(3); expect(row.attributes).toBe(3); expect(row.ready).toBe(true);
    // the person sees them, with the automatic one marked
    const mine = (await as(db, A.e1, `select my_kpis(null) j`))[0].j;
    expect(mine.length).toBe(3);
    expect(mine.find((x: any) => x.name === 'Cases Closed – Volume').auto).toBe(true);
    expect((await as(db, A.e1, `select my_attributes() j`))[0].j.length).toBe(3);
    // an automatic KPI cannot be typed in
    await expectError(as(db, A.e1, `select save_kpi_entry($1, null, 1, 1, null)`, [k[0]]), /counted automatically/);
  });

  it('copies one person’s scorecard to the rest of the team in one go; not to people outside the team (D-140)', async () => {
    await expectError(as(db, A.bm1, `select scorecard_copy($1, $2::uuid[])`, [P.e2, `{${P.e1}}`]), /own KPIs and attributes first/);
    await expectError(as(db, A.e3, `select scorecard_copy($1, $2::uuid[])`, [P.e1, `{${P.e2}}`]), /reporting manager/);
    const r = (await as(db, A.bm1, `select scorecard_copy($1, $2::uuid[]) j`, [P.e1, `{${P.e2},${P.e3},${P.e1}}`]))[0].j;
    expect(r.done).toBe(1);                                                    // e2 is in the team; e3 is not; the source is skipped
    expect(r.failed.length).toBe(1); expect(r.failed[0].why).toMatch(/reporting manager/);
    const row = (await as(db, A.bm1, `select scorecard_team() j`))[0].j.rows.find((x: any) => x.person_id === P.e2);
    expect(row.kpis).toBe(3); expect(row.attributes).toBe(3); expect(row.ready).toBe(true);
    expect((await as(db, A.e2, `select my_kpis(null) j`))[0].j.length).toBe(3);
  });

  it('names a new KPI itself, uniformly, and reuses an existing one instead of duplicating', async () => {
    const a = (await as(db, A.bm1, `select kpi_custom_add('Operations','number of kyc forms checked','count') j`))[0].j;
    expect(a.name).toBe('KYC Forms Checked – Volume');
    expect(a.exists).toBe(false);
    const b = (await as(db, A.bm1, `select kpi_custom_add('Operations','KYC forms checked count','count') j`))[0].j;
    expect(b.kpi_id).toBe(a.kpi_id);                       // same standard name -> same KPI
    expect(b.exists).toBe(true);
    const t = (await as(db, A.bm1, `select kpi_custom_add('Operations','time taken to close escalation','time','hours', true) j`))[0].j;
    expect(t.name).toBe('Close Escalation – Turnaround Time');
    expect(t.higher_better).toBe(false);                   // time defaults to lower-is-better
    expect(t.kpi_id).toBeNull();                           // preview only
    await expectError(as(db, A.e3, `select kpi_custom_add('Operations','anything at all','count')`), /reporting managers/);
  });

  it('scores an automatic KPI from daily updates against the manager\'s monthly target', async () => {
    await db.query(`insert into productivity_lines(person_id,work_date,client_location_id,closure) values ($1,'2026-11-20',$2,60)`, [P.e1, M.cl1]);
    const items = (await q(`select x from app.kpi_achievements($1, app.today()) x`, [P.e1])).map((r) => Number(r.x));
    expect(items).toContain(60);                           // 60 closed of a 100 target; the two manual KPIs have no entries yet
  });

  it('lets the manager score each attribute; the attribute score is their average', async () => {
    const at = (await as(db, A.e1, `select my_attributes() j`))[0].j.map((x: any) => x.id);
    const scores = JSON.stringify({ [at[0]]: 6, [at[1]]: 8, [at[2]]: 10 });
    await as(db, A.e1, `select self_score_attrs('2026-11-01', 7, $1::jsonb, 'mine')`, [scores]);
    expect(Number((await q(`select self_attr from monthly_scores where person_id=$1`, [P.e1]))[0].self_attr)).toBe(8);
    await expectError(as(db, A.bm1, `select save_score_attrs($1,'2026-11-01',7,$2::jsonb,null)`, [P.e1, JSON.stringify({ [at[0]]: 6 })]), /every attribute/);
    await as(db, A.bm1, `select save_score_attrs($1,'2026-11-01',7,$2::jsonb,'ok')`, [P.e1, scores]);
    expect(Number((await q(`select attr_given from monthly_scores where person_id=$1`, [P.e1]))[0].attr_given)).toBe(8);
    const pv = (await as(db, A.bm1, `select score_preview($1,'2026-11-01',null,null) j`, [P.e1]))[0].j;
    expect(pv.attributes.length).toBe(3);
    expect(pv.attr_scores).toBeTruthy();
  });
});
