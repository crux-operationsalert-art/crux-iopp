// End-to-end check of on-phone document reading: real Tesseract in Chromium, served from this site's /ocr files,
// against synthetic card images (made-up numbers). Server calls are mocked. Usage: npm run build && node e2e/ocr-e2e.mjs <cards-dir>
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const dir = process.argv[2];
const me = { person_id: 'p1', full_name: 'SYNTH Ravi', designation: 'Executive', status: 'active', roles: ['executive'], manages_operations: false, manages_collections: false,
  has_collections: false, today: '2026-11-10', tz: 'Asia/Kolkata', server_time: '2026-11-10T12:00:00+05:30', mobile: '9800000001', resource_type: 'own_employee', heads_locations: false,
  agreement_version: 'v1', agreement_ok: true, profile_missing: ['Aadhaar card (scan)'], company: { name: 'SYNTH', place: 'Pune', website: 'synth.test', address: '' }, products: [], ea_for: [], hr: false,
  reports_figures: true, profile: { pct: 60, done: 9, total: 15, missing: ['Aadhaar card (scan)'], due_at: '2099-01-01T00:00:00Z', blocking: false } };
const R = { whoami: me, person_profile: { person: {}, identity: {}, documents: [], progress: me.profile }, scannable_documents: [] };
const cases = [
  ['Aadhaar card', 'aadhaar.jpg', /We read this[\s\S]*2345 6789 0124/],
  ['Aadhaar card', 'aadhaar_sideways.jpg', /We read this[\s\S]*2345 6789 0124/],
  ['PAN card', 'pan.jpg', /We read this[\s\S]*ABCPS1234F/],
  ['Bank proof', 'cheque.jpg', /We read this[\s\S]*301234567890[\s\S]*SBIN0001234 · State Bank of India/],
  ['Aadhaar card', 'passport.jpg', /looks like a Passport, not your Aadhaar/],
  ['Aadhaar card', 'pan.jpg', /looks like your PAN card, not your Aadhaar/],
  ['Aadhaar card', 'blurry.jpg', /(could not read|could not read the number)/i],
];
const srv = spawn('npx', ['vite', 'preview', '--port', '4320', '--strictPort'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch();
const out = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => localStorage.setItem('sb-gizzonxfwsqfwgjyqzxc-auth-token', JSON.stringify({ access_token: 'x', refresh_token: 'y', token_type: 'bearer',
    expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: 'u1', aud: 'authenticated', role: 'authenticated' } })));
  await ctx.route(/supabase\.co\//, (route) => { const m = /\/rest\/v1\/rpc\/(\w+)/.exec(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(m ? R[m[1]] ?? [] : []) }); });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:4320/#/'); await page.waitForTimeout(2500);
  for (const [card, file, want] of cases) {
    const box = page.locator('section.card', { has: page.locator('h2', { hasText: card }) }).first();
    // back to the upload state if a previous case left a result open
    for (const b of ['Scan another', 'Cancel']) { const x = box.getByRole('button', { name: b }); if (await x.count()) { await x.first().click(); await page.waitForTimeout(300); } }
    const t0 = Date.now();
    await box.locator('input[type=file]').first().setInputFiles(join(dir, file));
    let text = '';
    for (let i = 0; i < 120; i++) { await page.waitForTimeout(500); text = await box.innerText(); if (/We read this|looks like|could not|cannot|Wrong|password/i.test(text)) break; }
    const ok = want.test(text);
    out.push({ card, file, ok, seconds: Math.round((Date.now() - t0) / 100) / 10, got: ok ? undefined : text.replace(/\s+/g, ' ').slice(0, 220) });
  }
  out.push({ pageErrors: errs });
} finally { await browser.close(); srv.kill(); }
console.log(JSON.stringify(out, null, 1));
process.exit(out.every((o) => o.ok !== false) ? 0 : 1);
