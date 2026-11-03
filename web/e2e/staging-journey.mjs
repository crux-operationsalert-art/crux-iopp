// Live end-to-end journey against STAGING (synthetic data only).
// Usage: QA_PASSWORD=... node e2e/staging-journey.mjs   (after `npm run build` and `npx vite preview --port 4173`)
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync } from 'node:fs';

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').trim().split('\n').map((l) => l.split('=')));
const URL_ = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY, APP = 'http://localhost:4173/';
const REF = new URL(URL_).hostname.split('.')[0];
const PW = process.env.QA_PASSWORD;
mkdirSync('e2e/out', { recursive: true });
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };

async function session(email) {
  const c = createClient(URL_, KEY, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw error;
  return { c, s: data.session };
}
async function page(browser, s, viewport) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${REF}-auth-token`, JSON.stringify(s)]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  return p;
}

const browser = await chromium.launch();
try {
  // ---------- Executive: daily entry on a phone
  const ex = await session('qa.exec@example.invalid');
  const me = (await ex.c.rpc('whoami')).data;
  check('exec whoami resolves via RLS-backed identity', me?.full_name === 'SYNTH Executive 1');
  const others = await ex.c.from('productivity_lines').select('person_id');
  check('exec sees only own productivity lines', others.data.every((r) => r.person_id === me.person_id), `(${others.data.length} rows)`);
  const bm0 = await ex.c.from('persons').select('id').eq('full_name', 'SYNTH Executive 2');
  check('exec cannot read a peer person record', bm0.data.length === 0);
  const tamper = await ex.c.rpc('save_productivity', { p_work_date: me.today, p_rows: [], p_person: '00000000-0000-0000-0000-000000000001', p_reason: 'x' });
  check('exec cannot write for someone else (ID tampering)', !!tamper.error, tamper.error?.message);
  const direct = await ex.c.from('productivity_lines').insert({ person_id: me.person_id, work_date: me.today, client_location_id: me.person_id });
  check('exec cannot insert into tables directly', !!direct.error, direct.error?.message);

  const p1 = await page(browser, ex.s, { width: 390, height: 844 });
  await p1.goto(APP + '#/productivity');
  await p1.getByText('SYNTH Bank A').first().waitFor({ timeout: 20000 });
  const already = await p1.getByText(/Submitted .*Waiting for your manager/).isVisible();
  const inputs = p1.locator('input[type=number]');
  if (!already) {
  check('exec sees allocated rows (2 clients × 3 inputs)', (await inputs.count()) === 6, `(${await inputs.count()} inputs)`);
  await inputs.nth(0).fill('7'); await inputs.nth(1).fill('5'); await inputs.nth(2).fill('1'); await inputs.nth(3).fill('2');
  await p1.getByText('Draft saved').waitFor({ timeout: 15000 });
  check('autosave shows "Draft saved"', true);
  await p1.screenshot({ path: 'e2e/out/1-exec-entry-mobile.png', fullPage: true });
  await p1.getByRole('button', { name: 'Review and submit' }).click();
  await p1.getByRole('button', { name: 'Submit', exact: true }).click();
  await p1.getByText(/Submitted .*Waiting for your manager/).waitFor({ timeout: 15000 });
  check('exec submits; screen confirms and locks', (await p1.locator('input[type=number]:enabled').count()) === 0);
  await p1.screenshot({ path: 'e2e/out/2-exec-submitted-mobile.png', fullPage: true });
  }
  await p1.goto(APP + '#/');
  await p1.getByText('Net cases actioned').waitFor();
  await p1.waitForTimeout(1500);
  await p1.screenshot({ path: 'e2e/out/3-exec-home-mobile.png', fullPage: true });

  // ---------- BM: team review and certification on desktop
  const bm = await session('qa.bm@example.invalid');
  const p2 = await page(browser, bm.s, { width: 1280, height: 900 });
  await p2.goto(APP + '#/team');
  await p2.getByText('SYNTH Executive 2', { exact: true }).waitFor({ timeout: 20000 });
  check('BM sees certify blocked while team pending', await p2.getByText(/You can certify once everyone is resolved/).isVisible());
  await p2.screenshot({ path: 'e2e/out/4-bm-team-blocked.png', fullPage: true });
  // Executive 2: absent with reason
  await p2.locator('tr', { hasText: 'SYNTH Executive 2' }).getByRole('button', { name: 'Set status' }).click();
  await p2.getByRole('radio', { name: 'Absent' }).click();
  await p2.locator('textarea').fill('SYNTH: sick, informed by phone');
  await p2.getByRole('button', { name: 'Save', exact: true }).click();
  await p2.locator('tr', { hasText: 'SYNTH Executive 2' }).getByText('Absent').waitFor();
  // Executive 3: entered on behalf
  await p2.locator('tr', { hasText: 'SYNTH Executive 3' }).getByRole('button', { name: 'Enter for them' }).click();
  const bi = p2.locator('.card input[type=number]');
  await bi.first().waitFor();
  await bi.nth(0).fill('4'); await bi.nth(1).fill('3');
  await p2.locator('textarea').fill('SYNTH: field visit, no signal');
  await p2.getByRole('button', { name: 'Save', exact: true }).click();
  await p2.locator('tr', { hasText: 'SYNTH Executive 3' }).getByText('Manager entered').waitFor({ timeout: 15000 });
  check('BM resolves absent + on-behalf entry with reasons', true);
  await p2.getByRole('button', { name: 'Certify team' }).click();
  await p2.getByRole('heading', { name: 'Certified' }).waitFor({ timeout: 15000 });
  const cert = (await bm.c.from('certifications').select('team_totals,own_totals,calculated_total').eq('work_date', me.today)).data[0];
  check('certification snapshot = team roll-up (7+5−1 + 2 + 4+3)', Number(cert.calculated_total) === 20, JSON.stringify(cert.team_totals));
  await p2.screenshot({ path: 'e2e/out/5-bm-certified.png', fullPage: true });
  await p2.goto(APP + '#/reports');
  await p2.getByText('Missing submissions').waitFor();
  await p2.waitForTimeout(2000);
  await p2.screenshot({ path: 'e2e/out/6-bm-reports.png', fullPage: true });
  const zm = await bm.c.from('productivity_lines').select('person_id', { count: 'exact', head: true }).neq('person_id', bm.s.user.id);
  const outside = await bm.c.rpc('ops_rollup', { p_from: '2026-10-01', p_to: me.today, p_group: 'branch' });
  check('BM roll-up contains only own branch', outside.data.every((r) => r.label === 'SYNTH Pune Branch'), outside.data.map((r) => r.label).join(','));
  await p2.goto(APP + '#/');
  await p2.waitForTimeout(2500);
  await p2.screenshot({ path: 'e2e/out/7-bm-home.png', fullPage: true });
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exitCode = failed ? 1 : 0;
}
