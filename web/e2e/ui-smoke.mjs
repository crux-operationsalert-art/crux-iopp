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
  manages_operations: true, manages_collections: false, has_collections: true, today, tz: 'Asia/Kolkata', server_time: iso('18:00'),
  mobile: '9800000001', resource_type: 'own_employee', heads_locations: true, agreement_version: 'v1', agreement_ok: true, profile_missing: [],
  company: { name: 'SYNTH Company Pvt. Ltd.', place: 'Pune', website: 'synth.test', address: '' } };
const gateMe = { ...me, agreement_ok: false, profile_missing: ['PAN (last 4)'] };
const rep = (loc, cl, id, e, c, x) => ({ zone: 'SYNTH Delhi Zone', location: loc, client: cl, client_location_id: id, entry: e, closure: c, cancelled: x, mtd_entry: e * 3, mtd_closure: c * 3, mtd_cancelled: x, people: 2 });
const board = (id, n, st, cat, sub, conf, direct = true) => ({ person_id: id, full_name: n, is_direct: direct, scheduled: 3, present: 2, half_day: 0, absent: 0, planned_leave: 0, unplanned_leave: 0,
  pending: 0, unconfirmed: 1, shrinkage_pct: 0, unplanned_streak: 0, day_status: st, day_category: cat, day_sub: sub, day_confirmed: conf, day_basis: conf ? 'Confirmed' : 'Auto: reported figures', day_reason: null });
const zrow = (region, zone, loc, client, st, t, rate, mtd, prev, e, c, x) => ({ region, zone, location: loc, client, stakeholder: st, head: 'SYNTH Head', rate, target_cases: t, revenue_target: t * rate,
  mtd_cases: mtd, mtd_revenue: mtd * rate, prev_cases: prev, prev_revenue: prev * rate, reported_added: mtd - prev, entry_today: e, closure_today: c, cancelled_today: x, mtd_entry: mtd, mtd_closure: 0, mtd_cancelled: 0, unrated_lines: 0 });
const svcRow = (id, client, loc, active, mine) => ({ client_location_id: id, client_id: 'c' + id, client, location_id: 'l' + loc, location: loc, branch_id: 'b1', zone: 'SYNTH Delhi Zone', active, since: active ? '2026-11-01' : null, my_location: mine });
const R = {
  whoami: () => (globalThis.__gate ? gateMe : me),
  my_day: { work_date: today, window: 'open', reopened: false, deadline: iso('23:59'), grace_deadline: '2026-11-04T10:00:00+05:30',
    status: { status: 'submitted', submitted_at: iso('17:00'), late: false },
    money: [{ branch_id: 'b1', branch: 'SYNTH Delhi', client_id: 'c1', client: 'SYNTH BOM Retail', target: 50000,
      ar: { ar_lt30: 40000, ar_30_90: 20000, ar_90_180: 5000, ar_gt180: 1000, status: 'revised', review_note: 'SYNTH ledger check', original: { ar_lt30: 45000, ar_30_90: 20000, ar_90_180: 5000, ar_gt180: 1000 } },
      mtd: { bc: 3, ba: 15000, r1: 9000, r2: 1000, r3: 0, r4: 0, c1: 8000, c2: 500, c3: 0, c4: 0 },
      day: { bill_count: 1, bill_amount: 5000, rcv_lt30: 3000, rcv_30_90: 0, rcv_90_180: 0, rcv_gt180: 0, rec_lt30: 2000, rec_30_90: 0, rec_90_180: 0, rec_gt180: null } }],
    money_others: [{ branch: 'SYNTH Pune', client: 'SYNTH SBI', by: 'SYNTH Asha' }],
    rows: [{ client_location_id: 'cl1', client: 'SYNTH BOM Retail', location: 'Delhi', process: 'Verification', entry: 12, closure: 8, cancelled: 0, rate: 750, billable_event: 'entry',
      opening_pending: 5, opening_wip: 5, wip_seeded: true, source: null, tat_0_1: 4, tat_1_2: 3, tat_2_4: 2, tat_4_7: 0, tat_7_15: 0, tat_15p: 0, tat_note: null }] },
  team_lines: [{ person_id: 'p2', full_name: 'SYNTH Ravi', client_location_id: 'cl1', client: 'SYNTH BOM Retail', location: 'Delhi', entry: 5, closure: 2, cancelled: 0, pending: 3, source: 'self', reason: null, status: 'submitted' },
    { person_id: 'p3', full_name: 'SYNTH Asha', client_location_id: 'cl9', client: 'SYNTH SBI', location: 'Pune', entry: 2, closure: 1, cancelled: 0, pending: 1, source: 'self', reason: null, status: 'submitted' }],
  save_pending: 1, save_money_day: 1, sync_tasks: { open: 2 }, task_reply: {}, task_request_resolution: {}, admin_decide_task: {}, accept_agreement: {}, save_my_profile: { missing: [], complete: true },
  my_tasks: [
    { id: 't1', kind: 'missed_submission', category: 'miss', title: 'No daily figures reported for 02 Nov 2026', detail: {}, status: 'open', condition_cleared: false, owner_id: 'p1', owner_name: 'SYNTH Ops Head', subject_name: 'SYNTH Ops Head', branch: null, client: null, ref_date: '2026-11-02', ref_month: null, created_at: iso('10:00'), updated_at: iso('10:00'), scope: 'mine', last_note: null, last_action: 'created', last_at: iso('10:00') },
    { id: 't2', kind: 'missing_rate', category: 'task', title: 'No per-case rate for SYNTH SBI at SYNTH Pune', detail: {}, status: 'resolution_requested', condition_cleared: false, owner_id: 'p5', owner_name: 'SYNTH ZM', subject_name: null, branch: 'SYNTH Pune', client: 'SYNTH SBI', ref_date: null, ref_month: null, created_at: iso('10:00'), updated_at: iso('11:00'), scope: 'admin', last_note: 'Client letter', last_action: 'proposal', last_at: iso('11:00') },
    { id: 't3', kind: 'behind_target', category: 'miss', title: 'SYNTH Pune · SYNTH SBI is behind target this month', detail: { target: 200, actual: 2, pro_rata: 24, achievement_pct: 1, elapsed_pct: 12, working_day: 3, working_days: 25 }, status: 'replied', condition_cleared: false, owner_id: 'p2', owner_name: 'SYNTH Ravi', subject_name: null, branch: 'SYNTH Pune', client: 'SYNTH SBI', ref_date: null, ref_month: '2026-11-01', created_at: iso('10:00'), updated_at: iso('12:00'), scope: 'team', last_note: 'Client paused files', last_action: 'reply', last_at: iso('12:00') }],
  perf_dashboard: { month: '2026-11-01', today, wd_done: 3, wd_total: 25,
    series: [{ month: '2026-09-01', target: null, cases: 58065, revenue_target: null, revenue: 22001305, billing: null, source: 'tracker' }, { month: '2026-10-01', target: 84395, cases: 62426, revenue_target: 33662000, revenue: 22930431, billing: null, source: 'tracker' },
      { month: '2026-11-01', target: 600, cases: 42, revenue_target: 360000, revenue: 30600, billing: null, source: 'app' }],
    by_stakeholder: [{ month: '2026-10-01', stakeholder: 'SYNTH Stakeholder A', target: 400, cases: 300, revenue_target: 1, revenue: 1 }, { month: '2026-11-01', stakeholder: 'SYNTH Stakeholder A', target: 400, cases: 40, revenue_target: 1, revenue: 1 }],
    by_location: [{ month: '2026-11-01', location: 'SYNTH Delhi', stakeholder: 'SYNTH Stakeholder A', target: 400, cases: 40, revenue_target: 1, revenue: 1 }, { month: '2026-10-01', location: 'SYNTH Delhi', stakeholder: 'SYNTH Stakeholder A', target: 380, cases: 300, revenue_target: 1, revenue: 1 }],
    by_client: [{ month: '2026-10-01', client: 'SYNTH BOM', target: 1, cases: 300, revenue: 1 }], by_person: [{ month: '2026-09-01', person: 'SYNTH Head', cases: 250, revenue: 1, target: 1 }, { month: '2026-10-01', person: 'SYNTH Head', cases: 300, revenue: 1, target: 1 }],
    daily: [{ d: '2026-11-02', cases: 20, revenue: 15000 }, { d: '2026-11-03', cases: 22, revenue: 15600 }], daily_tracker: [{ d: '2026-10-03', mtd_cases: 3672, mtd_revenue: 1, target: 84395 }] },
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
  tracker_export: { mode: 'full', as_of: today, month: '2026-11-01', prev_as_of: '2026-11-02', source: 'app', wd_done: 3, wd_total: 25, me: 'SYNTH Ops Head', roi_exclude: 'SYNTH Mumbai',
    rows: [
      { zone: 'SYNTH West Zone', zone_order: 1, zone_style: { header: 'BDD7EE', rollup: 'EAD1DC', total: 'C27BA0', leaf: 'FBE5D5', loc_total: 'F4B083' }, region: 'West', tier: 'Zone A', location: 'SYNTH Mumbai', loc_order: 1, client: 'SYNTH SBI', client_order: 2, rate: 300, target: 200, entry: 30, closure: 10, cancelled: 2, mtd: 28, prev_mtd: 20, revenue: 8400, stakeholder: 'SYNTH Stakeholder A', head: 'SYNTH Ravi' },
      { zone: 'SYNTH West Zone', zone_order: 1, zone_style: { header: 'BDD7EE', rollup: 'EAD1DC', total: 'C27BA0', leaf: 'FBE5D5', loc_total: 'F4B083' }, region: 'West', tier: 'Zone B', location: 'SYNTH Pune', loc_order: 2, client: 'SYNTH BOM Retail', client_order: 1, rate: 750, target: 50, entry: 10, closure: 3, cancelled: 0, mtd: 10, prev_mtd: 8, revenue: 7500, stakeholder: 'SYNTH Stakeholder A', head: null },
      { zone: 'SYNTH Delhi Zone', zone_order: 2, zone_style: { header: null, leaf: 'CFE2F3', total: '9FC5E8' }, region: 'North', tier: 'Zone A', location: 'SYNTH Delhi', loc_order: 3, client: 'SYNTH BOM Retail', client_order: 1, rate: 750, target: 400, entry: 40, closure: 20, cancelled: 0, mtd: 40, prev_mtd: 30, revenue: 30000, stakeholder: 'SYNTH Stakeholder B', head: 'SYNTH Ravi' }],
    history: [{ month: '2026-10-01', location: 'SYNTH Delhi', client: 'SYNTH BOM Retail', cases: 300, revenue: 225000, billing: 200000 }], people: [], team_members: [] },
  collections_board: { from: '2026-11-01', to: today, rows: [{ location: 'SYNTH Delhi', client: 'SYNTH BOM Retail', zone: 'SYNTH Delhi Zone', head: 'SYNTH Ravi', bill_count: 2, bill_amount: 1500, received: 900, reconciled: 600, followups: 3, promised: 500, days: 2, out_0_30: 4000, out_31_60: 1000, out_61_90: 0, out_90p: 250, as_of: today }],
    daily: [], promises_due: [{ date: '2026-11-05', location: 'SYNTH Delhi', client: 'SYNTH BOM Retail', amount: 500, by: 'SYNTH Ravi', entered: today }], missing: [{ person: 'SYNTH Asha', date: '2026-11-02' }] },
  leave_taken: [{ person_id: 'p2', full_name: 'SYNTH Ravi', month: '2026-11-01', planned: 1, unplanned: 0, absent: 1, half_day: 0 }],
  attrition: [{ month: '2026-10-01', opening: 20, joined: 2, left_: 1, closing: 21, attrition_pct: 5 }],
  month_close_check: { month: '2026-10-01', closed: false, closed_info: null, open_misses: 2, missing_rates: 1, unsubmitted_days: 0, uncertified: 0, collections_missing: 0, open_reopens: 0, cases: 1000, revenue: 500000, billed: 10000, received: 5000 },
  grant_reopen_many: { people: 3, grants: 6 },
  my_targets: { wd_done: 3, wd_total: 25, person_total: null, my_mtd: { entry: 12, closure: 8, cancelled: 0 }, rows: [{ client_location_id: 'cl1', mine: null, location: 400, my_mtd: { entry: 12, closure: 8, cancelled: 0 }, location_mtd: 40 }] },
  collections_view: { month: '2026-11-01', as_of: today, can_review: true, rows: [
    { branch_id: 'b1', client_id: 'c1', location: 'SYNTH Delhi', client: 'SYNTH BOM Retail', zone: 'SYNTH Delhi Zone', head: 'SYNTH Ravi', target: 50000, cases: 40,
      ar: { ar_lt30: 40000, ar_30_90: 20000, ar_90_180: 5000, ar_gt180: 1000, status: 'revised', review_note: 'SYNTH ledger check', reviewer: 'SYNTH Coll Head', original: { ar_lt30: 45000, ar_30_90: 20000, ar_90_180: 5000, ar_gt180: 1000 } },
      mtd: { bc: 3, ba: 15000, r1: 9000, r2: 1000, r3: 0, r4: 0, c1: 8000, c2: 500, c3: 0, c4: 0, days: 2 } },
    { branch_id: 'b1', client_id: 'c2', location: 'SYNTH Delhi', client: 'SYNTH IDBI', zone: 'SYNTH Delhi Zone', head: null, target: null, cases: 0, ar: null, mtd: null }] },
  save_ar: 1, save_collection_day: 1, review_ar: {},
  save_push_subscription: {}, stop_push_subscription: {}, mark_notifications_read: {},
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
  settings: [{ key: 'agreement_version', value: 'v1' }, { key: 'shift_start', value: '10:00', label: 'Shift starts at', help: 'Normal start of the working day.', kind: 'time', section: 'Working hours', editable: true, updated_at: iso('10:00') },
    { key: 'report_recipients', value: '', label: 'Revenue Status email goes to', help: 'Email addresses.', kind: 'emails', section: 'Reports', editable: true, updated_at: iso('10:00') }],
  leave_requests: [], leave_types: [], holidays: [], penalty_rules: [{ id: 'pr1', code: 'missed_report', description: 'Daily report not submitted', amount: 5000, financial_enabled: false, active: true }], certifications: [], collection_entries: [{ collection_date: today, amount_received: 25000 }], bill_entries: [],
  notifications: [{ id: 'n1', kind: 'miss', message: 'No daily figures reported for 02 Nov 2026', link: '/tasks', created_at: iso('10:00'), read_at: null }],
  tasks: [{ subject_id: 'p2' }],
  task_events: [{ action: 'created', note: 'x', data: null, at: iso('10:00'), persons: null }],
  agreement_versions: [{ version: 'v1', title: 'SYNTH agreement', body: 'Para one.\n\nPara two.' }],
  hr_profiles: [{ person_id: 'p2', date_of_birth: '1990-01-01', city: 'Pune', completed_at: iso('09:00') }],
  hr_compensation: [], agreement_acceptances: [{ person_id: 'p2', version: 'v1', accepted_at: iso('09:00'), typed_name: 'SYNTH Ravi', ip: '1.2.3.4', user_agent: 'test' }],
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
      if (m) { calls.push(m[1]); if (m[1] === 'accept_agreement' || m[1] === 'save_my_profile') globalThis.__gateStep = (globalThis.__gateStep ?? 0) + 1;
        const v = R[m[1]]; const d = typeof v === 'function' ? v(body) : v ?? [];
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
      for (const c of check) if (!(await page.locator('main').getByText(c, { exact: false }).locator('visible=true').first().isVisible().catch(() => false))) fails.push(`${vp.name} ${name}: missing "${c}"`);
      await page.screenshot({ path: `${OUT}${vp.name}-${name}.png`, fullPage: true });
    };
    await go('/', 'home', ["Enter today's numbers", 'Attendance today', 'Needs attention', 'Performance —', 'Projected month end', 'Stakeholders (Zonal Manager groups)', 'SYNTH Head']);
    await go('/productivity', 'myday', ['My day — daily entry', 'My clients', 'Pending by age', '✓ tallies', 'Receivables this month', 'Received today', 'Reconciled today', 'Collection target', 'Changed by the Collections Head', 'reported by SYNTH Asha', 'Location target 400', 'Certify my team', 'Daily message']);
    await page.getByText('My clients').first().click(); await page.waitForTimeout(400);
    await page.getByLabel('SYNTH IDBI at Delhi').click(); await page.waitForTimeout(700);
    if (!(await page.getByText(/SYNTH IDBI · Delhi: active/).isVisible())) fails.push(`${vp.name} client tick did not confirm`);
    await page.getByRole('button', { name: /Team roll-up here/ }).first().click(); await page.waitForTimeout(300);
    if (!(await page.getByText('SYNTH Ravi').first().isVisible())) fails.push(`${vp.name} team expand missing person`);
    await page.getByRole('button', { name: 'Edit' }).first().click(); await page.waitForTimeout(200);
    if (!(await page.getByText(/Correct SYNTH Ravi's SYNTH BOM Retail entry/).isVisible())) fails.push(`${vp.name} team edit missing`);
    await go('/tasks', 'tasks', ['Tasks & misses', 'Admin queue', 'No per-case rate for SYNTH SBI', 'Enter rate']);
    await page.getByRole('button', { name: 'Enter rate' }).first().click(); await page.waitForTimeout(400);
    for (const c of ['Rate ₹ per case', 'Resolve now', 'Ask for details', 'Deny']) if (!(await page.getByRole('dialog').getByText(c).first().isVisible().catch(() => false))) fails.push(`${vp.name} task popup missing ${c}`);
    await page.screenshot({ path: `${OUT}${vp.name}-task-popup.png` });
    await page.getByRole('button', { name: 'Close' }).click(); await page.waitForTimeout(200);
    await page.getByRole('tab', { name: /Mine/ }).click(); await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Resolve' }).first().click(); await page.waitForTimeout(400);
    if (!(await page.getByRole('dialog').getByText(/Reopen 2026-11-02 for them/).isVisible().catch(() => false))) fails.push(`${vp.name} miss popup: reopen missing`);
    await page.getByRole('button', { name: 'Close' }).click(); await page.waitForTimeout(200);
    await page.getByRole('tab', { name: /My team/ }).click(); await page.waitForTimeout(300);
    if (!(await page.getByText('Client paused files').first().isVisible())) fails.push(`${vp.name} tasks: team reply missing`);
    await go('/profile', 'profile', ['last 4', 'Salary and agreement']);
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
    await go('/reports', 'zonal-tracker', ['Zonal Tracker', 'Whole business', 'Total SYNTH West Zone', 'Total SYNTH Delhi', 'Pan India', 'ROI', 'Client Wise Business', 'Operation Stakeholders', 'Zone A']);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.getByRole('button', { name: 'Download Excel' }).click()]);
    if (!dl) fails.push(`${vp.name} tracker download did not start`); else if (vp.name === 'desktop') await dl.saveAs(`${OUT}tracker-download.xlsx`);
    await go('/', 'home-collections', ['Collections —', 'Receivables (start of month)', 'Client-wise collections', 'Revised by SYNTH Coll Head', 'Billed / case', 'Dispute / change']);
    await page.getByRole('button', { name: 'Dispute / change' }).first().click(); await page.waitForTimeout(300);
    if (!(await page.getByRole('dialog').getByText('Why are you changing it?').isVisible().catch(() => false))) fails.push(`${vp.name} AR dispute popup missing`);
    await page.getByRole('button', { name: 'Close' }).click(); await page.waitForTimeout(200);
    await go('/notifications', 'notifications', ['Notifications', 'Phone notifications', 'App installed', 'Messages']);
    await go('/attendance', 'leave-taken', ['Leave taken']);
    await page.getByRole('tab', { name: 'Leave taken' }).click(); await page.waitForTimeout(500);
    if (!(await page.getByText('P1 A1').first().isVisible())) fails.push(`${vp.name} leave taken table missing`);
    await go('/reports', 'reports-attrition', ['Attrition']);
    await page.getByRole('tab', { name: 'Attrition' }).click(); await page.waitForTimeout(500);
    if (!(await page.getByText('Attrition — last 12 months').isVisible())) fails.push(`${vp.name} attrition missing`);
    await go('/reports', 'zonal-tracker-2', ['Zonal Tracker']);
    await page.getByRole('tab', { name: 'Revenue Status' }).click(); await page.waitForTimeout(700);
    for (const c of ['Key points', 'Stakeholder scorecard', 'Copy formatted email']) if (!(await page.getByText(c).first().isVisible())) fails.push(`${vp.name} revenue status missing ${c}`);
    await page.screenshot({ path: `${OUT}${vp.name}-revenue-status.png`, fullPage: true });
    const admin = async (name, check) => {
      if (vp.name === 'mobile') await page.getByLabel('Admin section', { exact: true }).selectOption({ label: name });
      else await page.getByLabel('Admin section (desktop)').selectOption({ label: name });
      await page.waitForTimeout(700);
      for (const c of check) if (!(await page.getByText(c).first().isVisible().catch(() => false))) fails.push(`${vp.name} admin ${name}: missing "${c}"`);
      await page.screenshot({ path: `${OUT}${vp.name}-admin-${name.replace(/\W+/g, '-')}.png`, fullPage: true });
    };
    if (vp.name === 'mobile') { await page.getByRole('button', { name: 'Menu' }).click(); await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}mobile-menu.png`, fullPage: true });
      for (const c of ['My work', 'Team', 'Reports', 'Admin', 'Zonal Tracker', 'Reopen days', 'performance & collections']) if (!(await page.getByRole('dialog', { name: 'Menu' }).getByText(c).locator('visible=true').first().isVisible().catch(() => false))) fails.push(`mobile menu missing ${c}`);
      await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'People', exact: true }).click(); await page.waitForTimeout(900); }
    else await go('/admin', 'admin', ['Every change is recorded']);
    await admin('People', ['Add a team member']);
    await page.getByRole('button', { name: 'Edit' }).first().click(); await page.waitForTimeout(800);
    for (const c of ['Roles', 'Reports to', 'Locations they head']) if (!(await page.getByRole('heading', { name: c, exact: true }).isVisible())) fails.push(`${vp.name} person editor missing ${c}`);
    await page.screenshot({ path: `${OUT}${vp.name}-admin-person.png`, fullPage: true });
    await page.getByRole('button', { name: /Back to people/ }).click(); await page.waitForTimeout(300);
    await admin('Agreements & profiles', ['Signed v1', '1.2.3.4']);
    await admin('Locations & heads', ['Stakeholder groups', 'SYNTH Delhi']);
    await admin('Monthly targets', ['Fill from last month', 'Revenue target']);
    await admin('Settings', ['Shift starts at', 'Revenue Status email goes to']);
    await admin('Bulk upload', ['Download template']);
    await admin('Reopen days', ['Locations (everyone working there)', 'Daily figures (several people, locations, dates)']);
    await admin('Leave, holidays & policies', ['Leave types and monthly credits', 'No leave types.', 'Holidays — national and regional', 'Penalty rules']);
    await admin('Month close & backup', ['Open misses in the month', 'Download backup', 'tools/restore_backup.sql']);
    await ctx.close();
  }
  // Gate: a user who has not signed / completed the profile sees only the agreement, then the profile.
  globalThis.__gate = true;
  const g = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await g.addInitScript(() => localStorage.setItem('sb-gizzonxfwsqfwgjyqzxc-auth-token', JSON.stringify({ access_token: 'x', refresh_token: 'y', token_type: 'bearer',
    expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: 'u1', aud: 'authenticated', role: 'authenticated' } })));
  await g.route(/supabase\.co\//, async (route) => {
    const u = new URL(route.request().url()); const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u.pathname);
    if (m) { if (m[1] === 'whoami') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((globalThis.__gateStep ?? 0) >= 1 ? { ...gateMe, agreement_ok: true } : gateMe) });
      if (m[1] === 'accept_agreement') globalThis.__gateStep = 1; return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    const t = /\/rest\/v1\/(\w+)/.exec(u.pathname); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TABLES[t?.[1]] ?? []) });
  });
  const gp = await g.newPage(); gp.on('pageerror', (e) => errors.push(`gate: ${e.message}`));
  await gp.goto('http://localhost:4319/#/'); await gp.waitForTimeout(1200);
  if (!(await gp.getByText('SYNTH agreement').isVisible())) fails.push('gate: agreement not shown first');
  if (await gp.getByText('My day').count()) fails.push('gate: app reachable before signing');
  for (const cb of await gp.locator('input[type=checkbox]').all()) await cb.check();
  await gp.getByLabel(/Type your full name/).fill('SYNTH Ops Head');
  await gp.getByRole('button', { name: 'I agree and sign' }).click(); await gp.waitForTimeout(1200);
  if (!(await gp.getByText('Complete your profile to start').isVisible())) fails.push('gate: profile step not shown after signing');
  await gp.screenshot({ path: `${OUT}gate-profile.png`, fullPage: true });
  await g.close();
} finally { await browser.close(); srv.kill(); }
console.log(JSON.stringify({ errors, fails, rpcCalls: [...new Set(calls)].sort() }, null, 1));
process.exit(errors.length || fails.length ? 1 : 0);
