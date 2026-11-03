import { describe, it, expect } from 'vitest';
import { freshDb } from './db';
import { seed } from './fixtures';
describe('migrations', () => {
  it('apply cleanly and seed synthetic fixtures', async () => {
    const db = await freshDb();
    await seed(db);
    const r = await db.query<{ n: number }>(`select count(*)::int n from persons`);
    expect(r.rows[0].n).toBe(13);
  });
});
