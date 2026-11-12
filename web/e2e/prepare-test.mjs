// Photo correction check (D-128): a card photographed sideways, tilted and small in the frame must come back upright,
// straight and cropped, and then read. Synthetic card only (no real document). Run after `npm run build`.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');   // run with NODE_PATH=$(npm root -g)
const srv = spawn('npx', ['vite', 'preview', '--port', '4320', '--strictPort'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch(); const out = { cases: [], fails: [] };
try {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.addInitScript((dump) => { localStorage.setItem('crux-e2e-ocr', '1'); window.__dump = dump; }, !!process.env.DUMP);
  await ctx.route(/supabase\.co\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const page = await ctx.newPage(); await page.goto('http://localhost:4320/'); await page.waitForFunction(() => !!window.__ocr, null, { timeout: 20000 });
  const run = (turn, tilt, frame) => page.evaluate(async ({ turn, tilt, frame }) => {
    const card = document.createElement('canvas'); card.width = 1000; card.height = 630; const g = card.getContext('2d');
    g.fillStyle = '#eef3fb'; g.fillRect(0, 0, 1000, 630); g.fillStyle = '#10233f';
    g.font = 'bold 34px Arial'; g.fillText('INCOME TAX DEPARTMENT', 60, 80); g.fillText('GOVT. OF INDIA', 640, 80);
    g.font = '26px Arial'; g.fillText('Permanent Account Number Card', 60, 150);
    g.font = 'bold 54px Arial'; g.fillText('ABCPE1234F', 60, 240);
    g.font = '24px Arial'; g.fillText('Name', 60, 320); g.font = 'bold 34px Arial'; g.fillText('SYNTH RAVI KUMAR', 60, 365);
    g.font = '24px Arial'; g.fillText("Father's Name", 60, 430); g.font = 'bold 34px Arial'; g.fillText('SYNTH MOHAN KUMAR', 60, 475);
    g.font = '24px Arial'; g.fillText('Date of Birth', 60, 540); g.font = 'bold 34px Arial'; g.fillText('01/01/1990', 60, 585);
    const W = frame ? 3200 : 1100, H = frame ? 2400 : 760;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    x.fillStyle = '#7a6a58'; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 4000; i++) { x.fillStyle = `rgba(${90 + Math.random() * 60 | 0},${80 + Math.random() * 50 | 0},${70 + Math.random() * 40 | 0},.5)`; x.fillRect(Math.random() * W, Math.random() * H, 6, 6); }
    x.translate(W * 0.55, H * 0.5); x.rotate(((turn + tilt) * Math.PI) / 180); x.drawImage(card, -500, -315);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const o = await window.__ocr();
    const before = await o.scanDocument(blob, 'pan').then((r) => r.check.ok ? r.parsed.number : null, () => null);
    const p = await o.prepareImage(blob, { crop: true });
    const bmp = await createImageBitmap(p.blob);
    const after = await o.scanDocument(p.blob, 'pan').then((r) => r.check.ok ? r.parsed.number : null, () => null);
    const b64 = window.__dump ? await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(p.blob); }) : undefined;
    return { b64, in: `${W}x${H}`, changed: p.changed, turned: p.turned, straightened: p.straightened, cropped: p.cropped, out: `${bmp.width}x${bmp.height}`, kb: Math.round(p.blob.size / 1024), before, after };
  }, { turn, tilt, frame });
  for (const [name, turn, tilt, frame] of [['upright, fills frame', 0, 0, false], ['sideways, small in frame', 90, 0, true], ['upside down, tilted 7°, small in frame', 180, 7, true], ['sideways the other way, tilted -5°', 270, -5, true], ['upright, tilted 9°, small in frame', 0, 9, true]]) {
    const r = await run(turn, tilt, frame);
    if (r.b64) { (await import('node:fs')).writeFileSync(new URL(`./out/corrected-${turn}-${tilt}.jpg`, import.meta.url), Buffer.from(r.b64, 'base64')); } delete r.b64;
    out.cases.push({ name, ...r });
    if (r.after !== 'ABCPE1234F') out.fails.push(`${name}: not read after correction (${r.after})`);
    if (turn && !r.changed) out.fails.push(`${name}: not turned`);
    if (frame && !r.cropped) out.fails.push(`${name}: not cropped`);
    if (!turn && !tilt && !frame && r.changed) out.fails.push(`${name}: a good photo was altered`);
  }
} catch (e) { out.fails.push(String(e)); } finally { await browser.close(); srv.kill(); }
console.log(JSON.stringify(out, null, 1)); process.exit(out.fails.length ? 1 : 0);
