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
const board = (id, n, st, cat, sub, conf, direct = true) => ({ person_id: id, full_name: n, is_direct: direct, scheduled: 3, present: 2, half_day: 0, absent: 0, planned_leave: 0, unplanned_leave: 0,
  pending: 0, unconfirmed: 1, shrinkage_pct: 0, unplanned_streak: 0, day_status: st, day_category: cat, day_sub: sub, day_confirmed: conf, day_basis: conf ? 'Confirmed' : 'Auto: reported figures', day_reason: null });
const zrow = (region, zone, loc, client, st, t, rate, mtd, prev, e, c, x) => ({ region, zone, location: loc, client, stakeholder: st, head: 'SYNTH Head', rate, target_cases: t, revenue_target: t * rate,
  mtd_cases: mtd, mtd_revenue: mtd * rate, prev_cases: prev, prev_revenue: prev * rate, reported_added: mtd - prev, entry_today: e, closure_today: c, cancelled_today: x, mtd_entry: mtd, mtd_closure: 0, mtd_cancelled: 0, unrated_lines: 0 });
const svcRow = (id, client, loc, active, mine) => ({ client_location_id: id, client_id: 'c' + id, client, location_id: 'l' + loc, location: loc, branch_id: 'b1', zone: 'SYNTH Delhi Zone', active, since: active ? '2026-11-01' : null, my_location: mine });
const R = {
  whoami: me,
  my_day: { work_date: today, window: 'open', reopened: false, deadline: iso('23:59'), grace_deadline: '2026-11-04T10:00:00+05:30',
    status: { status: 'submitted', submitted_at: iso('17:00'), late: false },
    rows: [{ client_location_id: 'cl1', client: 'SYNTH BOM Retail', location: 'Delhi', process: 'Verification', entry: 12, closure: 8, cancelled: 0, rate: 750, billable_event: 'entry', opening_wip: 5, wip_seeded: true, source: null }] },
  day_report: (b) => b.p_scope === 'me' ? [rep('Delhi', 'SYNTH BOM Retail', 'cl1', 12, 8, 0)] : [rep('Delhi', 'SYNTH BOM Retail', 'cl1', 5, 2, 0), rep('Gurgaon', 'SYNTH IDBI', 'cl2', 3, 1, 1)],
  team_status: [{ person_id: 'p2', full_name: 'SYNTH Ravi', designation: 'Executive', is_manager: false, status: 'submitted', reason: null, late: false, submitted_at: iso('17:30'), certified: false, resolved: true, entry: 8, closure: 3, cancelled: 1, net: 10 }],
  attendance_board: (b) => b.p_manager ? [board('p2', 'SYNTH Ravi', 'present', 'Present', 'Full day', false), board('p3', 'SYNTH Asha', 'absent', 'Absent', 'No show (not informed)', false)]
    : [board('p1', 'SYNTH Ops Head', 'present', 'Present', 'Full day', false)],
  my_team_people: [{ person_id: 'p2', full_name: 'SYNTH Ravi', designation: 'Executive', mobile: '9800000002', email: null, resource_type: 'own_employee', status: 'invited', roles: ['executive'], function: 'operations', manager_id: 'p1', manager_name: 'SYNTH Ops Head', depth: 1, allocations: ['SYNTH BOM Retail · Delhi'] }],
  my_services: [svcRow('cl1', 'SYNTH BOM Retail', 'Delhi', true, true), svcRow('cl2', 'SYNTH IDBI', 'Delhi', false, true), svcRow('cl3', 'SYNTH SBI', 'Pune', false, false)],
  set_service_active: (b) => (b.p_active ? 'active' : 'inactive'),
  correct_team_line: {}, set_attendance: {}, set_location_head: {}, end_location_head: {}, set_setting: {}, set_target: {},
  create_team_member: { id: 'p9' }, allocate: {}, issue_activation: { code: 'ABCDE-12345', login_id: '9800000009', expires_at: '2026-11-05T18:00:00+05:30', full_name: 'SYNTH New Member' },
  certify_team_detail: {}, bulk_import: (b) => ({ kind: b.p_kind, rows: b.p_rows.length, ok: b.p_rows.length, errors: [], applied: !b.p_dry_run }),
  zonal_tracker: { as_of: today, prev_as_of: '2026-11-02', dates: [], wd_done: 3, wd_total: 25, rows: [
    zrow('North', 'SYNTH Delhi Zone', 'Delhi', 'SYNTH BOM Retail', 'SYNTH Stakeholder A', 400, 750, 40, 20, 22, 10, 2),
    zrow('West', 'SYNTH Pune Zone', 'Pune', 'SYNTH SBI', 'SYNTH Stakeholder B', 200, 300, 2, 2, 0, 0, 0)] },
  location_targets: [{ branch_id: 'b1', branch: 'SYNTH Delhi', zone: 'SYNTH Delhi Zone', client_id: 'c1', client: 'SYNTH BOM Retail', rate: 750, target_cases: 400, last_month_cases: 380 }],
  target_lock_info: { month: '2026-11-01', lock_at: '2026-11-07T00:00:00+05:30', locked: false, reopened: false },
  copy_targets: (b) => ({ rows: 1, target_cases: 380, applied: b.p_apply }),
};
const TABLES = {
  zones: [{ id: 'z1', name: 'SYNTH Delhi Zone', region: 'North' }],
  branches: [{ id: 'b1', code: 'B-SD', name: 'SYNTH Delhi', branch_type: 'own', type_confirmed: true, branch_zones: [{ valid: '[2026-01-01,)', zone_id: 'z1', zones: { name: 'SYNTH Delhi Zone', region: 'North' } }] }],
  client_locations: [{ id: 'cl1', branch_id: 'b1', client_id: 'c1', location_id: 'l1', valid: '[2026-01-01,)', clients: { name: 'SYNTH BOM Retail' }, locations: { name: 'Delhi' } },
    { id: 'cl2', branch_id: 'b1', client_id: 'c2', location_id: 'l1', valid: '[2026-01-01,)', clients: { name: 'SYNTH IDBI' }, locations: { name: 'Delhi' } }],
  productivity_lines: [{ client_location_id: 'cl1', entry: 8, closure: 3, cancelled: 1, source: 'self', reason: null, client_locations: { clients: { name: 'SYNTH BOM Retail' }, locations: { name: 'Delhi' } } }],
  location_heads: [{ id: 'h1', branch_id: 'b1', head_role: 'zonal_manager', valid: '[2026-11-01,)', person_id: 'p1', persons: { full_name: 'SYNTH Ops Head' }, clients: null, branches: { name: 'SYNTH Delhi' } }],
  persons: [{ id: 'p2', full_name: 'SYNTH Ravi', mobile: '9800000002', personal_email: null, designation: 'Executive', resource_type: 'own_employee', status: 'invited' }, { id: 'p1', full_name: 'SYNTH Ops Head' }],
  role_assignments: [{ id: 'r1', role: 'executive', valid: '[2026-11-01,)', zones: null, branches: null }],
  reporting_lines: [{ id: 'l1', function: 'operations', valid: '[2026-11-01,)', manager_id: 'p1' }],
  clients: [{ id: 'c1', name: 'SYNTH BOM Retail' }, { id: 'c2', name: 'SYNTH IDBI' }],
  settings: [{ key: 'shift_start', value: '10:00', label: 'Shift starts at', help: 'Normal start of the working day.', kind: 'time', section: 'Working hours', editable: true, updated_at: iso('10:00') },
    { key: 'report_recipients', value: '', label: 'Revenue Status email goes to', help: 'Email addresses.', kind: 'emails', section: 'Reports', editable: true, updated_at: iso('10:00') }],
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
    await go('/', 'home', ["Enter today's numbers", 'Attendance today', 'marked automatically']);
    await go('/productivity', 'myday', ['My day — daily entry', 'My clients', 'Team roll-up here', 'Certify my team', 'Daily message', 'MTD Shrinkage', 'SYNTH BOM Retail: 12']);
    await page.getByText('My clients').first().click(); await page.waitForTimeout(400);
    await page.getByLabel('SYNTH IDBI at Delhi').click(); await page.waitForTimeout(700);
    if (!(await page.getByText(/SYNTH IDBI · Delhi: active/).isVisible())) fails.push(`${vp.name} client tick did not confirm`);
    await go('/attendance', 'attendance', ['Attendance & leave', 'No check-in needed', 'No show (not informed)', 'Confirm 2 as shown']);
    await page.getByRole('button', { name: 'Change' }).nth(1).click(); await page.waitForTimeout(300);
    if (!(await page.getByRole('option', { name: 'Unplanned leave' }).count())) fails.push(`${vp.name} attendance sub-categories missing`);
    await go('/team', 'team', ["Today's review", 'Certify my team']);
    await page.getByText('SYNTH Ravi').first().click(); await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Remove' }).first().click(); await page.waitForTimeout(200);
    if (!(await page.getByText(/Remove this entry for SYNTH Ravi/).isVisible())) fails.push(`${vp.name} remove-with-note missing`);
    await page.getByRole('tab', { name: /People/ }).click(); await page.waitForTimeout(500);
    await page.getByLabel('Full name').fill('SYNTH New Member'); await page.getByLabel(/Mobile number/).fill('9800000009');
    const loc = page.locator('label', { hasText: /^Delhi$/ }).first(); await loc.locator('input').check();
    await page.locator('label', { hasText: /^SYNTH BOM Retail$/ }).first().locator('input').check();
    if (!(await page.getByText('1 client-location assignment(s) will be created').isVisible())) fails.push(`${vp.name} two-list pairing text missing`);
    await page.getByRole('button', { name: /Add member/ }).click(); await page.waitForTimeout(800);
    const msg = await page.locator('textarea').first().inputValue().catch(() => '');
    for (const c of ['welcome to CRUX', 'ABCDE-12345', '9800000009', 'First time / reset password', 'My clients', 'Submit']) if (!msg.includes(c)) fails.push(`${vp.name} onboarding message missing "${c}"`);
    if (msg.includes('Check in')) fails.push(`${vp.name} onboarding still mentions check-in`);
    await page.screenshot({ path: `${OUT}${vp.name}-team-added.png`, fullPage: true });
    await go('/reports', 'zonal-tracker', ['Zonal Tracker', 'Operation stakeholders', 'Main tracker', 'Pan India', 'Total Delhi']);
    await page.getByRole('tab', { name: 'Revenue Status' }).click(); await page.waitForTimeout(700);
    for (const c of ['Key points', 'Stakeholder scorecard', 'Copy formatted email']) if (!(await page.getByText(c).first().isVisible())) fails.push(`${vp.name} revenue status missing ${c}`);
    await page.screenshot({ path: `${OUT}${vp.name}-revenue-status.png`, fullPage: true });
    const admin = async (name, check) => {
      if (vp.name === 'mobile') await page.getByLabel('Admin section').selectOption({ label: name });
      else await page.getByRole('tab', { name: new RegExp('^' + name) }).click();
      await page.waitForTimeout(700);
      for (const c of check) if (!(await page.getByText(c).first().isVisible().catch(() => false))) fails.push(`${vp.name} admin ${name}: missing "${c}"`);
      await page.screenshot({ path: `${OUT}${vp.name}-admin-${name.replace(/\W+/g, '-')}.png`, fullPage: true });
    };
    if (vp.name === 'mobile') { await page.getByRole('button', { name: 'More' }).click(); await page.waitForTimeout(300); await page.getByRole('menuitem', { name: /Admin/ }).click(); await page.waitForTimeout(900); }
    else await go('/admin', 'admin', ['Every change is recorded']);
    await admin('People', ['Add a team member']);
    await page.getByRole('button', { name: 'Edit' }).first().click(); await page.waitForTimeout(800);
    for (const c of ['Roles', 'Reports to', 'Locations they head']) if (!(await page.getByRole('heading', { name: c, exact: true }).isVisible())) fails.push(`${vp.name} person editor missing ${c}`);
    await page.screenshot({ path: `${OUT}${vp.name}-admin-person.png`, fullPage: true });
    await page.getByRole('button', { name: /Back to people/ }).click(); await page.waitForTimeout(300);
    await admin('Locations & heads', ['Stakeholder groups', 'SYNTH Delhi']);
    await admin('Monthly targets', ['Fill from last month', 'Revenue target']);
    await admin('Settings', ['Shift starts at', 'Revenue Status email goes to']);
    await admin('Bulk upload', ['Download template']);
    await ctx.close();
  }
} finally { await browser.close(); srv.kill(); }
console.log(JSON.stringify({ errors, fails, rpcCalls: [...new Set(calls)].sort() }, null, 1));
process.exit(errors.length || fails.length ? 1 : 0);
