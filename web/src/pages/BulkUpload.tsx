import { useState } from 'react';
import { read, utils, writeFile } from 'xlsx';
import { has, Me, rpc, select } from '../lib/api';
import { money, num } from '../lib/format';
import { parseTrackerFile, type ParsedTracker } from '../lib/tracker';
import { Card, Empty, ErrorBox, useLoad } from '../components/ui';

type Kind = { key: string; name: string; cols: string[]; required: string[]; example: Record<string, string | number>; note: string; hr?: boolean };
export const KINDS: Kind[] = [
  { key: 'people', name: 'People (team members)', hr: true, cols: ['full_name', 'mobile', 'email', 'type', 'designation', 'role', 'reports_to_mobile', 'function', 'zone', 'branch', 'valid_from'],
    required: ['full_name', 'mobile'], example: { full_name: 'Ravi Kumar', mobile: '9800000000', email: '', type: 'own', designation: 'Field Executive', role: 'executive', reports_to_mobile: '9811111111', function: 'operations', zone: '', branch: '', valid_from: '' },
    note: 'role: executive, manager, bm, ba, zm (ops_head/admin only via Admin). type: own or partner. reports_to_mobile = the manager\'s mobile (leave blank to add them under yourself). After import, each person gets an onboarding to-do for their manager.' },
  { key: 'allocations', name: 'Allocations (who works on which client/location)', hr: true, cols: ['mobile', 'client', 'location', 'process', 'function', 'valid_from', 'valid_to'],
    required: ['mobile', 'client', 'location'], example: { mobile: '9800000000', client: 'BOM', location: 'Pune', process: '', function: 'operations', valid_from: '01-11-2026', valid_to: '' },
    note: 'The client must already be served at that location (see Services). Blank process = Verification.' },
  { key: 'zones', name: 'Zones', cols: ['code', 'name', 'region'], required: ['name'], example: { code: '', name: 'Pune Zone', region: 'West' }, note: 'Blank code = generated from the name. Existing codes are updated.' },
  { key: 'branches', name: 'Branches', cols: ['code', 'name', 'type', 'state', 'city', 'zone', 'valid_from'], required: ['name'],
    example: { code: '', name: 'Pune', type: 'own', state: 'Maharashtra', city: 'Pune', zone: 'Pune Zone', valid_from: '' }, note: 'type: own or partner (BA). zone = zone name or code.' },
  { key: 'locations', name: 'Locations', cols: ['code', 'name', 'city', 'state'], required: ['name'], example: { code: '', name: 'Pune', city: 'Pune', state: 'Maharashtra' }, note: '' },
  { key: 'clients', name: 'Clients', cols: ['code', 'name', 'family'], required: ['name'], example: { code: '', name: 'BOM Retail', family: 'BOM' }, note: 'family groups related clients (e.g. BOM Retail and BOM MSME).' },
  { key: 'services', name: 'Services (client served at a location)', cols: ['client', 'location', 'process', 'branch', 'valid_from', 'valid_to'], required: ['client', 'location'],
    example: { client: 'BOM Retail', location: 'Pune', process: '', branch: '', valid_from: '01-11-2026', valid_to: '' }, note: 'Blank branch = the branch with the same name as the location.' },
  { key: 'rates', name: 'Rates', cols: ['client', 'location', 'process', 'earns_on', 'rate', 'valid_from', 'valid_to', 'reason'], required: ['client', 'location', 'rate'],
    example: { client: 'BOM Retail', location: 'Pune', process: '', earns_on: 'entry', rate: 750, valid_from: '01-12-2026', valid_to: '', reason: 'Client rate revision' },
    note: 'earns_on: entry (default, entered cases minus cancelled), closure or net. A new rate ends the previous open rate the day before valid_from; history is kept.' },
  { key: 'targets', name: 'Targets', cols: ['month', 'metric', 'level', 'amount', 'zone', 'branch', 'mobile', 'client', 'reason'], required: ['month', 'metric', 'level', 'amount'],
    example: { month: '2026-12', metric: 'revenue', level: 'zone', amount: 2500000, zone: 'Pune Zone', branch: '', mobile: '', client: '', reason: 'December plan' },
    note: 'metric: net_actioned, entry, closure, revenue, collections_received, collections_reconciled, bill_count, bill_amount. level: org, zone, branch, person (person = mobile). Locked after the 5th working day.' },
  { key: 'holidays', name: 'Holidays', hr: true, cols: ['date', 'name', 'scope', 'state', 'branch'], required: ['date', 'name'],
    example: { date: '25-12-2026', name: 'Christmas', scope: 'national', state: '', branch: '' }, note: 'scope: national, state, branch. Holidays are excluded from working days.' },
  { key: 'partner_ratios', name: 'Partner ratios (bookkeeping only)', cols: ['branch', 'partner_pct', 'valid_from', 'agreement_ref', 'reason'], required: ['branch', 'partner_pct'],
    example: { branch: 'Nashik', partner_pct: 80, valid_from: '01-11-2026', agreement_ref: '', reason: 'BA agreement' }, note: 'partner_pct 80 = partner/BA 80 : CRUX 20. No amounts are calculated.' },
  { key: 'wip_openings', name: 'Opening WIP', cols: ['mobile', 'client', 'location', 'valid_from', 'opening', 'reason'], required: ['mobile', 'client', 'location', 'opening'],
    example: { mobile: '9800000000', client: 'BOM Retail', location: 'Pune', valid_from: '01-11-2026', opening: 12, reason: 'Physical count' }, note: 'Pending cases in hand on that date.' },
];

const norm = (k: string) => k.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

export function BulkUpload({ me }: { me: Me }) {
  const kinds = has(me, 'admin') ? KINDS : has(me, 'hr_admin') ? KINDS.filter((k) => k.hr) : KINDS.filter((k) => k.key === 'people');
  const [kind, setKind] = useState(kinds[0].key);
  const k = kinds.find((x) => x.key === kind) ?? kinds[0];
  const [file, setFile] = useState('');
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  function template() {
    const ws = utils.json_to_sheet([k.example], { header: k.cols });
    const wb = utils.book_new(); utils.book_append_sheet(wb, ws, k.key);
    utils.book_append_sheet(wb, utils.aoa_to_sheet([['Notes'], [k.note], ['Required columns: ' + k.required.join(', ')], ['Dates: YYYY-MM-DD or DD-MM-YYYY. Delete the example row before uploading.']]), 'notes');
    writeFile(wb, `crux_${k.key}_template.xlsx`);
  }
  async function load(f: File) {
    setErr(null); setRes(null); setFile(f.name);
    try {
      const wb = read(await f.arrayBuffer(), { type: 'array', cellDates: true });
      const json = utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: true });
      // Excel dates → YYYY-MM-DD (local calendar date); numbers stay unformatted.
      const cell = (b: unknown) => b instanceof Date
        ? `${b.getFullYear()}-${String(b.getMonth() + 1).padStart(2, '0')}-${String(b.getDate()).padStart(2, '0')}` : String(b ?? '').trim();
      const out = json.map((r) => Object.fromEntries(Object.entries(r).map(([a, b]) => [norm(a), cell(b)])))
        .filter((r) => Object.values(r).some((v) => v !== ''));
      const missing = k.required.filter((c) => !(out[0] && c in out[0]));
      if (missing.length) throw new Error(`Missing column(s): ${missing.join(', ')}. Download the template for the exact headings.`);
      setRows(out);
    } catch (e) { setRows([]); setErr(e); }
  }
  async function run(dry: boolean) {
    setBusy(true); setErr(null);
    try { setRes({ ...(await rpc('bulk_import', { p_kind: k.key, p_rows: rows, p_dry_run: dry })), dry }); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const checked = res && res.dry && res.errors.length === 0 && res.rows === rows.length;
  const cols = rows[0] ? Object.keys(rows[0]) : [];

  return (
    <div className="stack">
      <Card title="Bulk upload">
        <div className="stack">
          <label className="field">What are you uploading?
            <select value={kind} onChange={(e) => { setKind(e.target.value); setRows([]); setRes(null); setFile(''); }}>
              {kinds.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}</select></label>
          <p className="small muted">{k.note} Columns: <b>{k.cols.join(', ')}</b> (required: {k.required.join(', ')}).</p>
          <div className="row">
            <button className="btn" onClick={template}>Download template (.xlsx)</button>
            <label className="btn">Choose file (.xlsx or .csv)<input type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} /></label>
            <span className="small muted">{file}</span>
          </div>
          <p className="small muted">Step 1 <b>Check</b> runs every row and shows problems without saving anything. Step 2 <b>Import</b> saves all rows together — if any row fails, nothing is saved. Max 5,000 rows.</p>
          <ErrorBox error={err} />
        </div>
      </Card>
      {rows.length > 0 && (
        <Card title={`${rows.length} row(s) read from ${file}`} action={<div className="row">
          <button className="btn" disabled={busy} onClick={() => run(true)}>{busy ? 'Working…' : '1 · Check'}</button>
          <button className="btn primary" disabled={busy || !checked} onClick={() => run(false)} title={checked ? '' : 'Run Check first; it must show no errors'}>2 · Import</button></div>}>
          {res && (res.applied ? <div className="banner ok">Imported {res.ok} row(s). The changes are in the audit log.</div>
            : res.errors.length ? <div className="banner bad">{res.errors.length} row(s) have problems — nothing was saved. Fix them in your file and choose it again.</div>
            : <div className="banner ok">Check passed: all {res.ok} row(s) are valid. Nothing saved yet — press Import.</div>)}
          {res?.errors?.length > 0 && <div className="tablewrap"><table><thead><tr><th>Row</th><th>Problem</th></tr></thead>
            <tbody>{res.errors.slice(0, 200).map((e: any) => <tr key={e.row}><td>{e.row + 1}</td><td>{e.error}</td></tr>)}</tbody></table></div>}
          <div className="tablewrap"><table><thead><tr><th>#</th>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{rows.slice(0, 15).map((r, i) => <tr key={i}><td>{i + 2}</td>{cols.map((c) => <td key={c} className="small">{r[c]}</td>)}</tr>)}</tbody></table></div>
          {rows.length > 15 && <p className="small muted">Showing the first 15 rows. Row numbers match your spreadsheet (row 1 = headings).</p>}
        </Card>)}
    </div>
  );
}

/** Daily upload of the WhatsApp-fed Live Zonewise tracker → Revenue Status report. */
export function TrackerUpload() {
  const zones = useLoad(() => select('zones', 'name,region'), []);
  const loaded = useLoad(() => rpc('revenue_status_data', {}), []);
  const [p, setP] = useState<ParsedTracker | null>(null);
  const [file, setFile] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [done, setDone] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  async function load(f: File) {
    setErr(null); setDone(null); setFile(f.name);
    try {
      const reg = Object.fromEntries((zones.data ?? []).map((z: any) => [z.name, z.region]));
      setP(parseTrackerFile(await f.arrayBuffer(), reg));
    } catch (e) { setP(null); setErr(e); }
  }
  const bad = p ? p.recon.some((r) => Math.abs(r.difference) >= 1) : false;
  async function go() {
    if (!p) return;
    setBusy(true); setErr(null);
    try { setDone(await rpc('import_tracker_day', { p_as_of: p.as_of, p_file: file, p_rows: p.rows, p_check: { recon: p.recon, warnings: p.warnings } })); loaded.reload(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const dates: string[] = loaded.data?.dates ?? [];
  return (
    <div className="stack">
      <Card title="Daily Zonal Tracker upload">
        <div className="stack">
          <p className="small muted">Until branches enter figures directly, upload the day's <b>Live Zonewise Monthly Business Tracker</b> (.xlsx) here. The file is read in your browser; only the Main Tracker figures
            (zone, location, client, stakeholder, target, MTD cases and revenue, daily count) are saved. Re-uploading the same date replaces that date. The original file is never changed.</p>
          <label className="btn">Choose tracker file<input type="file" accept=".xlsx" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} /></label>
          <ErrorBox error={err} />
          <p className="small muted">Dates already loaded: {dates.length ? dates.slice(0, 12).join(', ') : 'none yet'}</p>
        </div>
      </Card>
      {p && (
        <Card title={`${file} — as on ${p.as_of}`} action={<button className="btn primary" disabled={busy || bad} onClick={go}>{busy ? 'Importing…' : `Import ${p.rows.length} rows`}</button>}>
          <div className="stack">
            <table><thead><tr><th>Check against the Pan India row</th><th className="num">File rows</th><th className="num">Pan India</th><th className="num">Difference</th></tr></thead>
              <tbody>{p.recon.map((r) => <tr key={r.measure}><td>{r.measure}</td><td className="num">{r.measure.includes('evenue') ? money(r.rows) : num(r.rows)}</td>
                <td className="num">{r.measure.includes('evenue') ? money(r.pan_india) : num(r.pan_india)}</td><td className="num"><b className={Math.abs(r.difference) >= 1 ? 'bad' : ''}>{num(r.difference)}</b></td></tr>)}</tbody></table>
            {bad ? <div className="banner bad">The rows do not add up to the Pan India row, so the file is not imported. Check the tracker for a row outside a zone block.</div>
              : <div className="banner ok">All four totals match the Pan India row.</div>}
            {p.warnings.map((w, i) => <div key={i} className="banner warn">{w}</div>)}
            <p className="small muted">Stakeholders found: {p.stakeholders.join(' · ') || 'none'}</p>
            {done && <div className="banner ok">Imported {done.rows} rows for {done.as_of}. Open Reports → Revenue Status.</div>}
          </div>
        </Card>)}
      {!p && !err && <Empty>Choose the tracker file to preview it before importing.</Empty>}
    </div>
  );
}
