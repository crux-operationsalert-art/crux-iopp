import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { freshDb } from './db';

describe('staging synthetic seed', () => {
  it('loads, produces revenue, and purges completely', async () => {
    const db = await freshDb();
    await db.exec(readFileSync('supabase/seed/staging_synthetic.sql', 'utf8'));
    const r = await db.query<any>(`select count(*)::int n, sum(revenue)::numeric > 0 rev, count(*) filter (where rate_card_id is null)::int unrated from v_line_metrics`);
    expect(r.rows[0].n).toBeGreaterThan(100); expect(r.rows[0].rev).toBe(true); expect(r.rows[0].unrated).toBe(0);
    await db.exec(readFileSync('supabase/seed/purge_synthetic.sql', 'utf8'));
    const left = await db.query<any>(`select (select count(*) from persons)::int p, (select count(*) from productivity_lines)::int l, (select count(*) from clients)::int c`);
    expect(left.rows[0]).toEqual({ p: 0, l: 0, c: 0 });
  });
});
