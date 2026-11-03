// UI smoke test against the built app with every server call mocked (synthetic data; nothing reaches Supabase).
// Usage: npm run build && node e2e/ui-smoke.mjs [tracker.xlsx]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');   // pre-installed globally; run with NODE_PATH=$(npm root -g)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const OUT = new URL('./out/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const tracker = process.argv[2];
const today = '2026-11-03', iso = (h) => `${today}T${h}:00+05:30`;
const me = { person_id: 'p1', full_name: 'SYNTH Ops Head', designation: 'Operations Head', status: 'active', roles: ['ops_head', 'admin'],
  manages_operations: true, manages_collections: false, has_collections: true, today, tz: 'Asia/Kolkata', server_time: iso('18:00') };
const rep = (loc, cl, id, e, c, x) => ({ zone: 'SYNTH Delhi Zone', location: loc, client: cl, client_location_id: id, entry: e, closure: c, cancelled: x, mtd_entry: e * 3, mtd_closure: c * 3, mtd_cancelled: x, people: 2 });
const att = (id, n, st) => ({ person_id: id, full_name: n, scheduled: 3, present: 2, late: 1, half_day: 0, early_leave: 0, absent: 0, planned_leave: 0, unplanned_leave: 0, not_marked: 0, shrinkage_pct: 0, unplanned_streak: 0, today_status: st, today_in: iso('09:55'), today_out: null });
const R = {
  whoami: me,
  my_day: { work_date: today, window: 'open', reopened: false, deadline: iso('23:59'), grace_deadline: '2026-11-04T10:00:00+05:30',
    status: { status: 'submitted', submitted_at: iso('17:00'), late: false },
    rows: [{ client_location_id: 'cl1', client: 'SYNTH BOM Retail', location: 'Delhi', process: 'Verification', entry: 12, closure: 8, cancelled: 0, rate: 750, billable_event: 'entry', opening_wip: 5, wip_seeded: true, source: null }] },
  day_report: (b) => b.p_scope === 'me' ? [rep('Delhi', 'SYNTH BOM Retail', 'cl1', 12, 8, 0)] : [rep('Delhi', 'SYNTH BOM Retail', 'cl1', 5, 2, 0), rep('Gurgaon', 'SYNTH IDBI', 'cl2', 3, 1, 1)],
  team_status: [{ person_id: 'p2', full_name: 'SYNTH Ravi', designation: 'Executive', is_manager: false, status: 'submitted', reason: null, late: false, submitted_at: iso('17:30'), certified: false, resolved: true, entry: 8, closure: 3, cancelled: 1, net: 10 }],
  attendance_summary: [att('p1', 'SYNTH Ops Head', 'present'), att('p2', 'SYNTH Ravi', 'late')],
  my_team_people: [{ person_id: 'p2', full_name: 'SYNTH Ravi', designation: 'Executive', mobile: '9800000002', email: null, resource_type: 'own_employee', status: 'invited', roles: ['executive'], function: 'operations', manager_id: 'p1', manager_name: 'SYNTH Ops Head', depth: 1, allocations: ['SYNTH BOM Retail · Delhi'] }],
  create_team_member: { id: 'p9' }, allocate: {}, issue_activation: { code: 'ABCDE-12345', login_id: '9800000009', expires_at: '2026-11-05T18:00:00+05:30', full_name: 'SYNTH New Member' },
  certify_team_detail: {}, check_in: {}, bulk_import: (b) => ({ kind: b.p_kind, rows: b.p_rows.length, ok: b.p_rows.length, errors: [], applied: !b.p_dry_run }),
  revenue_status_data: { as_of: '2026-11-02', prev_as_of: '2026-10-31', dates: ['2026-11-02', '2026-10-31'], wd_done: 2, wd_total: 25, rows: [
    { region: 'North', zone: 'SYNTH Delhi Zone', location: 'Delhi', client: 'SYNTH BOM Retail', stakeholder: 'SYNTH Stakeholder A', target_cases: 400, revenue_target: 300000, mtd_cases: 40, mtd_revenue: 30000, reported_added: 20, prev_cases: 20, prev_revenue: 15000, row: 4 },
    { region: 'West', zone: 'SYNTH Pune Zone', location: 'Pune', client: 'SYNTH SBI', stakeholder: 'SYNTH Stakeholder B', target_cases: 200, revenue_target: 60000, mtd_cases: 2, mtd_revenue: 600, reported_added: 0, prev_cases: 2, prev_revenue: 600, row: 9 }] },
  import_tracker_day: (b) => ({ batch: 'b1', rows: b.p_rows.length, as_of: b.p_as_of }),
};
const TABLES = {
  attendance: [{ person_id: 'p1', work_date: today, status: 'present', check_in: iso('09:55'), check_out: null, minutes_late: 0, source: 'self' }],
  zones: [{ id: 'z1', name: 'SYNTH Delhi Zone', region: 'North' }], branches: [{ id: 'b1', name: 'SYNTH Delhi', branch_type: 'own' }],
  client_locations: [{ id: 'cl1', branch_id: 'b1', valid: '[2026-01-01,)', clients: { name: 'SYNTH BOM Retail' }, locations: { name: 'Delhi' } }],
  leave_requests: [], certifications: [], collection_entries: [{ collection_date: today, amount_received: 25000 }], bill_entries: [],
};
const calls = [];

const srv = spawn('npx', ['vite', 'preview', '--port', '4319', '--strictPort'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch();
const errors = [];
const fails = [];
try {
  for (const vp of [{ name: 'mobile', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]) {
    const ctx = await browser.newContext({ viewport: vp });
    await ctx.addInitScript(() => localStorage.setItem('sb-gizzonxfwsqfwgjyqzxc-auth-token', JSON.stringify({ access_token: 'x', refresh_token: 'y', token_type: 'bearer',
      expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: 'u1', aud: 'authenticated', role: 'authenticated' } })));
    await ctx.route(/supabase\.co\//, async (route) => {
      const u = new URL(route.request().url()); const body = route.request().postDataJSON?.() ?? {};
      const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u.pathname);
      if (m) { calls.push(m[1]); const v = R[m[1]]; const d = typeof v === 'function' ? v(body) : v ?? [];
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) }); }
      const t = /\/rest\/v1\/(\w+)/.exec(u.pathname);
      if (t) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TABLES[t[1]] ?? []) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${vp.name}: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${vp.name} console: ${m.text()}`));
    const go = async (hash, name, check) => {
      await page.goto(`http://localhost:4319/#${hash}`); await page.waitForTimeout(900);
      for (const c of check) if (!(await page.getByText(c, { exact: false }).first().isVisible().catch(() => false))) fails.push(`${vp.name} ${name}: missing "${c}"`);
      await page.screenshot({ path: `${OUT}${vp.name}-${name}.png`, fullPage: true });
    };
    await go('/', 'home', ["Enter today's numbers", 'Attendance today']);
    await go('/productivity', 'myday', ['My day — daily entry', 'Team roll-up here', 'Certify my team', 'Daily message', 'MTD Shrinkage', 'SYNTH BOM Retail: 12']);
    await go('/attendance', 'attendance', ['Attendance & leave', 'Request leave', 'MTD shrinkage']);
    await page.getByRole('tab', { name: 'My team' }).click(); await page.waitForTimeout(500);
    if (!(await page.getByText('Team attendance').isVisible())) fails.push(`${vp.name} attendance team tab`);
    await go('/team', 'team', ["Today's review", 'Certify my team']);
    await page.getByRole('tab', { name: /People/ }).click(); await page.waitForTimeout(500);
    await page.getByLabel('Full name').fill('SYNTH New Member'); await page.getByLabel(/Mobile number/).fill('9800000009');
    await page.getByLabel('SYNTH BOM Retail · Delhi').check();
    await page.getByRole('button', { name: /Add member/ }).click(); await page.waitForTimeout(800);
    const msg = await page.locator('textarea').first().inputValue().catch(() => '');
    for (const c of ['welcome to CRUX', 'ABCDE-12345', '9800000009', 'First time / reset password', 'Check in', 'Submit']) if (!msg.includes(c)) fails.push(`${vp.name} onboarding message missing "${c}"`);
    await page.screenshot({ path: `${OUT}${vp.name}-team-added.png`, fullPage: true });
    await go('/reports', 'revenue-status', ['Revenue Status', 'Key points', 'Stakeholder scorecard', 'Close-out focus', 'Copy formatted email']);
    if (vp.name === 'mobile') {
      await page.getByRole('button', { name: 'More' }).click(); await page.waitForTimeout(300);
      await page.getByRole('menuitem', { name: /Admin/ }).click(); await page.waitForTimeout(900);
      if (!(await page.getByText('Every change here is recorded').isVisible())) fails.push('mobile: Admin not reachable from More menu');
    } else await go('/admin', 'admin', ['Every change here is recorded']);
    await page.getByRole('tab', { name: 'Bulk upload' }).click(); await page.waitForTimeout(400);
    if (!(await page.getByText('Download template').isVisible())) fails.push(`${vp.name} bulk upload tab`);
    if (tracker && vp.name === 'desktop') {
      await page.getByRole('tab', { name: 'Daily tracker' }).click(); await page.waitForTimeout(400);
      await page.locator('input[type=file]').setInputFiles(tracker); await page.waitForTimeout(2500);
      if (!(await page.getByText('All four totals match').isVisible())) fails.push('tracker upload: totals did not match');
      await page.getByRole('button', { name: /Import \d+ rows/ }).click(); await page.waitForTimeout(800);
      if (!(await page.getByText(/Imported \d+ rows/).isVisible())) fails.push('tracker upload: import message missing');
    }
    await ctx.close();
  }
} finally { await browser.close(); srv.kill(); }
console.log(JSON.stringify({ errors, fails, rpcCalls: [...new Set(calls)].sort() }, null, 1));
process.exit(errors.length || fails.length ? 1 : 0);
