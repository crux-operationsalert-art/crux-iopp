// TRAINING ONLY (D-152). A copy of the whole app database running inside this browser tab, filled with an
// invented company. It answers the same requests the real server would (PostgREST style), so every screen works,
// but nothing ever leaves the browser and nothing here is, or can touch, real data.
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

export type TrainingMeta = { built: string; today: string; clock: string; people: { key: string; auth: string; name: string; designation: string; role: string }[] };

let dbp: Promise<PGlite> | null = null;
let metaP: Promise<TrainingMeta> | null = null;
export const loadMeta = () => (metaP ??= fetch('./training/meta.json', { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error('Training data is missing on this site.'); return r.json(); }));
function database() {
  return (dbp ??= (async () => {
    const r = await fetch('./training/db.tar.gz', { cache: 'no-store' });
    if (!r.ok) throw new Error('Training data is missing on this site.');
    return PGlite.create({ loadDataDir: await r.blob(), extensions: { btree_gist, pgcrypto } });
  })());
}
/** Starts again from the original training data (throws away everything done in this tab). */
export async function resetTraining() { const old = dbp; dbp = null; files.clear(); if (old) await (await old).close().catch(() => undefined); await database(); }

let current = '';
export const setTrainingUser = (auth: string) => { current = auth; };
export const trainingUser = () => current;

const IDENT = /^[a-z_][a-z0-9_]*$/;
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
const ident = (v: string) => { if (!IDENT.test(v)) throw new Error(`Not allowed: ${v}`); return v; };

type Fk = { con: string; src: string; srccols: string[]; dst: string; dstcols: string[] };
let fks: Fk[] | null = null;
async function foreignKeys(tx: Transaction): Promise<Fk[]> {
  if (fks) return fks;
  const r = await tx.query<{ con: string; src: string; dst: string; srccols: string[]; dstcols: string[] }>(`
    select c.conname con, s.relname src, d.relname dst,
           array(select a.attname::text from unnest(c.conkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.i) srccols,
           array(select a.attname::text from unnest(c.confkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by k.i) dstcols
      from pg_constraint c join pg_class s on s.oid = c.conrelid join pg_class d on d.oid = c.confrelid
      join pg_namespace ns on ns.oid = s.relnamespace
     where c.contype = 'f' and ns.nspname = 'public'`);
  return (fks = r.rows);
}

// ---------------------------------------------------------------- select=… with embedded tables
type Node = { name: string; hint?: string; cols: (string | Node)[] };
function parseSelect(s: string): (string | Node)[] {
  let i = 0;
  const list = (): (string | Node)[] => {
    const out: (string | Node)[] = [];
    while (i < s.length) {
      let tok = '';
      while (i < s.length && !',()'.includes(s[i])) tok += s[i++];
      tok = tok.trim();
      if (s[i] === '(') { i++; const [name, hint] = tok.split('!'); out.push({ name, hint, cols: list() }); i++; }
      else if (tok) out.push(tok);
      if (s[i] === ',') { i++; continue; }
      if (s[i] === ')' || i >= s.length) break;
    }
    return out;
  };
  return list();
}
async function objectSql(tx: Transaction, table: string, alias: string, cols: (string | Node)[], depth = 0): Promise<string> {
  const plain = cols.filter((c): c is string => typeof c === 'string');
  const parts: string[] = [];
  let base = 'jsonb_build_object()';
  if (plain.includes('*')) base = `to_jsonb(${alias})`;
  for (const c of plain) if (c !== '*') { const [name, as] = c.includes(':') ? c.split(':').reverse() : [c, c]; parts.push(`${q(as)}, ${alias}.${ident(name)}`); }
  for (const n of cols.filter((c): c is Node => typeof c !== 'string')) {
    const all = await foreignKeys(tx);
    const sub = `e${depth}_${n.name}`;
    const hinted = (f: Fk) => !n.hint || f.con === n.hint || f.srccols.includes(n.hint);
    const many2one = all.find((f) => f.src === table && f.dst === n.name && hinted(f));
    const one2many = !many2one && all.find((f) => f.src === n.name && f.dst === table && hinted(f));
    if (!many2one && !one2many) throw new Error(`No relationship between ${table} and ${n.name}`);
    const inner = await objectSql(tx, n.name, sub, n.cols, depth + 1);
    if (many2one) {
      const on = many2one.srccols.map((c, k) => `${sub}.${many2one.dstcols[k]} = ${alias}.${c}`).join(' and ');
      parts.push(`${q(n.name)}, (select ${inner} from public.${ident(n.name)} ${sub} where ${on} limit 1)`);
    } else if (one2many) {
      const on = one2many.srccols.map((c, k) => `${sub}.${c} = ${alias}.${one2many.dstcols[k]}`).join(' and ');
      parts.push(`${q(n.name)}, (select coalesce(jsonb_agg(${inner}), '[]'::jsonb) from public.${ident(n.name)} ${sub} where ${on})`);
    }
  }
  // jsonb_build_object takes at most 100 arguments: build in chunks
  let sql = base;
  for (let k = 0; k < parts.length; k += 40) sql += ` || jsonb_build_object(${parts.slice(k, k + 40).join(', ')})`;
  return sql;
}

// ---------------------------------------------------------------- filters: col=eq.x, in.(a,b), is.null, gte., …
function unquote(v: string) { return v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/\\"/g, '"') : v; }
function splitList(v: string) { const out: string[] = []; let cur = '', inq = false; for (const ch of v) { if (ch === '"') inq = !inq; if (ch === ',' && !inq) { out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out.map(unquote); }
const OPS: Record<string, string> = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike' };
function where(params: URLSearchParams, alias: string): string {
  const conds: string[] = [];
  for (const [k, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    const col = `${alias}.${ident(k)}`;
    let v = raw, neg = false;
    if (v.startsWith('not.')) { neg = true; v = v.slice(4); }
    const dot = v.indexOf('.'); const op = v.slice(0, dot); const val = v.slice(dot + 1);
    let c: string;
    if (op === 'is') c = `${col} is ${val === 'null' ? 'null' : val === 'true' ? 'true' : val === 'false' ? 'false' : 'unknown'}`;
    else if (op === 'in') c = `${col} in (${splitList(val.replace(/^\(|\)$/g, '')).map(q).join(', ') || 'null'})`;
    else if (op === 'cs') c = `${col} @> ${q(val)}`;
    else if (OPS[op]) c = `${col} ${OPS[op]} ${q(op.endsWith('like') ? val.replace(/\*/g, '%') : unquote(val))}`;
    else throw new Error(`Filter not supported in training: ${op}`);
    conds.push(neg ? `not (${c})` : c);
  }
  return conds.length ? conds.join(' and ') : 'true';
}
function orderBy(params: URLSearchParams, alias: string) {
  const o = params.get('order'); if (!o) return '';
  return ' order by ' + o.split(',').map((p) => { const [c, ...m] = p.split('.'); return `${alias}.${ident(c)}${m.includes('desc') ? ' desc' : ''}${m.includes('nullsfirst') ? ' nulls first' : m.includes('nullslast') ? ' nulls last' : ''}`; }).join(', ');
}

// ---------------------------------------------------------------- RPC
type Fn = { names: string[]; types: string[]; ndefaults: number; retset: boolean; rettype: string; composite: boolean };
const fnCache = new Map<string, Fn[]>();
async function signatures(tx: Transaction, name: string) {
  if (fnCache.has(name)) return fnCache.get(name)!;
  const r = await tx.query<{ names: string[] | null; types: string[]; nd: number; retset: boolean; rettype: string; composite: boolean }>(`
    select p.proargnames names, array(select format_type(t, null) from unnest(p.proargtypes::oid[]) t) types, p.pronargdefaults nd, p.proretset retset,
           format_type(p.prorettype, null) rettype, (select typtype from pg_type where oid = p.prorettype) in ('c') composite
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [name]);
  const list = r.rows.map((x) => ({ names: (x.names ?? []).slice(0, x.types.length), types: x.types, ndefaults: x.nd, retset: x.retset, rettype: x.rettype, composite: x.composite }));
  fnCache.set(name, list); return list;
}
function arg(v: unknown, type: string): string {
  if (v === null || v === undefined) return `null::${type}`;
  if (type === 'jsonb' || type === 'json') return `${q(JSON.stringify(v))}::${type}`;
  if (type.endsWith('[]')) {
    const arr = Array.isArray(v) ? v : [v];
    return `${q('{' + arr.map((x) => (x === null ? 'NULL' : `"${String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)).join(',') + '}')}::${type}`;
  }
  return `${q(typeof v === 'object' ? JSON.stringify(v) : String(v))}::${type}`;
}
async function rpc(tx: Transaction, name: string, body: Record<string, unknown>) {
  ident(name);
  const keys = Object.keys(body ?? {});
  const fn = (await signatures(tx, name)).find((f) => keys.every((k) => f.names.includes(k))
    && f.names.every((n, i) => keys.includes(n) || i >= f.names.length - f.ndefaults));
  if (!fn) throw Object.assign(new Error(`Could not find the function public.${name} with these arguments`), { code: 'PGRST202' });
  const call = `public.${name}(${keys.map((k) => `${ident(k)} => ${arg(body[k], fn.types[fn.names.indexOf(k)])}`).join(', ')})`;
  if (fn.rettype === 'void') { await tx.query(`select ${call}`); return null; }
  if (fn.retset) return (await tx.query<{ j: unknown }>(`select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) j from ${call} x`)).rows[0].j;
  if (fn.composite) return (await tx.query<{ j: unknown }>(`select to_jsonb(x) j from ${call} x`)).rows[0].j;
  return (await tx.query<{ j: unknown }>(`select to_jsonb(${call}) j`)).rows[0].j;
}

// ---------------------------------------------------------------- one request = one transaction, as the chosen person
async function run(method: string, path: string, params: URLSearchParams, body: any, prefer: string) {
  const db = await database();
  const meta = await loadMeta();
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('app.fake_now', $1, true), set_config('request.jwt.claims', $2, true)`, [meta.clock, JSON.stringify({ sub: current, role: 'authenticated' })]);
    await tx.exec('set local role authenticated');
    const m = /^\/rest\/v1\/rpc\/([a-z_0-9]+)$/.exec(path);
    if (m) return rpc(tx, m[1], method === 'GET' ? Object.fromEntries(params) : body ?? {});
    const t = /^\/rest\/v1\/([a-z_0-9]+)$/.exec(path);
    if (!t) throw new Error('Not available in training mode.');
    const table = ident(t[1]);
    const ret = prefer.includes('return=representation');
    const sel = params.get('select') ?? '*';
    if (method === 'GET' || method === 'HEAD') {
      const obj = await objectSql(tx, table, 't', parseSelect(sel));
      const lim = params.get('limit') ? ` limit ${Number(params.get('limit'))}` : '';
      const off = params.get('offset') ? ` offset ${Number(params.get('offset'))}` : '';
      const r = await tx.query<{ j: unknown }>(`select coalesce(jsonb_agg(j), '[]'::jsonb) j from (select ${obj} j from public.${table} t where ${where(params, 't')}${orderBy(params, 't')}${lim}${off}) s`);
      return r.rows[0].j;
    }
    if (method === 'POST') {
      const rows = Array.isArray(body) ? body : [body];
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].map(ident);
      const conflict = params.get('on_conflict');
      const merge = prefer.includes('resolution=merge-duplicates');
      const up = conflict || merge ? ` on conflict${conflict ? ` (${conflict.split(',').map(ident).join(',')})` : ''} do ${prefer.includes('ignore-duplicates') ? 'nothing' : `update set ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}`}` : '';
      const r = await tx.query<{ j: unknown }>(`with ins as (insert into public.${table} (${cols.join(', ')})
          select ${cols.join(', ')} from jsonb_populate_recordset(null::public.${table}, $1::jsonb)${up} returning *)
        select coalesce(jsonb_agg(to_jsonb(ins)), '[]'::jsonb) j from ins`, [JSON.stringify(rows)]);
      return ret ? r.rows[0].j : null;
    }
    if (method === 'PATCH') {
      const cols = Object.keys(body ?? {}).map(ident);
      const r = await tx.query<{ j: unknown }>(`with up as (update public.${table} t set ${cols.map((c) => `${c} = r.${c}`).join(', ')}
          from (select * from jsonb_populate_record(null::public.${table}, $1::jsonb)) r where ${where(params, 't')} returning t.*)
        select coalesce(jsonb_agg(to_jsonb(up)), '[]'::jsonb) j from up`, [JSON.stringify(body ?? {})]);
      return ret ? r.rows[0].j : null;
    }
    if (method === 'DELETE') {
      const r = await tx.query<{ j: unknown }>(`with del as (delete from public.${table} t where ${where(params, 't')} returning t.*) select coalesce(jsonb_agg(to_jsonb(del)), '[]'::jsonb) j from del`);
      return ret ? r.rows[0].j : null;
    }
    throw new Error('Not available in training mode.');
  });
}

// files people "upload" in training stay in this tab
const files = new Map<string, Blob>();
const json = (status: number, v: unknown) => new Response(v === null || v === undefined ? null : JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });

/** The fetch the app uses in training mode: answers everything locally, never calls the network. */
export async function trainingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = new Request(input, init);
  const u = new URL(req.url);
  const path = u.pathname;
  try {
    if (path.startsWith('/rest/v1/')) {
      const text = req.method === 'GET' || req.method === 'HEAD' ? '' : await req.text();
      const body = text ? JSON.parse(text) : null;
      const data = await run(req.method, path, u.searchParams, body, req.headers.get('Prefer') ?? '');
      return json(data === null ? 204 : 200, data);
    }
    if (path.startsWith('/storage/v1/object/sign/')) {
      const key = decodeURIComponent(path.replace('/storage/v1/object/sign/', ''));
      const f = files.get(key);
      return json(200, { signedURL: f ? URL.createObjectURL(f) : 'data:text/plain,Training%20file' });
    }
    if (path.startsWith('/storage/v1/object/')) {
      files.set(decodeURIComponent(path.replace('/storage/v1/object/', '')), await req.blob());
      return json(200, { Key: path });
    }
    if (path.startsWith('/auth/v1/logout')) return new Response(null, { status: 204 });
    if (path.startsWith('/auth/v1/factors')) return json(200, []);
    if (path.startsWith('/auth/v1/user')) return json(200, { id: current, aud: 'authenticated', role: 'authenticated' });
    if (path.startsWith('/functions/v1/')) return json(400, { error: 'Not available in training mode.' });
    return json(400, { message: 'Not available in training mode.' });
  } catch (e) {
    const err = e as { message?: string; code?: string; detail?: string; hint?: string };
    return json(400, { message: err.message ?? String(e), code: err.code ?? 'P0001', details: err.detail ?? null, hint: err.hint ?? null });
  }
}
