// Builds the TRAINING database: the full app schema plus a made-up company, run entirely inside the browser
// (PGlite). Nothing here is, or can reach, real CRUX data: every person, branch, client and figure is invented,
// and the training page talks to this in-browser copy only (D-152).
//
//   node tools/build-training.mjs            -> web/public/training/db.tar.gz + web/public/training/meta.json
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIG = join(ROOT, 'supabase', 'migrations');
const OUT = join(ROOT, 'web', 'public', 'training');

export const SUPABASE_STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid, status text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
`;

// ------------------------------------------------------------------ dates: the training "today" is the build day (IST)
const ist = new Date(Date.now() + 5.5 * 3600e3);
const TODAY = ist.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const month0 = (d) => d.slice(0, 8) + '01';
const prevMonth = (d) => { const x = new Date(month0(d) + 'T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() - 1); return x.toISOString().slice(0, 10); };
const START = prevMonth(TODAY);                      // data from the 1st of last month
const at = (d, hhmm = '18:00') => `${d}T${hhmm}:00+05:30`;
const dow = (d) => new Date(d + 'T00:00:00Z').getUTCDay();

// a small seeded random, so every build gives the same story
let seed = 20261114;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const id = (n) => `d0000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const au = (n) => `a0000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

const db = await PGlite.create({ extensions: { btree_gist, pgcrypto } });
await db.exec(SUPABASE_STUB);
for (const f of readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()) {
  try { await db.exec(readFileSync(join(MIG, f), 'utf8')); } catch (e) { throw new Error(`Migration ${f} failed: ${e.message}`); }
}

const clock = (iso) => db.query(`select set_config('app.fake_now', $1, false)`, [iso]);
const problems = [];
async function as(uid, sql, params = [], label = '') {
  await db.exec(`set role authenticated`);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: uid })]);
  try { return (await db.query(sql, params)).rows; }
  catch (e) { problems.push(`${label || sql.slice(0, 60)}: ${e.message}`); return null; }
  finally { await db.exec('reset role'); }
}

// ------------------------------------------------------------------ the made-up company
const Z = { west: id(101), south: id(102) };
const B = { pune: id(111), nashik: id(112), blr: id(113), chennai: id(114) };
const C = { bank: id(121), hfc: id(122), auto: id(123) };
const L = { pune: id(131), nashik: id(132), blr: id(133), chennai: id(134) };
const PR = { rv: id(141), ov: id(142) };
const CL = {
  puneBank: id(151), puneHfc: id(152), nashikBank: id(153), blrBank: id(154), blrAuto: id(155), chennaiHfc: id(156), chennaiAuto: id(157),
};
await db.exec(`
  update settings set value = 'true' where key = 'allow_fake_clock';
  update settings set value = '"${START}"' where key = 'go_live_date';
  update settings set value = '"2099-01-01T00:00:00Z"' where key = 'profile_gate_from';
  insert into settings(key, value, description) values
    ('company_name', '"Demo Risk Services Pvt Ltd (Training)"', 'training'), ('company_place', '"Training"', 'training'),
    ('company_address', '"1 Example Road, Training City 400 000"', 'training'), ('letter_signatory_name', '"Training Director (Demo)"', 'training'),
    ('letter_signatory_title', '"Director"', 'training'), ('legal_jurisdiction', '"Training City"', 'training')
  on conflict (key) do update set value = excluded.value;
  insert into zones(id,code,name) values ('${Z.west}','DW','West (Demo)'),('${Z.south}','DS','South (Demo)');
  insert into branches(id,code,name,branch_type,state) values
    ('${B.pune}','DPU','Pune (Demo)','own','MH'),('${B.nashik}','DNA','Nashik Partner (Demo)','partner','MH'),
    ('${B.blr}','DBL','Bengaluru (Demo)','own','KA'),('${B.chennai}','DCH','Chennai (Demo)','own','TN');
  insert into branch_zones(branch_id,zone_id,valid) values
    ('${B.pune}','${Z.west}','[2025-01-01,)'),('${B.nashik}','${Z.west}','[2025-01-01,)'),
    ('${B.blr}','${Z.south}','[2025-01-01,)'),('${B.chennai}','${Z.south}','[2025-01-01,)');
  insert into clients(id,code,name) values ('${C.bank}','DBK','Demo Bank'),('${C.hfc}','DHF','Sample Housing Finance'),('${C.auto}','DAL','Example Auto Loans');
  insert into locations(id,code,name,state) values ('${L.pune}','DPUN','Pune (Demo)','MH'),('${L.nashik}','DNSK','Nashik (Demo)','MH'),
    ('${L.blr}','DBLR','Bengaluru (Demo)','KA'),('${L.chennai}','DCHE','Chennai (Demo)','TN');
  insert into processes(id,code,name) values ('${PR.rv}','DRV','Residence verification'),('${PR.ov}','DOV','Office verification');
  insert into client_locations(id,client_id,location_id,process_id,branch_id,valid) values
    ('${CL.puneBank}','${C.bank}','${L.pune}','${PR.rv}','${B.pune}','[2025-01-01,)'),
    ('${CL.puneHfc}','${C.hfc}','${L.pune}','${PR.ov}','${B.pune}','[2025-01-01,)'),
    ('${CL.nashikBank}','${C.bank}','${L.nashik}','${PR.rv}','${B.nashik}','[2025-01-01,)'),
    ('${CL.blrBank}','${C.bank}','${L.blr}','${PR.rv}','${B.blr}','[2025-01-01,)'),
    ('${CL.blrAuto}','${C.auto}','${L.blr}','${PR.ov}','${B.blr}','[2025-01-01,)'),
    ('${CL.chennaiHfc}','${C.hfc}','${L.chennai}','${PR.ov}','${B.chennai}','[2025-01-01,)'),
    ('${CL.chennaiAuto}','${C.auto}','${L.chennai}','${PR.rv}','${B.chennai}','[2025-01-01,)');
  insert into rate_cards(client_id,location_id,process_id,billable_event,rate,valid,reason)
  select cl.client_id, cl.location_id, cl.process_id, 'closure', case cl.client_id when '${C.bank}' then 650 when '${C.hfc}' then 480 else 400 end,
         '[2025-01-01,)', 'training data' from client_locations cl;
  insert into partner_share_rules(branch_id,crux_share_pct,partner_share_pct,valid,reason) values ('${B.nashik}',80,20,'[2025-01-01,)','training data');
`);

// people, top to bottom
const people = [
  // key, n, name, role, designation, department, manager, function, resource
  ['admin', 1, 'Training Admin (Demo)', 'admin', 'Admin Manager', 'Administration & IT', null],
  ['director', 2, 'Meera Kapoor (Demo)', 'leadership', 'Director', 'Operations', null],
  ['nh', 3, 'Vikram Rao (Demo)', 'ops_head', 'National Head', 'Operations', null],
  ['ea', 4, 'Anjali Bose (Demo)', 'ea', 'Executive Assistant', 'Operations', 'nh'],
  ['hr', 5, 'Priya Shah (Demo)', 'hr_admin', 'HR Manager', 'Human Resources', 'director'],
  ['auditor', 6, 'Arjun Menon (Demo)', 'auditor', 'Internal Auditor', 'Quality & Audit', 'director'],
  ['ch', 7, 'Neha Pillai (Demo)', 'collections_head', 'Collections Manager', 'Collections', 'nh'],
  ['zmw', 8, 'Sameer Desai (Demo)', 'zm', 'Zonal Manager', 'Operations', 'nh'],
  ['zms', 9, 'Kavya Nair (Demo)', 'zm', 'Zonal Manager', 'Operations', 'nh'],
  ['bmpune', 10, 'Rahul Joshi (Demo)', 'bm', 'Branch Manager', 'Operations', 'zmw'],
  ['abmpune', 11, 'Sneha Kulkarni (Demo)', 'bm', 'Assistant Branch Manager', 'Operations', 'bmpune'],
  ['ba', 12, 'Mahesh Gaikwad (Demo)', 'ba', 'Business Associate', 'Operations', 'zmw', 'partner'],
  ['bmblr', 13, 'Karthik Varma (Demo)', 'bm', 'Branch Manager', 'Operations', 'zms'],
  ['bmche', 14, 'Divya Raman (Demo)', 'bm', 'Branch Manager', 'Operations', 'zms'],
  ['p1', 21, 'Rohan Patil (Demo)', 'executive', 'Verification Executive', 'Operations', 'bmpune'],
  ['p2', 22, 'Pooja Deshmukh (Demo)', 'executive', 'Field Executive', 'Operations', 'bmpune'],
  ['p3', 23, 'Amit Shinde (Demo)', 'executive', 'Back Office Executive', 'Operations', 'bmpune'],
  ['p4', 24, 'Kiran More (Demo)', 'executive', 'Field Executive', 'Operations', 'abmpune'],
  ['n1', 25, 'Sagar Jadhav (Demo)', 'executive', 'Field Executive', 'Operations', 'ba', 'partner'],
  ['n2', 26, 'Swati Pawar (Demo)', 'executive', 'Verification Executive', 'Operations', 'ba', 'partner'],
  ['b1', 27, 'Nikhil Rao (Demo)', 'executive', 'Field Executive', 'Operations', 'bmblr'],
  ['b2', 28, 'Ananya Iyer (Demo)', 'executive', 'Verification Executive', 'Operations', 'bmblr'],
  ['b3', 29, 'Farhan Khan (Demo)', 'executive', 'Back Office Executive', 'Operations', 'bmblr'],
  ['c1', 30, 'Lakshmi Subramanian (Demo)', 'executive', 'Field Executive', 'Operations', 'bmche'],
  ['c2', 31, 'Vijay Kumar (Demo)', 'executive', 'Verification Executive', 'Operations', 'bmche'],
  ['c3', 32, 'Deepa Krishnan (Demo)', 'executive', 'Field Executive', 'Operations', 'bmche'],
  ['k1', 33, 'Ritika Sharma (Demo)', 'executive', 'Collections Executive', 'Collections', 'ch'],
  ['k2', 34, 'Imran Shaikh (Demo)', 'executive', 'Collections Executive', 'Collections', 'ch'],
];
const P = {}, A = {};
for (const [k, n, name, role, desig, dept, mgr, res] of people) {
  P[k] = id(n); A[k] = au(n);
  await db.query(`insert into auth.users(id,email) values ($1,$2)`, [A[k], `${k}@training.invalid`]);
  await db.query(`insert into persons(id,full_name,personal_email,mobile,resource_type,status,auth_user_id,designation,department)
                  values ($1,$2,$3,$4,$5,'active',$6,$7,$8)`,
    [P[k], name, `${k}@training.invalid`, `90000${String(n).padStart(5, '0')}`, res === 'partner' ? 'partner' : 'own_employee', A[k], desig, dept]);
  await db.query(`insert into role_assignments(person_id,role,zone_id,valid) values ($1,$2,$3,'[2025-01-01,)')`,
    [P[k], role, k === 'zmw' ? Z.west : k === 'zms' ? Z.south : null]);
}
for (const [k, , , , , dept, mgr] of people)
  if (mgr) await db.query(`insert into reporting_lines(person_id,manager_id,function,valid) values ($1,$2,$3,'[2025-01-01,)')`,
    [P[k], P[mgr], dept === 'Collections' ? 'collections' : 'operations']);
// the National Head's assistant and the Pune ABM work alongside their principals
await db.query(`insert into ea_assignments(ea_person, principal, valid, reason) values ($1,$2,'[2025-01-01,)','Executive Assistant'),($3,$4,'[2025-01-01,)','Assistant Branch Manager')`,
  [P.ea, P.nh, P.abmpune, P.bmpune]);
const heads = [[B.pune, 'bmpune'], [B.nashik, 'ba'], [B.blr, 'bmblr'], [B.chennai, 'bmche']];
for (const [b, k] of heads) await db.query(`insert into location_heads(branch_id,person_id,head_role,valid) values ($1,$2,'branch_head','[2025-01-01,)')`, [b, P[k]]);
await db.query(`insert into location_heads(branch_id,person_id,head_role,valid) values ($1,$2,'zonal_manager','[2025-01-01,)'),($3,$2,'zonal_manager','[2025-01-01,)'),($4,$5,'zonal_manager','[2025-01-01,)'),($6,$5,'zonal_manager','[2025-01-01,)')`,
  [B.pune, P.zmw, B.nashik, B.blr, P.zms, B.chennai]);
const alloc = {
  p1: [CL.puneBank, CL.puneHfc], p2: [CL.puneBank], p3: [CL.puneHfc], p4: [CL.puneBank],
  n1: [CL.nashikBank], n2: [CL.nashikBank], b1: [CL.blrBank], b2: [CL.blrBank, CL.blrAuto], b3: [CL.blrAuto],
  c1: [CL.chennaiHfc], c2: [CL.chennaiAuto], c3: [CL.chennaiHfc, CL.chennaiAuto],
};
for (const [k, cls] of Object.entries(alloc))
  for (const cl of cls) await db.query(`insert into allocations(person_id,client_location_id,function,valid) values ($1,$2,'operations','[2025-01-01,)')`, [P[k], cl]);
// the collections executives report collections (bills, receipts, reconciliation) for their branches and clients
for (const [k, bs] of [['k1', [B.pune, B.nashik]], ['k2', [B.blr, B.chennai]]])
  for (const b of bs) for (const r of (await db.query(`select distinct client_id from client_locations where branch_id = $1`, [b])).rows)
    await db.query(`insert into location_heads(branch_id,client_id,person_id,head_role,valid) values ($1,$2,$3,'branch_head','[2025-01-01,)')`, [b, r.client_id, P[k]]);
await db.exec(`
  insert into hr_profiles(person_id, date_of_birth, joining_date, current_address, permanent_address, city, state, pincode, emergency_name,
    emergency_relation, emergency_phone, pan_last4, aadhaar_last4, bank_name, bank_ifsc, bank_account_last4, highest_qualification, firm_name, completed_at)
  select id, '1992-04-01', '2024-06-01', '1 Example Road', '1 Example Road', 'Training City', 'MH', '400000', 'Demo Contact', 'Sibling', '9000000000',
    '0000', '0000', 'Demo Bank', 'DEMO0000001', '0000', 'Graduate', case when resource_type = 'partner' then 'Demo Partner Firm' end, now() from persons;
  insert into agreement_acceptances(person_id, version, typed_name, body_md5) select id, 'v1', full_name, 'training' from persons;
  -- invented identity numbers (right format, belong to nobody); two people are left incomplete so the follow-ups show
  insert into person_documents(person_id, doc_type, storage_path, file_name, mime, size_bytes)
  select id, 'qualification', 'training/' || id || '/degree.pdf', 'degree.pdf', 'application/pdf', 1000 from persons where id not in ('${id(32)}', '${id(34)}');
  insert into hr_identity(person_id, aadhaar_number, aadhaar_name, aadhaar_source, pan_number, pan_name, pan_source, bank_account_number, bank_ifsc, bank_name, bank_holder, bank_source)
  select id, '9' || lpad((row_number() over (order by id))::text, 11, '0'), full_name, 'hr',
         'DEM' || 'P' || 'D' || lpad((row_number() over (order by id))::text, 4, '0') || 'Z', full_name, 'hr',
         '10000000' || lpad((row_number() over (order by id))::text, 4, '0'), 'DEMO0000001', 'Demo Bank', full_name, 'hr'
    from persons where id not in ('${id(32)}', '${id(34)}');`);

// ------------------------------------------------------------------ salaries, targets and scorecards
await clock(at(START, '10:00'));
const gross = { executive: 22000, bm: 45000, zm: 75000, ba: 0, ea: 35000, hr_admin: 60000, auditor: 70000, collections_head: 65000, ops_head: 120000, leadership: 200000, admin: 80000 };
for (const [k, , , role, , , , res] of people)
  if (res !== 'partner' && gross[role]) await as(A.hr, `select set_salary($1,$2,$3,'training data')`, [P[k], gross[role] + int(0, 6) * 1000, START], 'salary');

for (const m of [START, month0(TODAY)]) {
  await clock(at(m, '10:00'));
  await as(A.admin, `select * from set_target($1,'revenue','zone',$2,$3)`, [m, 900000, Z.west], 'target zone');
  await as(A.admin, `select * from set_target($1,'revenue','zone',$2,$3)`, [m, 850000, Z.south], 'target zone');
  for (const [b, amt] of [[B.pune, 520000], [B.nashik, 380000], [B.blr, 450000], [B.chennai, 400000]])
    await as(A.admin, `select * from set_target($1,'revenue','branch',$2,null,$3)`, [m, amt, b], 'target branch');
  for (const k of Object.keys(alloc))
    await as(A.admin, `select * from set_target($1,'revenue','person',$2,null,null,$3)`, [m, 110000 + int(0, 6) * 10000, P[k]], 'target person');
  for (const k of ['k1', 'k2'])
    await as(A.admin, `select * from set_target($1,'collections_received','person',$2,null,null,$3)`, [m, 600000, P[k]], 'target collections');
}
await clock(at(START, '11:00'));
await as(A.admin, `select scorecard_defaults_apply('Operations')`, [], 'defaults ops');
await as(A.admin, `select scorecard_defaults_apply('Collections')`, [], 'defaults coll');

// ------------------------------------------------------------------ every working day from the 1st of last month to yesterday
const managersOf = {};
for (const [k, , , , , , mgr] of people) if (mgr && alloc[k]) (managersOf[mgr] ??= []).push(k);
const pending = {};
const perf = Object.fromEntries(Object.keys(alloc).map((k) => [k, 0.75 + rnd() * 0.5]));   // some people do better than others
for (let d = START; d < TODAY; d = addDays(d, 1)) {
  if (dow(d) === 0) continue;                                       // Sundays off
  await clock(at(d, '18:30'));
  for (const [k, cls] of Object.entries(alloc)) {
    if (rnd() < 0.06) continue;                                     // the odd missed day, so the misses show up
    const rows = cls.map((cl) => {
      const key = k + cl; const open = pending[key];
      const entry = Math.round(int(6, 14) * perf[k]);
      const cancelled = rnd() < 0.2 ? 1 : 0;
      const avail = (open ?? 12) + entry - cancelled;
      const closure = Math.max(0, Math.min(avail, Math.round(entry * (0.75 + rnd() * 0.4))));
      const left = open == null ? int(8, 16) : open + entry - closure - cancelled;
      pending[key] = left;
      // pending cases by age (they must add up to what is left)
      const share = [0.4, 0.25, 0.18, 0.1, 0.05]; const b = share.map((x) => Math.floor(left * x)); const p15 = left - b.reduce((a, x) => a + x, 0);
      return { client_location_id: cl, entry, closure, cancelled, tat_0_1: b[0], tat_1_2: b[1], tat_2_4: b[2], tat_4_7: b[3], tat_7_15: b[4], tat_15p: p15 };
    });
    await as(A[k], `select * from save_productivity($1,$2)`, [d, JSON.stringify(rows)], `figures ${k}`);
    await as(A[k], `select save_pending($1,$2)`, [d, JSON.stringify(rows)], `pending ${k}`);
    await as(A[k], `select * from submit_day($1)`, [d], `submit ${k}`);
  }
  await clock(at(d, '20:30'));
  // deputies first: the Assistant Branch Manager certifies before the Branch Manager
  for (const m of Object.keys(managersOf).sort((a, b) => (b === 'abmpune') - (a === 'abmpune'))) if (rnd() < 0.85) await as(A[m], `select * from certify_team($1)`, [d], `certify ${m}`);
  for (const k of ['k1', 'k2']) {
    const day = await as(A[k], `select my_collection_day($1) j`, [d], `coll day ${k}`);
    const keys = (day?.[0]?.j ?? []).map((x) => ({ branch_id: x.branch_id, client_id: x.client_id }));
    if (!keys.length) continue;
    const rows = keys.map((x) => { const r = int(15, 45) * 1000; return { ...x, bill_count: int(2, 8), bill_amount: int(20, 60) * 1000, bill_ref: `DEMO-${d}`,
      rcv_lt30: r, rcv_30_90: int(0, 10) * 1000, rcv_90_180: 0, rcv_gt180: 0, rec_lt30: Math.round(r * 0.9), rec_30_90: 0, rec_90_180: 0, rec_gt180: 0,
      follow_ups: int(3, 9), promised_amount: 0 }; });
    await as(A[k], `select save_collection_day($1,$2)`, [d, JSON.stringify(rows)], `collections ${k}`);
  }
}

// ------------------------------------------------------------------ KPI results, weekly reviews, last month's scores
const kpi = async (name) => (await db.query(`select id from kpi_catalogue where name = $1`, [name])).rows[0]?.id;
const quality = await kpi('Average Quality Score – Rate %'), tat = await kpi('Cases Closed Beyond TAT (over 2 days) – Rate %');
const recv90 = await kpi('Receivables Over 90 Days – Rate %'), recon = await kpi('Reconciliation Accuracy – Rate %');
const lastOfPrev = addDays(month0(TODAY), -1);
for (const when of [lastOfPrev, addDays(TODAY, -1)]) {
  await clock(at(when, '19:00'));
  for (const [mgr, ks] of Object.entries(managersOf)) for (const k of ks) {
    await as(A[mgr], `select kpi_entry_for($1,$2,$3,null)`, [P[k], quality, 96 + int(0, 30) / 10], 'kpi quality');
    await as(A[mgr], `select kpi_entry_for($1,$2,$3,null)`, [P[k], tat, int(1, 9)], 'kpi tat');
  }
  for (const k of ['k1', 'k2']) {
    await as(A.ch, `select kpi_entry_for($1,$2,$3,null)`, [P[k], recv90, int(3, 8)], 'kpi recv90');
    await as(A.ch, `select kpi_entry_for($1,$2,$3,null)`, [P[k], recon, 95 + int(0, 40) / 10], 'kpi recon');
  }
}
const mondays = []; for (let d = addDays(TODAY, -28); d < TODAY; d = addDays(d, 1)) if (dow(d) === 1) mondays.push(d);
for (const wk of mondays) {
  await clock(at(addDays(wk, 5), '17:00'));
  for (const [mgr, ks] of Object.entries(managersOf)) for (const k of ks)
    await as(A[mgr], `select save_weekly_review($1,$2,$3,$4)`, [P[k], wk, 'Steady week; closures on track. Watch the TAT on Office verification.', 'Clear pending cases older than 2 days'], 'weekly');
}
await clock(at(addDays(month0(TODAY), 2), '11:00'));                // scoring window for last month
const managed = Object.entries(managersOf).flatMap(([m, ks]) => ks.map((k) => [m, k]));
for (const [m, k] of managed) {
  await as(A[k], `select self_score($1,$2,$3,$4)`, [START, int(6, 9), int(6, 9), 'Met most of my targets.'], 'self score');
  if (rnd() < 0.75) {
    await as(A[m], `select save_score($1,$2,$3,$4,$5)`, [P[k], START, int(5, 9), int(6, 9), 'Good month — keep the quality up.'], 'score');
    if (rnd() < 0.7) await as(A.hr, `select lock_score($1,$2)`, [P[k], START], 'lock score');
  }
}

// ------------------------------------------------------------------ today: tasks, chat, attendance, a letter
await clock(at(TODAY, '11:30'));
await as(A.bmpune, `select assign_task($1::uuid[],$2,$3,$4)`, [`{${P.p1},${P.p2}}`, 'Close all cases older than 2 days', 'Demo Bank Pune — list shared in chat.', addDays(TODAY, 2)], 'task');
await as(A.zmw, `select assign_task($1::uuid[],$2,$3,$4)`, [`{${P.bmpune}}`, 'Review quality audit findings with the team', null, addDays(TODAY, 3)], 'task');
await as(A.nh, `select assign_task($1::uuid[],$2,$3,$4,'team',$5)`, [`{${P.zmw},${P.zms}}`, 'Plan next month targets by branch', 'Share the draft before the 25th.', addDays(TODAY, 7), P.zmw], 'team task');
const thread = await as(A.bmpune, `select chat_direct($1) t`, [P.p1], 'chat');
if (thread?.[0]?.t) {
  const t = thread[0].t?.id ?? thread[0].t;
  await as(A.bmpune, `select chat_send($1,$2)`, [t, 'Rohan, please update the pending Demo Bank cases by 4 pm.'], 'chat send');
  await as(A.p1, `select chat_send($1,$2)`, [t, 'Sure, 3 are closed already — the rest by 4.'], 'chat send');
}
for (const k of ['p1', 'p2', 'p3', 'b1', 'b2', 'c1']) await as(A[k], `select self_check_in(null)`, [], 'check in');
await as(A.p4, `select request_leave($1,$2,'planned','personal','Family function')`, [addDays(TODAY, 3), addDays(TODAY, 4)], 'leave');
await as(A.hr, `select letter_issue($1,'appointment','Appointment letter',$2,true)`,
  [P.p4, '# Appointment\n\nThis is a sample appointment letter for training. All details are made up.'], 'letter');

// what the training page needs to show and switch between
await clock(at(TODAY, '17:00'));
await db.exec(`select app.sync_all()`).catch((e) => problems.push('sync: ' + e.message));
const roleLabel = { admin: 'Admin', leadership: 'Director', ops_head: 'National Head', ea: 'Executive Assistant', hr_admin: 'HR', auditor: 'Auditor',
  collections_head: 'Collections Head', zm: 'Zonal Manager', bm: 'Branch Manager', ba: 'Business Associate', executive: 'Executive' };
const meta = {
  built: new Date().toISOString(), today: TODAY, clock: at(TODAY, '17:00'),
  people: people.map(([k, n, name, role, desig]) => ({ key: k, auth: A[k], name, designation: desig, role: roleLabel[role] ?? role })),
};
mkdirSync(OUT, { recursive: true });
const dump = await db.dumpDataDir('gzip');
writeFileSync(join(OUT, 'db.tar.gz'), Buffer.from(await dump.arrayBuffer()));
writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));
const counts = (await db.query(`select (select count(*) from productivity_lines) lines, (select count(*) from certifications) certs,
  (select count(*) from collection_daily) coll, (select count(*) from kpi_assignment) kpis, (select count(*) from weekly_reviews) weekly,
  (select count(*) from monthly_scores) scores, (select count(*) from tasks) tasks`).catch(() => ({ rows: [{}] }))).rows[0];
console.log(JSON.stringify({ today: TODAY, start: START, counts, size: dump.size, problems: [...new Set(problems)].slice(0, 40), problemCount: problems.length }, null, 1));
