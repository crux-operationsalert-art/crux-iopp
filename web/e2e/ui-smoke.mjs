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
  company: { name: 'SYNTH Company Pvt. Ltd.', place: 'Pune', website: 'synth.test', address: '' }, products: ['SYNTH IDBI'], ea_for: [], hr: false, reports_figures: true };
const gateMe = { ...me, agreement_ok: false, profile_missing: ['PAN card (scan)'], profile: { pct: 87, done: 13, total: 15, missing: ['PAN card (scan)', 'Aadhaar card (scan)'], due_at: '2026-11-06T12:00:00Z', blocking: false } };
const mem = (id, st, res, recv, closed, roll, tat) => ({ person_id: id, status: st, resolved: res, recv, logged: recv, closed, cancelled: 0, rollover: roll, pending: roll + recv - closed, rev: recv * 500,
  tat, has_tat: res, mtd_recv: recv * 3, mtd_closed: closed * 3, mtd_cancelled: 0, mtd_rev: recv * 1500 });
const dailyBoard = { date: today, window: 'open', manager: true, certified: false,
  people: { p1: { name: 'SYNTH Ops Head', designation: 'Operations Head', path: [], direct: false }, p2: { name: 'SYNTH Ravi', designation: 'Executive', path: ['p2'], direct: true },
    p3: { name: 'SYNTH BM Nashik', designation: 'BM', path: ['p3'], direct: true }, p4: { name: 'SYNTH Meera', designation: 'Executive', path: ['p3', 'p4'], direct: false } },
  tiles: [
    { branch_id: 'b1', branch: 'SYNTH Pune', client_id: 'c1', client: 'SYNTH IDBI', mine: true, validated_at: null,
      self: { recv: 4, logged: 4, closed: 3, cancelled: 0, rollover: 10, pending: 11, rev: 2000, status: 'draft', mtd_recv: 12, mtd_closed: 9, mtd_cancelled: 0, mtd_rev: 6000 },
      members: [mem('p1', 'draft', false, 4, 3, 10, [5, 3, 2, 1, 0, 0]), mem('p2', 'submitted', true, 6, 4, 8, [4, 3, 2, 1, 0, 0]), mem('p3', 'submitted', true, 2, 2, 5, [3, 1, 1, 0, 0, 0]), mem('p4', 'pending', false, 0, 0, 7, [0, 0, 0, 0, 0, 0])],
      coll: { is_head: true, entered_today: true, received_today: 25000, reconciled_today: 20000, bills_today: 2, billed_today: 40000, collected_mtd: 90000, target: 300000, receivables: 500000, billed_mtd: 120000 } },
    { branch_id: 'b2', branch: 'SYNTH Nashik', client_id: 'c2', client: 'SYNTH BOM', mine: false, validated_at: null, self: null,
      members: [mem('p3', 'submitted', true, 3, 1, 4, [2, 2, 1, 1, 0, 0])],
      coll: { is_head: false, entered_today: false, collected_mtd: 0, target: null, receivables: null, billed_mtd: 0 } }] };
const personProfile = { person: { id: 'p2', full_name: 'SYNTH Ravi', designation: 'Executive', mobile: '9800000002', email: 'ravi@synth.test', status: 'active', resource_type: 'own_employee' },
  managers: [{ function: 'operations', name: 'SYNTH Ops Head', designation: 'Operations Head' }],
  profile: { date_of_birth: '1990-01-01', joining_date: '2025-01-01', current_address: 'SYNTH addr', permanent_address: 'SYNTH addr', city: 'Pune', state: 'MH', pincode: '411001',
    emergency_name: 'SYNTH Kin', emergency_relation: 'Sibling', emergency_phone: '9000000000', highest_qualification: 'Graduate' },
  identity: { aadhaar: '234567890124', aadhaar_source: 'scan', pan: 'ABCPS1234F', pan_source: 'edited', bank_account: '301234567890', bank_ifsc: 'SBIN0001234', bank_name: 'State Bank of India', bank_source: 'scan' },
  full_ids: true, issues: [{ code: 'qualification', label: 'Qualification', detail: 'Upload certificate.', severity: 'low' }], documents: [{ doc_type: 'aadhaar', file_name: 'a.jpg', uploaded_at: iso('10:00'), verified: false, rejected: false }],
  progress: { pct: 87, done: 13, total: 15, missing: ['qualification certificate (upload)'], due_at: '2026-11-06T12:00:00Z', blocking: false },
  commitment: { today: 70, month_avg: 82, checked_in: true } };
const rep = (loc, cl, id, e, c, x) => ({ zone: 'SYNTH Delhi Zone', location: loc, client: cl, client_location_id: id, entry: e, closure: c, cancelled: x, mtd_entry: e * 3, mtd_closure: c * 3, mtd_cancelled: x, people: 2 });
const board = (id, n, st, cat, sub, conf, direct = true) => ({ person_id: id, full_name: n, is_direct: direct, scheduled: 3, present: 2, half_day: 0, absent: 0, planned_leave: 0, unplanned_leave: 0,
  pending: 0, unconfirmed: 1, shrinkage_pct: 0, unplanned_streak: 0, day_status: st, day_category: cat, day_sub: sub, day_confirmed: conf, day_basis: conf ? 'Confirmed' : 'Auto: reported figures', day_reason: null });
const zrow = (region, zone, loc, client, st, t, rate, mtd, prev, e, c, x) => ({ region, zone, location: loc, client, stakeholder: st, head: 'SYNTH Head', rate, target_cases: t, revenue_target: t * rate,
  mtd_cases: mtd, mtd_revenue: mtd * rate, prev_cases: prev, prev_revenue: prev * rate, reported_added: mtd - prev, entry_today: e, closure_today: c, cancelled_today: x, mtd_entry: mtd, mtd_closure: 0, mtd_cancelled: 0, unrated_lines: 0 });
const svcRow = (id, client, loc, active, mine) => ({ client_location_id: id, client_id: 'c' + id, client, location_id: 'l' + loc, location: loc, branch_id: 'b1', zone: 'SYNTH Delhi Zone', active, since: active ? '2026-11-01' : null, my_location: mine });
const R = {
  whoami: () => (globalThis.__gate ? gateMe : me),
  my_salary: { self_service: true, eligible: true, plb_default_pct: 20, current: null, pf_opted: true, declarations: [] },
  salary_preview: (b) => { const a = Number(b?.p?.amount ?? 480000); const plb = b?.p?.plb ? Number(b.p.plb_pct) : 0; const g = b?.p?.mode === 'inhand' ? 40000 : Math.round(a * (1 - plb / 100) / 12);
    return { gross: g, basic: g / 2, hra: g / 5, special: g * 0.3, pf_wage: Math.min(g / 2, 25000), pf_employee: 2400, pf_employer: 2400, pf_admin: 0, esi_employee: 0, esi_employer: 0, pt: 200, pt_known: true,
      in_hand: g - 5000, pf_cap: 25000, esi_limit: 21000, mode: b?.p?.mode ?? 'ctc', amount: a, pf: true, pf_forced: false, plb: !!b?.p?.plb, plb_pct: plb, fixed_annual: g * 12,
      plb_annual: Math.round(g * 12 * plb / (100 - plb)), ctc_annual: g * 12 + Math.round(g * 12 * plb / (100 - plb)), in_hand_annual: (g - 5000) * 12, pt_state: 'MH', notes: plb ? ['PLB is part of CTC and is paid on performance (not in the monthly salary).'] : [], pf_optout_allowed: false }; },
  declare_salary: { id: 'd1' }, report_client: null,
  chat_ping: null, chat_unread: 2,
  chat_threads: [{ id: 't1', kind: 'direct', title: 'SYNTH Ravi', ref: null, members: 2, last_body: 'Is the 13 right?', last_sender: 'SYNTH Ravi', last_at: '2026-11-03T11:00:00Z', unread: 2, desk: null, other: 'p2',
    availability: { state: 'online', label: 'Online', online: true, alerts: 'phone', seen: '2026-11-03T11:00:00Z' } }],
  chat_messages: [{ id: 1, sender_id: 'p2', sender: 'SYNTH Ravi', body: 'Is the 13 right?', ref: null, created_at: '2026-11-03T11:00:00Z', mine: false }],
  chat_members_of: [{ person_id: 'p2', full_name: 'SYNTH Ravi', designation: 'Executive', availability: { state: 'online', label: 'Online', online: true, alerts: 'phone', seen: null } }],
  chat_read: null,
  self_check_in: '2026-11-03T09:50:00Z', save_plan: null, close_plan: null,
  my_plan: { work_date: '2026-11-03', checked_in_at: null, planned: null, plan: {}, plan_note: null, done_note: null, closed_at: null, committed_at: null, planned_total: 0, actual_total: 0, actual: {}, commitment_pct: null,
    lines: [{ client_location_id: 'cl1', client: 'SYNTH BOM Retail', location: 'SYNTH Delhi' }] },
  commitment_meter: { n: 6, checked_in: 4, planned: 3, avg_commitment: 72 },
  team_scores: { month: '2026-11-01', can_lock: true, window_open: true, open_month: '2026-11-01', hr_view: true,
    rows: [{ person_id: 'p2', full_name: 'SYNTH Ravi', designation: 'Executive', status: 'self', self_done: true, can_edit: true, final: null, kpi_final: null, attr_final: null }] },
  my_review: { month: '2026-11-01', window_open: true, open_month: '2026-11-01', self_done: false, self_kpi: null, self_attr: null, self_note: null, locked: false,
    final: null, kpi_final: null, attr_final: null, manager_note: null, breakdown: null,
    sheet: { weights: { kpi: 0.75, attr: 0.25 }, final: 6.1,
      kpi: { given: 7, measures: { achievement_pct: 92, late_share: 0.1, miss_share: 0, commitment_avg: 85, reported_days: 10, required_days: 10 }, adjustments: { achievement: 0, tat: -0.5, commitment: 0, attendance: 0 }, final: 6.5 },
      attr: { given: 7, is_manager: false, measures: { miss_share: 0, team_size: 0, team_exits: 0, team_achievement: null, achievement_now: 92, achievement_prev: 80 }, adjustments: { self_shrinkage: 0, team_shrinkage: 0, team_performance: 0, growth: 1 }, final: 8 } } },
  score_preview: { person_id: 'p2', month: '2026-11-01', full_name: 'SYNTH Ravi', designation: 'Executive', status: 'self', window_open: true, can_edit: true, self_done: true, self_kpi: 7, self_attr: 7, self_note: 'My take', kpi_given: null, attr_given: null, note: null, locked: false,
    sheet: { weights: { kpi: 0.75, attr: 0.25 }, final: 6.1,
      kpi: { given: 7, measures: { achievement_pct: 92, late_share: 0.1, miss_share: 0, commitment_avg: 85, reported_days: 10, required_days: 10 }, adjustments: { achievement: 0, tat: -0.5, commitment: 0, attendance: 0 }, final: 6.5 },
      attr: { given: 7, is_manager: false, measures: { miss_share: 0, team_size: 0, team_exits: 0, team_achievement: null, achievement_now: 92, achievement_prev: 80 }, adjustments: { self_shrinkage: 0, team_shrinkage: 0, team_performance: 0, growth: 1 }, final: 8 } } },
  self_score: { ok: true }, save_score: { ok: true }, lock_score: { ok: true }, reopen_score: { ok: true }, save_weekly_review: { ok: true }, weekly_reviews: [],
  team_commitment: [{ person_id: 'p2', full_name: 'SYNTH Ravi', checked_in: true, checked_in_at: '2026-11-03T09:40:00Z', planned_total: 10, actual_total: 7, commitment_pct: 70, plan_note: 'SBI Pune backlog', done_note: null }],
  my_data_issues: [], record_activity: null, bank_list: [{ ifsc_code: 'HDFC', name: 'HDFC Bank', kind: 'private' }, { ifsc_code: 'SBIN', name: 'State Bank of India', kind: 'psb' }],
  person_activity: { total_seconds: 5400, days: [{ day: '2026-11-01', seconds: 1800 }], by_hour: Array.from({ length: 24 }, (_, h) => (h === 11 ? 3000 : h === 15 ? 2400 : 0)), busiest_hour: 11, last_active: '2026-11-03T11:30:00Z', from: '2026-10-13' },
  data_quality: { total_people: 46, clean: 40, by_problem: [{ code: 'bank_name', label: 'Bank name', severity: 'high', count: 3 }, { code: 'aadhaar', label: 'Aadhaar number', severity: 'high', count: 2 }],
    people: [{ person_id: 'p2', full_name: 'SYNTH Ravi', designation: 'Executive', resource_type: 'own_employee', status: 'active', n: 2, high: 1, issues: [{ code: 'bank_name', label: 'Bank name', detail: 'Pick your bank.', severity: 'high' }, { code: 'email', label: 'Email', detail: 'Add email.', severity: 'low' }] }] },
  ops_anomalies: { month: '2026-11-01', not_reported: [{ person_id: 'p4', full_name: 'SYNTH Meera', date: '2026-11-02' }], not_reported_count: 1, untallied: [] },
  remind_corrections_now: 5, add_bank: null,
  usage_report: { from: '2026-10-13', days: 21, total_seconds: 90000, by_hour: Array.from({ length: 24 }, (_, h) => (h === 11 ? 40000 : h === 15 ? 30000 : h === 18 ? 20000 : 0)), total_people: 46, active_people: 38,
    people: [{ person_id: 'p2', full_name: 'SYNTH Ravi', designation: 'Executive', total_seconds: 5400, days_active: 12, busiest_hour: 11, installed: true, last_active: '2026-11-03T11:30:00Z' },
      { person_id: 'p4', full_name: 'SYNTH Meera', designation: 'Executive', total_seconds: 1200, days_active: 4, busiest_hour: 18, installed: false, last_active: '2026-11-02T18:00:00Z' }] },
  adoption_report: { days: 7, overall: { total: 46, invited: 8, activated: 38, installed: 25, browser_only: 10, never_opened: 3, active: 30, inactive: 8, profile_complete: 20, profile_pending: 26 },
    teams: [{ manager_id: 'p3', manager: 'SYNTH BM Nashik', members: 6, activated: 5, active: 4, profile_complete: 2, profile_pending: 4 }],
    people: [{ person_id: 'p2', full_name: 'SYNTH Ravi', designation: 'Executive', status: 'active', manager: 'SYNTH BM Nashik', activated: true, installed: true, active: true, profile_complete: false, last_seen: '2026-11-03T11:30:00Z' }] },
  help_desks: [{ key: 'ops', title: 'Operations', blurb: '', people: [], mine: false, can_manage: false }, { key: 'hr', title: 'HR', blurb: '', people: [{ person_id: 'p9', full_name: 'SYNTH HR', designation: 'HR', role: 'owner', availability: { state: 'leave', label: 'On leave today', online: false, alerts: null, seen: null } }], mine: false, can_manage: false },
    { key: 'finance', title: 'Finance & accounts', blurb: '', people: [], mine: false, can_manage: true }, { key: 'app', title: 'App support', blurb: '', people: [], mine: false, can_manage: false }],
  salary_declarations_list: [{ id: 'd1', person_id: 'p2', full_name: 'SYNTH Ravi', designation: 'Executive', mode: 'ctc', amount: 480000, pf_opted: true, plb_opted: true, plb_pct: 20, effective_from: '2026-11-01',
    calc: { gross: 32000, basic: 16000, hra: 6400, special: 9600, pf_wage: 16000, pf_employee: 1920, pf_employer: 1920, pf_admin: 0, esi_employee: 0, esi_employer: 0, pt: 200, pt_known: true, in_hand: 27960,
      pf_cap: 25000, esi_limit: 21000, mode: 'ctc', amount: 480000, pf: true, pf_forced: false, plb: true, plb_pct: 20, fixed_annual: 384000, plb_annual: 96000, ctc_annual: 480000, in_hand_annual: 335520, pt_state: 'MH', notes: [], pf_optout_allowed: false },
    status: 'proposed', created_at: iso('10:00'), current_gross: null, decided_by: null, decided_at: null, note: null }],
  daily_board: dailyBoard, person_profile: personProfile, scannable_documents: [], nudge_people: 1, validate_client: { validated: true, clients_left: 1, day_certified: false },
  my_day: { work_date: today, window: 'open', reopened: false, deadline: iso('23:59'), grace_deadline: '2026-11-04T10:00:00+05:30',
    status: { status: 'submitted', submitted_at: iso('17:00'), late: false },
    money: [{ branch_id: 'b1', branch: 'SYNTH Delhi', client_id: 'c1', client: 'SYNTH BOM Retail', target: 50000, is_head: true, head: 'SYNTH Ops Head', entered_by: null, prev: null,
      ar: { ar_lt30: 40000, ar_30_90: 20000, ar_90_180: 5000, ar_gt180: 1000, status: 'revised', review_note: 'SYNTH ledger check', original: { ar_lt30: 45000, ar_30_90: 20000, ar_90_180: 5000, ar_gt180: 1000 } },
      mtd: { bc: 3, ba: 15000, r1: 9000, r2: 1000, r3: 0, r4: 0, c1: 8000, c2: 500, c3: 0, c4: 0 },
      day: { bill_count: 1, bill_amount: 5000, rcv_lt30: 3000, rcv_30_90: 0, rcv_90_180: 0, rcv_gt180: 0, rec_lt30: 2000, rec_30_90: 0, rec_90_180: 0, rec_gt180: null } }],
    money_others: [{ branch: 'SYNTH Pune', client: 'SYNTH SBI', by: 'SYNTH Asha' }],
    rows: [{ client_location_id: 'cl1', client: 'SYNTH BOM Retail', location: 'Delhi', process: 'Verification', entry: 12, logged: 10, closure: 8, cancelled: 0, rate: 750, billable_event: 'entry',
      opening_pending: 5, opening_wip: 5, wip_seeded: true, source: null, tat_0_1: 4, tat_1_2: 3, tat_2_4: 2, tat_4_7: 0, tat_7_15: 0, tat_15p: 0, tat_note: null }] },
  team_lines: [{ person_id: 'p2', full_name: 'SYNTH Ravi', client_location_id: 'cl1', client: 'SYNTH BOM Retail', location: 'Delhi', entry: 5, closure: 2, cancelled: 0, pending: 3, source: 'self', reason: null, status: 'submitted' },
    { person_id: 'p3', full_name: 'SYNTH Asha', client_location_id: 'cl9', client: 'SYNTH SBI', location: 'Pune', entry: 2, closure: 1, cancelled: 0, pending: 1, source: 'self', reason: null, status: 'submitted' }],
  save_pending: 1, save_money_day: 1, sync_tasks: { open: 2 }, task_reply: {}, task_request_resolution: {}, admin_decide_task: {}, accept_agreement: {}, save_my_profile: { missing: [], complete: true },
  my_tasks: [
    { id: 't1', kind: 'missed_submission', category: 'miss', title: 'No daily figures reported for 02 Nov 2026', detail: {}, status: 'open', condition_cleared: false, owner_id: 'p1', owner_name: 'SYNTH Ops Head', subject_name: 'SYNTH Ops Head', branch: null, client: null, ref_date: '2026-11-02', ref_month: null, created_at: iso('10:00'), updated_at: iso('10:00'), scope: 'mine', last_note: null, last_action: 'created', last_at: iso('10:00') },
    { id: 't2', kind: 'missing_rate', category: 'task', title: 'No per-case rate for SYNTH SBI at SYNTH Pune', detail: {}, status: 'resolution_requested', condition_cleared: false, owner_id: 'p5', owner_name: 'SYNTH ZM', subject_name: null, branch: 'SYNTH Pune', client: 'SYNTH SBI', ref_date: null, ref_month: null, created_at: iso('10:00'), updated_at: iso('11:00'), scope: 'admin', last_note: 'Client letter', last_action: 'proposal', last_at: iso('11:00') },
    { id: 't4', kind: 'assigned', category: 'task', title: 'SYNTH call the branch', detail: { note: 'About pending files', by: 'SYNTH Ops Head', due: '2026-11-10' }, status: 'open', condition_cleared: false, owner_id: 'p2', owner_name: 'SYNTH Ravi', subject_name: 'SYNTH Ravi', branch: null, client: null, ref_date: null, ref_month: null, created_at: iso('10:00'), updated_at: iso('10:30'), scope: 'assigned', last_note: null, last_action: 'created', last_at: iso('10:00') },
    { id: 't3', kind: 'behind_target', category: 'miss', title: 'SYNTH Pune · SYNTH SBI is behind target this month', detail: { target: 200, actual: 2, pro_rata: 24, achievement_pct: 1, elapsed_pct: 12, working_day: 3, working_days: 25 }, status: 'replied', condition_cleared: false, owner_id: 'p2', owner_name: 'SYNTH Ravi', subject_name: null, branch: 'SYNTH Pune', client: 'SYNTH SBI', ref_date: null, ref_month: '2026-11-01', created_at: iso('10:00'), updated_at: iso('12:00'), scope: 'team', last_note: 'Client paused files', last_action: 'reply', last_at: iso('12:00') },
    { id: 't5', kind: 'assigned', category: 'task', title: 'SYNTH migrate the SBI backlog', detail: { note: 'As a team', by: 'SYNTH Ops Head' }, status: 'open', condition_cleared: false, owner_id: 'p2', owner_name: 'SYNTH Ravi', subject_name: null, branch: null, client: null, ref_date: null, ref_month: null, created_at: iso('10:00'), updated_at: iso('10:30'), scope: 'admin', last_note: null, last_action: 'created', last_at: iso('10:00'), assignment: 'team', lead_name: 'SYNTH Ravi', cadence: 'weekly', next_update_due: '2026-11-10', members: [{ name: 'SYNTH Ravi', is_lead: true }, { name: 'SYNTH Exec Two', is_lead: false }] }],
  perf_dashboard: { month: '2026-11-01', today, wd_done: 3, wd_total: 25, team: { month: '2026-11-01', as_of: today, wd_done: 3, wd_total: 25, people: [{ person_id: 'p1', person: 'SYNTH Ops Head', self: true, has_team: true, revenue_target: 900000, revenue: 30600, collection_target: 400000, collection: 9000, revenue_passed_down: 700000, collection_passed_down: 400000 }, { person_id: 'p2', person: 'SYNTH Ravi', self: false, has_team: false, revenue_target: 700000, revenue: 20000, collection_target: 400000, collection: 9000, revenue_passed_down: null, collection_passed_down: null }] },
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
  my_targets: { wd_done: 3, wd_total: 25, set_by: 'SYNTH ZM', style: 'client', revenue: { target: 90000, mtd: 9000 }, collection: { target: 50000, mtd: 9000 }, rows: [{ client_location_id: 'cl1', branch_id: 'b1', client_id: 'c1', rate: 750, prev: { entry: 30, closure: 20, cancelled: 1, revenue: 21750 }, mine: { cases: 120, revenue: 90000, collection: 50000 }, my_mtd: { cases: 12, revenue: 9000 }, location: { cases: 400, revenue: 300000 }, location_mtd: { cases: 40, revenue: 30000 } }] },
  team_targets: { month: '2026-11-01', as_of: today, wd_done: 3, wd_total: 25, people: [{ person_id: 'p1', person: 'SYNTH Ops Head', self: true, has_team: true, revenue_target: 900000, revenue: 30600, collection_target: 400000, collection: 9000, revenue_passed_down: 700000, collection_passed_down: 400000 }, { person_id: 'p2', person: 'SYNTH Ravi', self: false, has_team: false, revenue_target: 700000, revenue: 20000, collection_target: 400000, collection: 9000, revenue_passed_down: null, collection_passed_down: null }] },
  target_template: { month: '2026-11-01', locked: false, lock_at: '2026-11-07T23:59:00+05:30', people: [{ person_id: 'p2', person: 'SYNTH Ravi', designation: 'Executive', manager: 'SYNTH Ops Head', style: null, revenue: null, collection: null, cases: null }], rows: [{ person_id: 'p2', person: 'SYNTH Ravi', branch_id: 'b1', client_id: 'c1', location: 'SYNTH Delhi', client: 'SYNTH BOM Retail', zone: 'SYNTH Delhi Zone', rate: 750, cases: null, revenue: null, collection: null, last_cases: 100, last_revenue: 75000 }] },
  my_collection_others: [{ branch_id: 'b2', branch: 'SYNTH Pune', client_id: 'c9', client: 'SYNTH SBI', head: 'SYNTH Asha', target: 20000, ar: { ar_lt30: 10000, ar_30_90: 0, ar_90_180: 0, ar_gt180: 0 }, agg: { t_rcv: 500, t_rec: 0, t_bc: 1, t_ba: 900, p1: 2000, p2: 0, p3: 0, p4: 0, mtd_rcv: 2500, mtd_rec: 2000, mtd_bc: 3, mtd_ba: 2700 } }],
  save_targets: { rows: [], errors: 0, applied: false, totals: { revenue: 0, collection: 0, cases: 0 } },
  collections_view: { month: '2026-11-01', as_of: today, can_review: true, rows: [
    { branch_id: 'b1', client_id: 'c1', location: 'SYNTH Delhi', client: 'SYNTH BOM Retail', zone: 'SYNTH Delhi Zone', head: 'SYNTH Ravi', target: 50000, cases: 40,
      ar: { ar_lt30: 40000, ar_30_90: 20000, ar_90_180: 5000, ar_gt180: 1000, status: 'revised', review_note: 'SYNTH ledger check', reviewer: 'SYNTH Coll Head', original: { ar_lt30: 45000, ar_30_90: 20000, ar_90_180: 5000, ar_gt180: 1000 } },
      mtd: { bc: 3, ba: 15000, r1: 9000, r2: 1000, r3: 0, r4: 0, c1: 8000, c2: 500, c3: 0, c4: 0, days: 2 } },
    { branch_id: 'b1', client_id: 'c2', location: 'SYNTH Delhi', client: 'SYNTH IDBI', zone: 'SYNTH Delhi Zone', head: null, target: null, cases: 0, ar: null, mtd: null }] },
  save_ar: 1, save_collection_day: 1, review_ar: {},
  assignable_people: [{ id: 'p2', full_name: 'SYNTH Ravi', designation: 'Executive', relation: 'My team' }, { id: 'p5', full_name: 'SYNTH ZM', designation: 'Zonal Manager', relation: 'Peer' }],
  assign_task: 1, post_task_update: { ok: true }, request_target_reopen: 't9', send_alert: 2, add_client: 'c9', register_document: 'd1', verify_document: {}, set_police_verification: {},
  product_dashboard: { month: '2026-11-01', as_of: today, wd_done: 3, wd_total: 25, products: [{ product: 'SYNTH IDBI', client: 'SYNTH IDBI' }],
    by_location: [{ branch_id: 'b1', client_id: 'c2', location: 'SYNTH Delhi', client: 'SYNTH IDBI', zone: 'SYNTH Delhi Zone', head: 'SYNTH Ravi', t: 100, rt: 50000, colt: 20000, cases: 10, rev: 5000, rcv: 3000, rec: 2000, ba: 4000 }],
    by_person: [{ person: 'SYNTH Asha', person_id: 'p3', client: 'SYNTH IDBI', location: 'SYNTH Delhi', cases: 10, revenue: 5000, entry: 11, closure: 4, cancelled: 1 }],
    trend: [{ month: '2026-10-01', cases: 90, revenue: 45000 }, { month: '2026-11-01', cases: 10, revenue: 5000 }], daily: [] },
  product_lines: [{ person_id: 'p3', person: 'SYNTH Asha', client_location_id: 'cl2', client: 'SYNTH IDBI', location: 'Delhi', entry: 3, closure: 1, cancelled: 0, source: 'self', reason: null }],
  police_status: [{ person_id: 'p2', full_name: 'SYNTH Ravi', designation: 'Executive', manager: 'SYNTH Ops Head', status: 'not_started', applied_on: null, verified_on: null, reference: null, due: '2026-12-09', overdue_days: 0, docs: 0, updated_at: null }],
  hr_repository: [{ person_id: 'p2', full_name: 'SYNTH Ravi', designation: 'Executive', status: 'invited', resource_type: 'own_employee', roles: 'executive', manager: 'SYNTH Ops Head', location: null, joining_date: null,
    profile_complete: true, agreement_signed: true, docs: { aadhaar: { n: 1, verified: 0, rejected: 0 } }, police: 'not_started', police_due: '2026-12-09', salary: null, salary_from: null, partner: null }],
  ar_carry: [],
  team_attendance_month: ['2026-11-01', '2026-11-02', '2026-11-03'].flatMap((d, i) => [
    { person_id: 'p2', full_name: 'SYNTH Ravi', designation: 'Executive', work_date: d, status: i === 1 ? 'weekly_off' : 'present', final: i === 0, source: i === 0 ? 'manager' : null, reason: null, auto: i === 1 ? 'weekly_off' : 'present' },
    { person_id: 'p3', full_name: 'SYNTH Asha', designation: 'Executive', work_date: d, status: i === 2 ? 'absent' : 'present', final: false, source: null, reason: null, auto: i === 2 ? 'absent' : 'present' }]),
  confirm_team_day: 2, set_employment: {}, set_compensation: {}, set_partner_checklist: {}, payroll_prepare: 2, payroll_set_status: {}, payroll_adjust: 'a1', payroll_decide: {}, payroll_override: {},
  employment_info: { person_id: 'p2', full_name: 'SYNTH Ravi', designation: 'Executive', resource_type: 'own_employee', joined_on: '2026-01-01', pf_applicable: true, pf_opted: true, uan_last4: '1234', note: null, profile_complete: true },
  salary_history: [{ effective_from: '2026-10-01', monthly_gross: 22000, kind: 'increment', reason: 'Annual review 10%', set_by: 'SYNTH HR', created_at: iso('09:00'), change_pct: 10 },
    { effective_from: '2026-01-01', monthly_gross: 20000, kind: 'joining', reason: 'Offer letter', set_by: 'SYNTH HR', created_at: iso('09:00'), change_pct: null }],
  payroll_people: [{ person_id: 'p2', full_name: 'SYNTH Ravi', designation: 'Executive', pay_group: 'crux', resource_type: 'own_employee', on_crux_payroll: null }],
  payroll_sheet: [{ person_id: 'p2', full_name: 'SYNTH Ravi', designation: 'Executive', manager: 'SYNTH Ops Head', location: null, status: 'review', payroll: 'crux', branch_type: 'own', pf_employer: 1277, pf_admin: 0, esi_employee: 0, esi_employer: 0, gross: 22000, days_in_month: 31, day_rate: 709.68,
    present_days: 25, paid_leave_days: 1, off_days: 4, unpaid_days: 1, not_employed_days: 0, unpaid_override: null, override_reason: null, attendance_deduction: 709.68, earned_gross: 21290.32,
    basic: 10645.16, pf_applicable: true, pf_employee: 1277, incentives: 2500, arrears: 0, other_deductions: 0, net_pay: 22513.32, flags: [], pending_adjustments: 1, bank: 'SYNTH Bank', ifsc: 'SYNB0000001', account_last4: '4321' }],
  payroll_adjustments_list: [{ id: 'a1', person_id: 'p2', full_name: 'SYNTH Ravi', kind: 'incentive', amount: 2500, reason: 'Top closures', purpose: null, period_from: null, period_to: null, status: 'proposed',
    proposed_by: 'SYNTH ZM', proposed_at: iso('11:00'), decided_by: null, decision_note: null }],
  partner_checklist: [{ person_id: 'p7', full_name: 'SYNTH BA Nashik', status: 'active', branch_id: 'b2', branch: 'SYNTH Nashik', agreement_signed: true, signed_on: '2026-04-01', agreement_received: false, received_on: null,
    cheque_received: true, cheque_amount: 50000, cheque_number: '123456', cheque_bank: 'SYNTH Bank', cheque_date: '2026-04-01', note: null, docs: { security_cheque: 1 }, complete: false }],
  team_breakdown: { month: '2026-11-01', as_of: today, hours_per_day: 8,
    scope: { received: 120, logged: 100, logged_known: false, closed: 80, cancelled: 5, billable: 115, pending: 40, buckets: { '0-1': 20, '1-2': 8, '2-4': 6, '4-7': 3, '7-15': 2, '15+': 1 }, avg_age: 2.4, median_bucket: '0-1',
      money: { bills: 3, billed: 15000, received: 10000, reconciled: 8500, received_by_age: { '<30': 9000, '30-90': 1000, '90-180': 0, '>180': 0 } } },
    receivables: { start: 66000, pairs: 2, pairs_with_receivables: 1, billed: 15000, received: 10000, outstanding: 71000 },
    people: [{ person_id: 'p1', self: true, headcount: 3, ops: { received: 120, closed: 80, cancelled: 5, pending: 40, avg_age: 2.4 }, money: { billed: 15000, received: 10000, reconciled: 8500 } },
      { person_id: 'p2', self: false, headcount: 1, ops: { received: 60, closed: 40, cancelled: 2, pending: 20, avg_age: 3.1 }, money: { billed: 0, received: 9000, reconciled: 8000 } }],
    hr: { headcount: 3, own: 2, partner: 1, by_designation: [{ designation: 'Executive', n: 2 }, { designation: 'Operations Head', n: 1 }], by_location: [{ location: 'SYNTH Delhi', type: 'own', n: 2 }, { location: 'SYNTH Pune', type: 'partner', n: 1 }],
      locations_own: 1, locations_partner: 1, man_days: 7, man_hours: 56, revenue: 30600, revenue_per_head: 10200, revenue_per_man_hour: 546 } },
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
  hr_compensation: [], person_documents: [{ id: 'd1', doc_type: 'aadhaar', file_name: 'synth.pdf', storage_path: 'p2/aadhaar/x-synth.pdf', uploaded_at: iso('09:00'), verified_at: null, rejected: false, note: null }],
  product_heads: [], ea_assignments: [], agreement_acceptances: [{ person_id: 'p2', version: 'v1', accepted_at: iso('09:00'), typed_name: 'SYNTH Ravi', ip: '1.2.3.4', user_agent: 'test' }],
};
const calls = [];

const srv = spawn('npx', ['vite', 'preview', '--port', '4319', '--strictPort'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch();
const errors = [];
const fails = []; const a11y = [];
try {
  for (const vp of [{ name: 'mobile', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]) {
    const ctx = await browser.newContext({ viewport: vp });
    await ctx.addInitScript(() => { localStorage.setItem('crux-e2e-notif', '1'); localStorage.setItem('sb-gizzonxfwsqfwgjyqzxc-auth-token', JSON.stringify({ access_token: 'x', refresh_token: 'y', token_type: 'bearer',
      expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: 'u1', aud: 'authenticated', role: 'authenticated' } })); });
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
      if (process.env.A11Y) {   // accessibility scan (axe-core): serious and critical issues only
        await page.addScriptTag({ path: createRequire(import.meta.url).resolve('axe-core/axe.min.js') });
        const v = await page.evaluate(async () => (await (window).axe.run(document, { resultTypes: ['violations'] })).violations
          .filter((x) => x.impact === 'serious' || x.impact === 'critical').map((x) => `${x.id} (${x.nodes.length}) ` + (x.nodes.slice(0, 2).map((n) => n.target.join(' ') + ' :: ' + n.html.slice(0, 90)).join(' | '))));
        if (v.length) a11y.push(`${vp.name} ${name}: ${v.join(', ')}`);
      }
    };
    await go('/', 'home', [/Send today's update|Finish and send|View my update/, 'Attendance today', 'Needs attention', 'Performance —', 'Projected month end', 'Stakeholders (Zonal Manager groups)',
      'Revenue — what makes it up', 'Pending now', 'average 2.4 days', 'Collections — what makes it up', 'By person (each with their team)', 'People behind the numbers']);
    // collapse/expand on a big card (D-112): a collapsed card hides its body until opened
    if (await page.getByText('Revenue per man-hour').first().isVisible().catch(() => false)) fails.push(`${vp.name} deep card not collapsed by default`);
    await page.getByRole('button', { name: /People behind the numbers/ }).first().click(); await page.waitForTimeout(300);
    if (!(await page.getByText('Revenue per man-hour').first().isVisible().catch(() => false))) fails.push(`${vp.name} card did not expand`);
    await go('/chat', 'chat', ['Chat', 'New chat', 'Need help', 'SYNTH Ravi']);
    await go('/about', 'about', ['About', 'SYNTH Company', 'Your data', 'understand adoption', 'cannot see other apps', 'Permissions the app asks for', 'Notifications']);
    await go('/plan', 'plan', ['Check in & plan', "I'm at work", "How I'm doing", 'Open My day']);
    await go('/reviews', 'reviews', ['Reviews & scores', 'My review', 'Submit self-review', 'Everyone — monthly scores']);
    await go('/chat?t=t1', 'chat-thread', ['Is the 13 right?', 'Online']);
    await go('/chat?t=help', 'chat-help', ['CRUX Help', 'How do I apply for leave?', 'Desks you look after']);
    await page.getByRole('button', { name: 'How do I apply for leave?' }).first().click(); await page.waitForTimeout(300);
    if (!(await page.getByText(/Request leave, choose dates/).first().isVisible().catch(() => false))) fails.push(`${vp.name} help answer missing`);
    await page.locator('#help-input').fill('my salary bill reimbursement is pending with accounts'); await page.locator('#help-input').press('Enter'); await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'HR', exact: true }).last().click(); await page.waitForTimeout(300);
    if (!(await page.getByText(/Goes to: SYNTH HR \(on leave\)/).first().isVisible().catch(() => false))) fails.push(`${vp.name} help routing missing`);
    await page.screenshot({ path: `${OUT}${vp.name}-chat-help-ask.png` });
    await page.locator('main .helptip-btn:visible').first().click(); await page.waitForTimeout(200);
    if (!(await page.locator('.helptip-pop').first().isVisible().catch(() => false))) fails.push(`${vp.name} ? note missing`);
    await go('/productivity', 'myday', ['Clients · 2', 'Validated 0 of 2', 'Team today (with you)', 'Pending by age (today)', 'Outstanding', 'Not yet updated', "In SYNTH BM Nashik's team, not yet updated", 'SYNTH Meera', 'Send reminder', 'Mark absent', 'My entries for', 'Nothing new', 'Ask', 'My clients', 'Pending by age', '✓ matches net pendency', 'Rollover', 'Net pendency', '2 not yet entered', 'Receivables at the start of the month', 'Bills raised today (number)', 'Outstanding now', 'Tally', 'Received today', 'Reconciled today', 'Collection target', 'Changed by the Collections Head', 'location head — required', 'Month to date incl. today', 'Opening balance today', 'My targets this month', 'Your target ₹90,000', 'Certify my team', 'Daily message']);
    await page.getByText('My clients').first().click(); await page.waitForTimeout(400);
    await page.getByLabel('SYNTH IDBI at Delhi').click(); await page.waitForTimeout(700);
    if (!(await page.getByText(/SYNTH IDBI · Delhi: active/).isVisible())) fails.push(`${vp.name} client tick did not confirm`);
    await page.getByRole('button', { name: /Team roll-up here/ }).first().click(); await page.waitForTimeout(300);
    if (!(await page.getByText('SYNTH Ravi').first().isVisible())) fails.push(`${vp.name} team expand missing person`);
    await page.getByRole('button', { name: 'Edit' }).first().click(); await page.waitForTimeout(200);
    if (!(await page.getByText(/Correct SYNTH Ravi's SYNTH BOM Retail entry/).isVisible())) fails.push(`${vp.name} team edit missing`);
    await go('/', 'home-products', ['My products']);
    await page.getByRole('tab', { name: /My products/ }).click(); await page.waitForTimeout(600);
    for (const c of ['Revenue MTD', 'By location', 'By person (any team)', 'SYNTH Asha']) if (!(await page.getByText(c).first().isVisible().catch(() => false))) fails.push(`${vp.name} product view missing ${c}`);
    await page.getByRole('button', { name: 'Correct figures' }).click(); await page.waitForTimeout(500);
    if (!(await page.getByRole('dialog').getByText('SYNTH IDBI · Delhi').isVisible().catch(() => false))) fails.push(`${vp.name} product correct popup missing line`);
    await page.screenshot({ path: `${OUT}${vp.name}-product-fix.png` });
    await page.getByRole('button', { name: 'Close', exact: true }).click(); await page.waitForTimeout(200);
    await page.getByRole('tab', { name: 'My team', exact: true }).first().click(); await page.waitForTimeout(800);
    await page.getByRole('tab', { name: 'Partner branches' }).click(); await page.waitForTimeout(600);
    if (!(await page.getByText('· partner branches').first().isVisible().catch(() => false))) fails.push(`${vp.name} own/partner switch missing`);
    await go('/payroll', 'payroll', ['Payroll', 'With managers for review', 'In hand to deposit', 'SYNTH Ravi', 'Approve and lock', 'Download CRUX payroll for Accounts']);
    await page.getByRole('button', { name: 'Details' }).first().click(); await page.waitForTimeout(400);
    for (const c of ['Earned gross', 'PF — employee 12%', 'PF — employer 12% (part of salary)', 'In hand (to be deposited)', 'Correct unpaid days']) if (!(await page.getByRole('dialog').getByText(c).first().isVisible().catch(() => false))) fails.push(`${vp.name} payroll statement missing ${c}`);
    await page.getByRole('button', { name: 'Close', exact: true }).click(); await page.waitForTimeout(200);
    await page.getByRole('tab', { name: /Incentives, deductions/ }).click(); await page.waitForTimeout(400);
    for (const c of ['Top closures', 'Approve', 'Reject']) if (!(await page.getByText(c).first().isVisible().catch(() => false))) fails.push(`${vp.name} payroll proposals missing ${c}`);
    await page.getByRole('tab', { name: /How it is worked out/ }).click(); await page.waitForTimeout(300);
    if (!(await page.getByText(/at most ₹3,000 each/).first().isVisible().catch(() => false))) fails.push(`${vp.name} payroll rules missing`);
    await go('/attendance', 'attendance-calendar', ['Team attendance — month', 'SYNTH Asha', 'Confirm day']);
    await page.locator('button.calcell').nth(2).click(); await page.waitForTimeout(300);
    if (!(await page.getByText(/Auto from the daily report/).isVisible().catch(() => false))) fails.push(`${vp.name} calendar edit missing`);
    await go('/team?v=hr', 'team-hr', ['HR details (PF, joining)', 'SYNTH Ravi']);
    await page.locator('main').getByRole('button', { name: /SYNTH Ravi/ }).first().click(); await page.waitForTimeout(500);
    for (const c of ['PF applicable', 'PF accepted (opted in)', 'UAN (last 4 digits)']) if (!(await page.getByText(c).first().isVisible().catch(() => false))) fails.push(`${vp.name} team HR missing ${c}`);
    await go('/targets', 'targets', ['Me and my team', 'Passed to their team', '1 · Monthly totals', 'SYNTH Ravi']);
    await go('/tasks', 'tasks', ['Tasks & misses', 'Admin queue', 'No per-case rate for SYNTH SBI', 'Enter rate', 'Team task', 'weekly updates']);
    await page.getByRole('button', { name: 'Enter rate' }).first().click(); await page.waitForTimeout(400);
    for (const c of ['Rate ₹ per case', 'Resolve now', 'Ask for details', 'Deny']) if (!(await page.getByRole('dialog').getByText(c).first().isVisible().catch(() => false))) fails.push(`${vp.name} task popup missing ${c}`);
    await page.screenshot({ path: `${OUT}${vp.name}-task-popup.png` });
    await page.getByRole('button', { name: 'Close', exact: true }).click(); await page.waitForTimeout(200);
    await page.getByRole('tab', { name: /Mine/ }).click(); await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Resolve' }).first().click(); await page.waitForTimeout(400);
    if (!(await page.getByRole('dialog').getByText(/Reopen 2026-11-02 for them/).isVisible().catch(() => false))) fails.push(`${vp.name} miss popup: reopen missing`);
    await page.getByRole('button', { name: 'Close', exact: true }).click(); await page.waitForTimeout(200);
    await page.getByRole('tab', { name: /My team/ }).click(); await page.waitForTimeout(300);
    if (!(await page.getByText('Client paused files').first().isVisible())) fails.push(`${vp.name} tasks: team reply missing`);
    await page.getByRole('tab', { name: /Assigned by me/ }).click(); await page.waitForTimeout(300);
    if (!(await page.getByText(/About pending files · Assigned by SYNTH Ops Head · Due 2026-11-10/).first().isVisible().catch(() => false))) fails.push(`${vp.name} tasks: assigned detail missing`);
    await page.getByRole('button', { name: '+ Assign a task' }).click(); await page.waitForTimeout(500);
    for (const c of ['What needs to be done', 'My team', 'Peer', 'SYNTH ZM']) if (!(await page.getByRole('dialog').getByText(c).first().isVisible().catch(() => false))) fails.push(`${vp.name} assign form missing ${c}`);
    await page.screenshot({ path: `${OUT}${vp.name}-assign.png` });
    await page.getByRole('button', { name: 'Close', exact: true }).click(); await page.waitForTimeout(200);
    await go('/profile', 'profile', ['87%', 'Qualification certificate', 'My salary', 'Declare my salary', 'Done — view or change', 'Completed details']);
    if (await page.locator('main').getByText('Upload Aadhaar card').count()) fails.push(`${vp.name} profile shows a completed scan as pending`);
    await page.getByRole('button', { name: 'Declare my salary' }).click(); await page.waitForTimeout(300);
    await page.getByLabel('Annual CTC (₹)').fill('480000');
    await page.getByLabel(/Performance linked bonus/).check(); await page.waitForTimeout(900);
    for (const c of ['Basic', 'HRA', 'Special allowance', 'Performance linked bonus (20% of CTC)', 'CTC (cost to company)', 'PF — your share (12%)', 'Professional tax (MH)', 'In hand (paid to your account)', '₹4,80,000', 'Send to HR for approval'])
      if (!(await page.locator('main').getByText(c, { exact: false }).first().isVisible().catch(() => false))) fails.push(`${vp.name} salary form missing ${c}`);
    await page.screenshot({ path: `${OUT}${vp.name}-salary.png`, fullPage: true });
    await go('/payroll', 'payroll-decl', ['Payroll']);
    await page.getByRole('tab', { name: 'Salary declarations' }).click(); await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Review' }).first().click(); await page.waitForTimeout(300);
    for (const c of ['SYNTH Ravi', 'PLB 20%', 'Approve', 'Reject', '₹96,000']) if (!(await page.getByText(c, { exact: false }).first().isVisible().catch(() => false))) fails.push(`${vp.name} declarations missing ${c}`);
    await page.screenshot({ path: `${OUT}${vp.name}-declarations.png`, fullPage: true });
    await go('/productivity', 'myday-drill', ['SYNTH IDBI']);
    await page.getByRole('button', { name: 'Details' }).first().click(); await page.waitForTimeout(400);
    for (const c of ['Roll-up today', "SYNTH BM Nashik's team (2)", 'Validate becomes available']) if (!(await page.getByText(c).first().isVisible().catch(() => false))) fails.push(`${vp.name} drill-down missing ${c}`);
    await page.getByRole('button', { name: /SYNTH BM Nashik's team/ }).first().click(); await page.waitForTimeout(300);
    if (!(await page.getByText('SYNTH Meera').nth(1).isVisible().catch(() => false))) fails.push(`${vp.name} drill-down person level missing`);
    await page.screenshot({ path: `${OUT}${vp.name}-myday-drill.png`, fullPage: true });
    await go('/attendance', 'attendance', ['Attendance & leave', 'No check-in needed']);
    await page.getByRole('tab', { name: /Today · leave requests/ }).click(); await page.waitForTimeout(500);
    for (const c of ['No show (not informed)', 'Confirm 2 as shown']) if (!(await page.getByText(c).first().isVisible().catch(() => false))) fails.push(`${vp.name} attendance today missing ${c}`);
    await page.getByRole('button', { name: 'Change' }).nth(1).click(); await page.waitForTimeout(300);
    if (!(await page.getByRole('option', { name: 'Unplanned leave' }).count())) fails.push(`${vp.name} attendance sub-categories missing`);
    await go('/team?v=police', 'team-police', ['Police verification —', 'SYNTH Ravi', 'Not started', '2026-12-09']);
    await page.getByRole('button', { name: 'Update' }).first().click(); await page.waitForTimeout(500);
    for (const c of ['Application / certificate number', 'Certificate · SYNTH Ravi']) if (!(await page.getByText(c).first().isVisible().catch(() => false))) fails.push(`${vp.name} police editor missing ${c}`);
    await go('/team', 'team', ["Today's review", 'Certify my team']);
    await page.getByText('SYNTH Ravi').first().click(); await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Remove' }).first().click(); await page.waitForTimeout(200);
    if (!(await page.getByText(/Remove this entry for SYNTH Ravi/).isVisible())) fails.push(`${vp.name} remove-with-note missing`);
    await page.getByRole('tab', { name: /People/ }).click(); await page.waitForTimeout(500);
    await page.getByLabel('Full name').fill('SYNTH New Member'); await page.getByLabel(/Mobile number/).fill('9800000009'); await page.getByLabel(/Designation/).fill('Field Executive');
    const loc = page.locator('label', { hasText: /^Delhi$/ }).first(); await loc.locator('input').check();
    await page.locator('label', { hasText: /^SYNTH BOM Retail$/ }).first().locator('input').check();
    if (!(await page.getByText('1 client-location assignment(s) will be created').isVisible())) fails.push(`${vp.name} two-list pairing text missing`);
    await page.getByRole('button', { name: /Add member/ }).click(); await page.waitForTimeout(800);
    const msg = await page.locator('textarea').first().inputValue().catch(() => '');
    for (const c of ['welcome to CRUX', 'ABCDE-12345', '9800000009', 'First time / reset password', 'My clients', 'Submit']) if (!msg.includes(c)) fails.push(`${vp.name} onboarding message missing "${c}"`);
    if (msg.includes('Check in')) fails.push(`${vp.name} onboarding still mentions check-in`);
    await page.screenshot({ path: `${OUT}${vp.name}-team-added.png`, fullPage: true });
    await page.getByRole('button', { name: 'Profile', exact: true }).first().click(); await page.waitForTimeout(600);
    for (const c of ['profile 87% complete', 'Emergency contact', 'SYNTH Kin', '9000000000', '2345 6789 0124', 'typed by the person after the scan', 'It matches', 'Correct it']) if (!(await page.getByText(c).first().isVisible().catch(() => false))) fails.push(`${vp.name} team profile missing ${c}`);
    await page.screenshot({ path: `${OUT}${vp.name}-team-profile.png`, fullPage: true });
    await go('/reports', 'zonal-tracker', ['Zonal Tracker', 'Whole business', 'Total SYNTH West Zone', 'Total SYNTH Delhi', 'Pan India', 'ROI', 'Client Wise Business', 'Operation Stakeholders', 'Zone A']);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.getByRole('button', { name: 'Download Excel' }).click()]);
    if (!dl) fails.push(`${vp.name} tracker download did not start`); else if (vp.name === 'desktop') await dl.saveAs(`${OUT}tracker-download.xlsx`);
    await go('/', 'home-collections', ['Collections —', 'Receivables (start of month)', 'Client-wise collections', 'Revised by SYNTH Coll Head', 'Billed / case', 'Dispute / change']);
    await page.getByRole('button', { name: 'Dispute / change' }).first().click(); await page.waitForTimeout(300);
    if (!(await page.getByRole('dialog').getByText('Why are you changing it?').isVisible().catch(() => false))) fails.push(`${vp.name} AR dispute popup missing`);
    await page.getByRole('button', { name: 'Close', exact: true }).click(); await page.waitForTimeout(200);
    await go('/notifications', 'notifications', ['Notifications', 'Phone notifications', 'App installed', 'Messages', 'Send an app alert']);
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
    for (const c of ['Roles', 'Reports to', 'Locations they head', 'Assistant to · Product Head for']) if (!(await page.getByRole('heading', { name: c, exact: true }).isVisible())) fails.push(`${vp.name} person editor missing ${c}`);
    await page.screenshot({ path: `${OUT}${vp.name}-admin-person.png`, fullPage: true });
    await page.getByRole('button', { name: /Back to people/ }).click(); await page.waitForTimeout(300);
    await admin('HR repository', ['People & documents', 'SYNTH Ravi', 'Missing: PAN', '1 to verify', 'CRUX employees', 'Partners / BA']);
    await page.getByRole('tab', { name: 'Business Associates checklist' }).click(); await page.waitForTimeout(500);
    for (const c of ['SYNTH BA Nashik', 'Security cheque', '123456']) if (!(await page.getByText(c).first().isVisible().catch(() => false))) fails.push(`${vp.name} BA checklist missing ${c}`);
    await page.screenshot({ path: `${OUT}${vp.name}-ba-checklist.png`, fullPage: true });
    await page.getByRole('tab', { name: 'People & documents' }).click(); await page.waitForTimeout(300);
    await page.getByRole('tab', { name: 'Agreements & profiles' }).click(); await page.waitForTimeout(500);
    for (const c of ['Signed v1', '1.2.3.4']) if (!(await page.getByText(c).first().isVisible().catch(() => false))) fails.push(`${vp.name} agreements tab missing ${c}`);
    await admin('Clients & rates', ['Add a client', 'Product Head (optional)']);
    await admin('Locations & heads', ['Stakeholder groups', 'SYNTH Delhi']);
    await admin('Monthly targets', ['Fill from last month', 'Revenue target']);
    await admin('Settings', ['Shift starts at', 'Revenue Status email goes to']);
    await admin('Bulk upload', ['Download template']);
    await admin('Reopen days', ['Locations (everyone working there)', 'Daily figures (several people, locations, dates)']);
    await admin('Leave, holidays & policies', ['Leave types and monthly credits', 'No leave types.', 'Holidays — national and regional', 'Penalty rules']);
    await admin('Month close & backup', ['Open misses in the month', 'Download backup', 'tools/restore_backup.sql']);
    await admin('Data quality', ['have all details correct', 'to correct', 'Add a bank']);
    await admin('App usage report', ['Who is signed up and using CRUX', 'By team', 'Profile complete', 'People using CRUX', 'When the team is active', 'Download CSV']);
    // Admin "see the app as another designation" (D-111)
    await page.goto('http://localhost:4319/#/'); await page.waitForTimeout(700);
    if (!(await page.getByText('See the app as another designation').first().isVisible().catch(() => false))) fails.push(`${vp.name} preview bar missing`);
    await page.getByLabel('Preview the app as a designation').selectOption('executive'); await page.waitForTimeout(600);
    if (!(await page.getByText(/Previewing as Operations Executive/).first().isVisible().catch(() => false))) fails.push(`${vp.name} preview did not switch`);
    await page.screenshot({ path: `${OUT}${vp.name}-preview-exec.png`, fullPage: true });
    await page.getByRole('button', { name: 'Exit preview' }).first().click(); await page.waitForTimeout(400);
    await ctx.close();
  }
  // Gate: a user who has not signed / completed the profile sees only the agreement, then the profile.
  globalThis.__gate = true;
  const g = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await g.addInitScript(() => { localStorage.setItem('crux-e2e-notif', '1'); localStorage.setItem('sb-gizzonxfwsqfwgjyqzxc-auth-token', JSON.stringify({ access_token: 'x', refresh_token: 'y', token_type: 'bearer',
    expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: 'u1', aud: 'authenticated', role: 'authenticated' } })); });
  await g.route(/supabase\.co\//, async (route) => {
    const u = new URL(route.request().url()); const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u.pathname);
    if (m) { if (m[1] === 'whoami') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((globalThis.__gateStep ?? 0) >= 1 ? { ...gateMe, agreement_ok: true } : gateMe) });
      if (m[1] === 'accept_agreement') globalThis.__gateStep = 1;
      const rv = R[m[1]]; const gv = m[1] === 'person_profile' ? { ...personProfile, identity: {}, progress: gateMe.profile } : typeof rv === 'function' ? rv({}) : rv;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(gv ?? []) }); }
    const t = /\/rest\/v1\/(\w+)/.exec(u.pathname); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TABLES[t?.[1]] ?? []) });
  });
  const gp = await g.newPage(); gp.on('pageerror', (e) => errors.push(`gate: ${e.message}`));
  await gp.goto('http://localhost:4319/#/'); await gp.waitForTimeout(1200);
  if (!(await gp.getByText('SYNTH agreement').isVisible())) fails.push('gate: agreement not shown first');
  if (await gp.getByText('My day').count()) fails.push('gate: app reachable before signing');
  for (const cb of await gp.locator('input[type=checkbox]').all()) await cb.check();
  await gp.getByLabel(/Type your full name/).fill('SYNTH Ops Head');
  await gp.getByRole('button', { name: 'I agree and sign' }).click(); await gp.waitForTimeout(1200);
  if (!(await gp.getByText('Complete your profile', { exact: true }).isVisible())) fails.push('gate: profile step not shown after signing');
  for (const c of ['87%', 'Aadhaar card', 'Skip for now']) if (!(await gp.getByText(c).first().isVisible().catch(() => false))) fails.push(`gate: missing ${c}`);
  await gp.screenshot({ path: `${OUT}gate-profile.png`, fullPage: true });
  await gp.getByRole('button', { name: /Skip for now/ }).click(); await gp.waitForTimeout(800);
  if (!(await gp.getByText(/Your profile is/).first().isVisible().catch(() => false))) fails.push('gate: skip did not open the app with the reminder banner');
  await g.close();
  // Notifications are compulsory: without permission the app shows the gate and does not go further (D-106).
  {
    globalThis.__gate = false;
    const n = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await n.addInitScript(() => localStorage.setItem('sb-gizzonxfwsqfwgjyqzxc-auth-token', JSON.stringify({ access_token: 'x', refresh_token: 'y', token_type: 'bearer',
      expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: 'u1', aud: 'authenticated', role: 'authenticated' } })));
    await n.route(/supabase\.co\//, async (route) => { const u = new URL(route.request().url()); const m = /\/rest\/v1\/rpc\/(\w+)/.exec(u.pathname);
      if (m) { const v = R[m[1]]; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(m[1] === 'whoami' ? me : (typeof v === 'function' ? v({}) : v ?? [])) }); }
      const t = /\/rest\/v1\/(\w+)/.exec(u.pathname); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(t ? (TABLES[t[1]] ?? []) : {}) }); });
    const np = await n.newPage();
    await np.goto('http://localhost:4319/#/'); await np.waitForTimeout(1200);
    if (!(await np.getByText('Turn on notifications to continue').isVisible().catch(() => false))) fails.push('notif gate: did not block without permission');
    if (await np.getByText("Send today's update").isVisible().catch(() => false)) fails.push('notif gate: app showed through the gate');
    await np.screenshot({ path: `${OUT}notif-gate.png` });
    await n.close();
  }

} finally { await browser.close(); srv.kill(); }
console.log(JSON.stringify({ errors, fails, a11y, rpcCalls: [...new Set(calls)].sort() }, null, 1));
process.exit(errors.length || fails.length ? 1 : 0);
