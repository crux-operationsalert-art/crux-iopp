// 11 Nov: attachments on chat messages and tasks (D-117).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, clock, expectError, freshDb } from './db';
import { A, P, seed } from './fixtures';

let db: PGlite;
beforeAll(async () => { db = await freshDb(); await seed(db); await clock(db, '2026-11-12T10:00:00+05:30'); });

describe('Attachments (D-117)', () => {
  it('attaches to a task and only people who can see the task can read/add', async () => {
    const task = (await as(db, A.bm1, `select assign_task(array[$1]::uuid[], 'Upload the signed letter') n`, [P.e1]))[0] && (await db.query<any>(`select id from tasks where title='Upload the signed letter'`)).rows[0].id;
    const path = `task/${task}/x1-letter.pdf`;
    // the owner (e1) attaches
    const aid = (await as(db, A.e1, `select register_attachment('task',$1,$2,'letter.pdf','application/pdf',1234) id`, [task, path]))[0].id;
    expect(aid).toBeTruthy();
    // the manager (bm1) can see it
    const seenMgr = await as(db, A.bm1, `select file_name from attachments_for('task', array[$1]) `, [task]);
    expect(seenMgr.length).toBe(1);
    expect(seenMgr[0].file_name).toBe('letter.pdf');
    // an unrelated executive cannot see it, nor attach
    const seenOther = await as(db, A.e4, `select * from attachments_for('task', array[$1])`, [task]);
    expect(seenOther.length).toBe(0);
    await expectError(as(db, A.e4, `select register_attachment('task',$1,$2,'sneak.pdf',null,1)`, [task, `task/${task}/x2-sneak.pdf`]), /Not permitted/);
    // a path that does not match the parent is rejected
    await expectError(as(db, A.e1, `select register_attachment('task',$1,'task/other/x.pdf','x.pdf',null,1)`, [task]), /Bad path/);
  });

  it('attaches to a chat message visible to thread members only', async () => {
    const thread = (await as(db, A.bm1, `select chat_direct($1) t`, [P.e1]))[0].t;
    const mid = (await as(db, A.bm1, `select chat_send($1,'here is the file') id`, [thread]))[0].id;
    const path = `chat/${mid}/c1-note.pdf`;
    await as(db, A.bm1, `select register_attachment('chat',$1,$2,'note.pdf','application/pdf',10) `, [String(mid), path]);
    // the other member (e1) sees it
    const seen = await as(db, A.e1, `select file_name from attachments_for('chat', array[$1])`, [String(mid)]);
    expect(seen.length).toBe(1);
    // a non-member (e4) cannot see it or attach
    const other = await as(db, A.e4, `select * from attachments_for('chat', array[$1])`, [String(mid)]);
    expect(other.length).toBe(0);
    await expectError(as(db, A.e4, `select register_attachment('chat',$1,$2,'x.pdf',null,1)`, [String(mid), `chat/${mid}/c2-x.pdf`]), /Not permitted/);
  });
});
