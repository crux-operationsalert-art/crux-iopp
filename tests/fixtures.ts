// SYNTHETIC TEST DATA — not CRUX actuals. Every name is prefixed SYNTH.
import type { PGlite } from '@electric-sql/pglite';

const u = (n: number) => `00000000-0000-0000-0000-${n.toString().padStart(12, '0')}`;
export const P = {
  admin: u(1), oh: u(2), ch: u(3), zm1: u(4), bm1: u(5), ba1: u(6), e1: u(7), e2: u(8), e3: u(9),
  zm2: u(10), e4: u(11), hr: u(12), auditor: u(13),
};
// auth uid = person id + 1000 to prove the two are not confused
export const A = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, v.replace(/0000(\d{8})$/, (_, d) => '1000' + d)])) as typeof P;

export const M = {
  z1: u(101), z2: u(102), b1: u(111), b2: u(112), b3: u(113),
  cBOM: u(121), cSBI: u(122), lPune: u(131), lNsk: u(132), lX: u(133), pRV: u(141),
  cl1: u(151), cl2: u(152), cl3: u(153), cl4: u(154),
};

export async function seed(db: PGlite) {
  await db.exec(`
  update settings set value = 'true' where key = 'allow_fake_clock';
  insert into zones(id,code,name) values ('${M.z1}','SZ1','SYNTH West'),('${M.z2}','SZ2','SYNTH East');
  insert into branches(id,code,name,branch_type,state) values
    ('${M.b1}','SB1','SYNTH Pune','own','MH'),('${M.b2}','SB2','SYNTH Nashik Partner','partner','MH'),
    ('${M.b3}','SB3','SYNTH Kolkata','own','WB');
  insert into branch_zones(branch_id,zone_id,valid) values
    ('${M.b1}','${M.z1}','[2026-01-01,)'),('${M.b2}','${M.z1}','[2026-01-01,)'),('${M.b3}','${M.z2}','[2026-01-01,)');
  insert into clients(id,code,name) values ('${M.cBOM}','SBOM','SYNTH-BOM'),('${M.cSBI}','SSBI','SYNTH-SBI');
  insert into locations(id,code,name,state) values ('${M.lPune}','SPUN','SYNTH Pune','MH'),
    ('${M.lNsk}','SNSK','SYNTH Nashik','MH'),('${M.lX}','SKOL','SYNTH Kolkata','WB');
  insert into processes(id,code,name) values ('${M.pRV}','RV','Residence verification');
  insert into client_locations(id,client_id,location_id,process_id,branch_id,valid) values
    ('${M.cl1}','${M.cBOM}','${M.lPune}','${M.pRV}','${M.b1}','[2026-01-01,)'),
    ('${M.cl2}','${M.cSBI}','${M.lPune}','${M.pRV}','${M.b1}','[2026-01-01,)'),
    ('${M.cl3}','${M.cBOM}','${M.lNsk}','${M.pRV}','${M.b2}','[2026-01-01,)'),
    ('${M.cl4}','${M.cSBI}','${M.lX}','${M.pRV}','${M.b3}','[2026-01-01,)');
  insert into rate_cards(client_id,location_id,process_id,billable_event,rate,valid,reason) values
    ('${M.cBOM}','${M.lPune}','${M.pRV}','closure',750,'[2026-10-01,2026-11-01)','synthetic'),
    ('${M.cBOM}','${M.lPune}','${M.pRV}','closure',800,'[2026-11-01,)','synthetic'),
    ('${M.cSBI}','${M.lPune}','${M.pRV}','closure',225,'[2026-10-01,)','synthetic'),
    ('${M.cBOM}','${M.lNsk}','${M.pRV}','entry',500,'[2026-10-01,)','synthetic');
  insert into partner_share_rules(branch_id,crux_share_pct,partner_share_pct,valid,reason)
    values ('${M.b2}',80,20,'[2026-01-01,)','synthetic');
  insert into penalty_rules(code,description,trigger_description,amount,active)
    values ('MISSED_REPORT','SYNTH missed daily report','No submission by grace deadline',null,true);
  `);
  const people: [keyof typeof P, string, string][] = [
    ['admin', 'SYNTH Admin', 'admin'], ['oh', 'SYNTH Ops Head', 'ops_head'], ['ch', 'SYNTH Collections Head', 'collections_head'],
    ['zm1', 'SYNTH ZM West', 'zm'], ['bm1', 'SYNTH BM Pune', 'bm'], ['ba1', 'SYNTH BA Nashik', 'ba'],
    ['e1', 'SYNTH Exec One', 'executive'], ['e2', 'SYNTH Exec Two', 'executive'], ['e3', 'SYNTH Exec Three', 'executive'],
    ['zm2', 'SYNTH ZM East', 'zm'], ['e4', 'SYNTH Exec Four', 'executive'], ['hr', 'SYNTH HR', 'hr_admin'],
    ['auditor', 'SYNTH Auditor', 'auditor'],
  ];
  for (const [k, name, role] of people) {
    await db.query(`insert into auth.users(id,email) values ($1,$2)`, [A[k], `${k}@synth.test`]);
    await db.query(
      `insert into persons(id,full_name,personal_email,resource_type,status,auth_user_id,designation) values ($1,$2,$3,$4,'active',$5,$6)`,
      [P[k], name, `${k}@synth.test`, k === 'ba1' ? 'partner' : 'own_employee', A[k], role.replace('_', ' ')]);
    await db.query(`insert into role_assignments(person_id,role,zone_id,valid) values ($1,$2,$3,'[2026-01-01,)')`,
      [P[k], role, k === 'zm1' ? M.z1 : k === 'zm2' ? M.z2 : null]);
  }
  const lines: [keyof typeof P, keyof typeof P, string][] = [
    ['zm1', 'oh', 'operations'], ['zm2', 'oh', 'operations'], ['bm1', 'zm1', 'operations'], ['ba1', 'zm1', 'operations'],
    ['e1', 'bm1', 'operations'], ['e2', 'bm1', 'operations'], ['e3', 'ba1', 'operations'], ['e4', 'zm2', 'operations'],
    ['e1', 'ch', 'collections'],
  ];
  for (const [p, m, f] of lines)
    await db.query(`insert into reporting_lines(person_id,manager_id,function,valid) values ($1,$2,$3,'[2026-01-01,)')`, [P[p], P[m], f]);
  const allocs: [keyof typeof P, string][] = [['e1', M.cl1], ['e1', M.cl2], ['e2', M.cl1], ['e3', M.cl3], ['bm1', M.cl2], ['e4', M.cl4]];
  for (const [p, cl] of allocs)
    await db.query(`insert into allocations(person_id,client_location_id,function,valid) values ($1,$2,'operations','[2026-01-01,)')`, [P[p], cl]);
  // Synthetic onboarding: everyone signed the agreement and completed a (fake) profile; strict daily rules start far in the future
  // unless a test moves the go-live date.
  await db.exec(`
    update settings set value = '"2099-01-01"' where key = 'go_live_date';
    insert into hr_profiles(person_id, date_of_birth, joining_date, current_address, permanent_address, city, state, pincode, emergency_name,
      emergency_relation, emergency_phone, pan_last4, aadhaar_last4, bank_name, bank_ifsc, bank_account_last4, highest_qualification, firm_name, completed_at)
    select id, '1990-01-01', '2025-01-01', 'SYNTH addr', 'SYNTH addr', 'Pune', 'MH', '411001', 'SYNTH Kin', 'Sibling', '9000000000', 'AB1C', '1234',
      'SYNTH Bank', 'SYNB0000001', '9999', 'Graduate', 'SYNTH Firm', now() from persons;
    insert into agreement_acceptances(person_id, version, typed_name, body_md5) select id, 'v1', full_name, 'x' from persons;`);
}
