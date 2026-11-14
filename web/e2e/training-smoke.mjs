// Training mode check (D-152): the invented company loads in the browser, people can be switched, screens work,
// saving works, and not one request leaves this machine. Run after `npm run build` with the training data built:
//   node ../tools/build-training.mjs && npm run build && NODE_PATH=$(npm root -g) node e2e/training-smoke.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const { chromium } = createRequire(import.meta.url)('playwright');

const srv = spawn('npx', ['vite', 'preview', '--port', '4320', '--strictPort'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch();
const out = { errors: [], outside: [], fails: [], steps: [] };
const OUT = new URL('./out/', import.meta.url).pathname;
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => out.errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && out.errors.push('console: ' + m.text().slice(0, 300)));
  page.on('request', (r) => { const u = r.url(); if (!/^(http:\/\/localhost:4320|data:|blob:)/.test(u)) out.outside.push(u); });
  const t0 = Date.now();
  await page.goto('http://localhost:4320/?training#/');
  await page.getByText('Training mode').first().waitFor({ timeout: 60000 });
  await page.getByText(/Good (morning|afternoon|evening)/).first().waitFor({ timeout: 60000 });
  out.steps.push({ step: 'loaded', ms: Date.now() - t0 });
  await page.screenshot({ path: `${OUT}training-admin.png` });
  const as = async (label) => {
    const v = await page.locator('select[aria-label="Switch to another person"] option').filter({ hasText: label }).first().getAttribute('value');
    await page.selectOption('select[aria-label="Switch to another person"]', v); await page.waitForTimeout(2000);
  };
  const go = async (hash, expect, shot) => {
    await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(3000);
    const text = await page.locator('main').innerText().catch(() => '');
    for (const e of expect) if (!text.includes(e)) out.fails.push(`${shot}: missing "${e}"`);
    await page.screenshot({ path: `${OUT}training-${shot}.png` });
  };
  await as('Executive — Rohan'); await go('#/productivity', ['My day', 'Pune (Demo)'], 'executive-day');
  await go('#/kpis', ['Average Quality Score'], 'executive-kpis');
  // saving works (in this tab only)
  const planned = page.getByLabel(/Planned/).first();
  if (await planned.isVisible().catch(() => false)) {
    await planned.fill('97'); await page.getByRole('button', { name: 'Save' }).first().click(); await page.waitForTimeout(1500);
    if (await page.locator('.banner.bad').first().isVisible().catch(() => false)) out.fails.push('save KPI: ' + await page.locator('.banner.bad').first().innerText());
  } else out.fails.push('save KPI: no Planned box');
  await as('Branch Manager — Rahul'); await go('#/team', ["Today's review", 'Rohan Patil (Demo)'], 'bm-team');
  await as('National Head'); await go('#/reports', ['Zonal Tracker', 'Pune (Demo)'], 'nh-reports');
  await as('Executive — Ritika'); await go('#/', ['Good'], 'collections-home');
  await as('Admin'); await go('#/admin', ['People and HR', 'Pause or resume functions'], 'admin');
} catch (e) { out.fails.push('fatal: ' + String(e.message).slice(0, 300)); }
finally { await browser.close(); srv.kill(); }
if (out.outside.length) out.fails.push(`${out.outside.length} request(s) left the browser: ${out.outside.slice(0, 3).join(', ')}`);
console.log(JSON.stringify(out, null, 1));
process.exit(out.fails.length || out.errors.length ? 1 : 0);
