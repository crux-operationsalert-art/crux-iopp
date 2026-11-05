// Every select('table', 'columns…') in the web app is sent to the live API (no data is read without sign-in);
// PostgREST resolves embeds before row security, so an ambiguous or missing relationship fails here (PGRST2xx / 42703).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
let env = {}; try { env = Object.fromEntries(readFileSync(new URL('../web/.env.local', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => l.split(/=(.*)/s).slice(0, 2))); } catch { /* CI: from the environment */ }
const url = process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL, key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY;
const files = []; const walk = (d) => readdirSync(d).forEach((f) => { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) && files.push(p); });
walk(new URL('../web/src', import.meta.url).pathname);
const seen = new Set(); const bad = [];
for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/select(?:<[^>]*>)?\('(\w+)',\s*'([^']+)'/g)) {
  const k = m[1] + '|' + m[2]; if (seen.has(k)) continue; seen.add(k);
  const r = await fetch(`${url}/rest/v1/${m[1]}?select=${encodeURIComponent(m[2])}&limit=0`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) { const j = await r.json().catch(() => ({})); if (j.code !== '42501') bad.push(`${f.split('/src/')[1]}: ${m[1]}(${m[2].slice(0, 60)}) → ${r.status} ${j.code} ${j.message}`); }
}
console.log(`${seen.size} selects checked`); bad.forEach((b) => console.log('✗', b)); process.exit(bad.length ? 1 : 0);
