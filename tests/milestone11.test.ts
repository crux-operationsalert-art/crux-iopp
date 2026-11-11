// 11 Nov: team vs individual task assignment (D-116).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, clock, expectError, freshDb } from './db';
import { A, P, seed } from './fixtures';

let db: PGlite;
beforeAll(async () => { db = await freshDb(); await seed(db); await clock(db, '2026-11-12T10:00:00+05:30'); });

describe('Team vs individual tasks (D-116)', () => {
  it('team mode creates ONE shared task with a lead and members', async () => {
    const n = (await as(db, A.bm1, `select assign_task(array[$1,$2]::uuid[], 'Clean up allocations', 'by Friday', null, 'team', $1, 'daily') n`, [P.e1, P.e2]))[0].n;
    expect(n).toBe(1);
    const t = (await db.query<any>(`select id, assignment, cadence, next_update_due, owner_id, lead_id from tasks where assignment='team'`)).rows[0];
    expect(t.cadence).toBe('daily');
    expect(t.lead_id).toBe(P.e1);
    expect((await db.query<any>(`select count(*)::int c from task_members where task_id=$1`, [t.id])).rows[0].c).toBe(2);
    expect((await db.query<any>(`select is_lead from task_members where task_id=$1 and person_id=$2`, [t.id, P.e1])).rows[0].is_lead).toBe(true);

    // a member who is NOT the owner can still see the shared task, with lead + members
    const seen = await as(db, A.e2, `select assignment, lead_name, jsonb_array_length(members) mcount from my_tasks('all') where assignment='team'`);
    expect(seen.length).toBe(1);
    expect(seen[0].lead_name).toBe('SYNTH Exec One');
    expect(seen[0].mcount).toBe(2);

    // the member posts a progress update
    await as(db, A.e2, `select post_task_update($1, 'Started on the SBI set')`, [t.id]);
    expect((await db.query<any>(`select count(*)::int c from task_events where task_id=$1 and action='note'`, [t.id])).rows[0].c).toBe(1);
  });

  it('individual mode still creates one task each', async () => {
    const n = (await as(db, A.bm1, `select assign_task(array[$1,$2]::uuid[], 'Send your KYC', null, null, 'individual', null, 'none') n`, [P.e1, P.e2]))[0].n;
    expect(n).toBe(2);
    expect((await db.query<any>(`select count(*)::int c from tasks where title='Send your KYC'`)).rows[0].c).toBe(2);
  });

  it('rejects a lead who is not one of the assignees', async () => {
    await expectError(as(db, A.bm1, `select assign_task(array[$1,$2]::uuid[], 'x', null, null, 'team', $3, 'none')`, [P.e1, P.e2, P.e3]), /lead must be one of/);
  });

  it('nudges team tasks whose update is due', async () => {
    await db.query(`update tasks set next_update_due = '2026-11-12' where assignment='team'`);
    const fired = (await db.query<any>(`select app.task_update_reminders() n`)).rows[0].n;
    expect(fired).toBeGreaterThanOrEqual(1);
  });
});
