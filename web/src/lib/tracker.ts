// Parses the "Main Tracker" sheet of a Live Zonewise Monthly Business Tracker workbook into one row per
// zone × location × client for the current month. Port of tools/parse_tracker.py (current month only) plus
// the "Operation Stakeholders" block, whose formulas reference each location's Total row.
// Nothing is invented: values are copied as recorded; totals are reconciled against the Pan India row.
import { read, utils, type WorkSheet } from 'xlsx';

export type TrackerRow = {
  zone: string; region: string | null; location: string; client: string; stakeholder: string | null;
  target_cases: number; revenue_target: number; mtd_cases: number; mtd_revenue: number;
  reported_added: number | null; source_row: number;
};
export type Recon = { measure: string; rows: number; pan_india: number; difference: number };
export type ParsedTracker = { as_of: string; rows: TrackerRow[]; recon: Recon[]; warnings: string[]; stakeholders: string[] };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v)).replace(/\s+/g, ' ').trim();

export function parseTrackerFile(buf: ArrayBuffer, regionOfZone: Record<string, string | null> = {}): ParsedTracker {
  const wb = read(buf, { type: 'array', cellFormula: true, cellDates: true });
  const ws = wb.Sheets['Main Tracker'];
  if (!ws) throw new Error('This file has no "Main Tracker" sheet. Upload the Live Zonewise Monthly Business Tracker workbook.');
  return parseMainTracker(ws, regionOfZone);
}

export function parseMainTracker(ws: WorkSheet, regionOfZone: Record<string, string | null> = {}): ParsedTracker {
  const range = utils.decode_range(ws['!ref'] ?? 'A1');
  const v = (r: number, c: number) => ws[utils.encode_cell({ r, c })]?.v;
  const f = (r: number, c: number) => ws[utils.encode_cell({ r, c })]?.f as string | undefined;
  const warnings: string[] = [];

  // As-on date: a dd.mm.yyyy header on row 3 (the "Daily Counts" column).
  let as_of = '';
  for (let c = 0; c <= Math.min(range.e.c, 40); c++) {
    const h = v(2, c);
    if (h instanceof Date) continue;
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(str(h));
    if (m) { as_of = `${m[3]}-${m[2]}-${m[1]}`; break; }
  }
  if (!as_of) throw new Error('Could not find the as-on date (a dd.mm.yyyy heading on row 3).');

  type Seg = { label: string; rows: number[]; total: number };
  type Head = { name: string; segs: Seg[] };
  const heads: Head[] = [];
  let cur: Head = { name: str(v(1, 0)), segs: [] };
  let seg: number[] = [];
  let pan = -1;
  for (let i = 3; i <= range.e.r; i++) {
    const a = v(i, 0);
    if (typeof a !== 'string') continue;
    const A = a.trim();
    if (A === 'Pan India') { pan = i; break; }
    if (['North Zone', 'South Zone', 'East Zone', 'West Zone'].includes(A)) continue;
    if (A.toLowerCase().startsWith('total')) {
      if (seg.length) { cur.segs.push({ label: str(v(seg[0], 0)), rows: seg, total: i }); seg = []; }
      continue;
    }
    if (v(i, 1) == null && v(i, 3) == null) { heads.push(cur); cur = { name: A, segs: [] }; continue; }
    if (v(i, 1) != null && isNum(v(i, 3))) seg.push(i);
  }
  heads.push(cur);
  if (pan < 0) throw new Error('Could not find the "Pan India" row.');

  const segSum = (s: Seg, c: number) => s.rows.reduce((t, i) => t + (isNum(v(i, c)) ? (v(i, c) as number) : 0), 0);
  const leaves: { zone: string; loc: string; seg: Seg }[] = [];
  const parentTotal = new Map<number, number[]>();   // zone summary total row → child total rows
  for (const h of heads) {
    const ss = h.segs;
    if (!ss.length) continue;
    const kids = ss.slice(1);
    if (ss.length > 1 && Math.abs(segSum(ss[0], 3) - kids.reduce((t, s) => t + segSum(s, 3), 0)) < 0.5
        && Math.abs(segSum(ss[0], 4) - kids.reduce((t, s) => t + segSum(s, 4), 0)) < 0.5) {
      kids.forEach((s) => leaves.push({ zone: h.name, loc: s.label, seg: s }));      // first block is the zone summary
      parentTotal.set(ss[0].total, kids.map((s) => s.total));
    } else {
      leaves.push({ zone: h.name, loc: ss[0].label, seg: ss[0] });
      kids.forEach((s) => leaves.push({ zone: s.label, loc: s.label, seg: s }));     // standalone zones without a header
    }
  }

  // Stakeholders: rows under the "Operation Stakeholders" heading; column D formula = sum of Total rows.
  const owner = new Map<number, string>();
  const stakeholders: string[] = [];
  for (let i = pan; i <= range.e.r; i++) {
    if (str(v(i, 2)) !== 'Operation Stakeholders') continue;
    for (let j = i + 1; j <= range.e.r; j++) {
      const name = str(v(j, 2));
      if (!name || name.toLowerCase() === 'total') break;
      stakeholders.push(name);
      for (const m of (f(j, 3) ?? '').matchAll(/\bD(\d+)\b/g)) {
        const t = Number(m[1]) - 1;
        for (const k of parentTotal.get(t) ?? [t]) owner.set(k, name);
      }
    }
    break;
  }
  if (!stakeholders.length) warnings.push('No "Operation Stakeholders" block found — stakeholder column left blank.');

  // Canonical client names: case-insensitive merge, most frequent spelling wins.
  const spell = new Map<string, Map<string, number>>();
  const bump = (s: string) => { const k = s.toLowerCase(); const m = spell.get(k) ?? new Map(); m.set(s, (m.get(s) ?? 0) + 1); spell.set(k, m); };
  leaves.forEach((l) => l.seg.rows.forEach((i) => { bump(str(v(i, 1))); if (v(i, 16) != null) bump(str(v(i, 16))); }));
  const canon = (s: string) => [...(spell.get(s.toLowerCase()) ?? new Map([[s, 1]])).entries()].sort((a, b) => b[1] - a[1])[0][0];

  const agg = new Map<string, TrackerRow>();
  for (const l of leaves) {
    for (const i of l.seg.rows) {
      const client = canon(str(v(i, 1)));
      const n = (c: number) => (isNum(v(i, c)) ? (v(i, c) as number) : 0);
      const added = isNum(v(i, 14)) ? (v(i, 14) as number) : null;
      const key = `${l.loc.toLowerCase()}|${client.toLowerCase()}`;
      const prev = agg.get(key);
      if (prev) {
        prev.target_cases += n(3); prev.mtd_cases += n(4); prev.revenue_target += n(5); prev.mtd_revenue += n(6);
        prev.reported_added = prev.reported_added == null && added == null ? null : (prev.reported_added ?? 0) + (added ?? 0);
        warnings.push(`Row ${i + 1}: ${client} at ${l.loc} appears twice — figures added together.`);
        continue;
      }
      agg.set(key, { zone: l.zone, region: regionOfZone[l.zone] ?? null, location: l.loc, client, stakeholder: owner.get(l.seg.total) ?? null,
        target_cases: n(3), mtd_cases: n(4), revenue_target: n(5), mtd_revenue: n(6), reported_added: added, source_row: i + 1 });
    }
  }
  const rows = [...agg.values()].filter((r) => r.target_cases || r.mtd_cases || r.revenue_target || r.mtd_revenue);
  const recon: Recon[] = ([['Target cases', 3, 'target_cases'], ['MTD cases', 4, 'mtd_cases'], ['Revenue target', 5, 'revenue_target'], ['MTD revenue', 6, 'mtd_revenue']] as const)
    .map(([measure, c, k]) => {
      const s = rows.reduce((t, r) => t + r[k], 0); const p = isNum(v(pan, c)) ? (v(pan, c) as number) : 0;
      return { measure, rows: Math.round(s * 100) / 100, pan_india: Math.round(p * 100) / 100, difference: Math.round((s - p) * 100) / 100 };
    });
  const noOwner = new Set(rows.filter((r) => !r.stakeholder).map((r) => r.zone));
  if (stakeholders.length && noOwner.size) warnings.push(`No stakeholder mapped for: ${[...noOwner].join(', ')}.`);
  return { as_of, rows, recon, warnings, stakeholders };
}
