// Builds the Zonal Business Tracker (layout, colours and formulas of the Live Zonewise tracker) from the tool's own figures.
// One model drives both the on-screen table and the Excel download, so the two always agree.
import spec from './trackerStyle.json';

export type TRow = {
  zone: string; zone_order: number; zone_style: Partial<Record<'header' | 'leaf' | 'total' | 'rollup' | 'loc_total', string | null>> | null;
  region: string; tier: string; location: string; loc_order: number; client: string; client_order: number; rate: number; target: number;
  entry: number | null; closure: number | null; cancelled: number | null; mtd: number; prev_mtd: number; revenue: number;
  stakeholder: string | null; head: string | null;
};
export type PRow = { person: string; manager: string | null; is_me: boolean; location: string; client: string; zone: string; rate: number | null;
  entry: number; closure: number; cancelled: number; mtd: number; prev_mtd: number; revenue: number; reported_today: boolean };
export type HRow = { month: string; location: string; client: string; cases: number | null; revenue: number | null; billing: number | null };
export type TExport = { mode: 'full' | 'zm' | 'team' | 'self'; as_of: string; month: string; prev_as_of: string | null; source: string;
  wd_done: number; wd_total: number; me: string; roi_exclude: string; rows: TRow[]; history: HRow[]; people: PRow[];
  team_members: { person: string; manager: string | null }[] };

export type Cell = { v: number | string | null; f?: string };
export type MRow = { kind: string; fill?: string | null; bold?: boolean; height?: number; cells: Cell[]; helper?: { type?: string; who?: string } };
export type Sheet = { name: string; title: string; headers: string[]; rows: MRow[]; histMonths: string[]; widths: number[] };

// Columns: A Location · B Client · C Group · D Target · E Incoming · F Closure · G Cancelled · H Actual MTD · I Revenue Tgt · J Actual Revenue
//          K % Achmt · L Achieved (graph) · M Shortfall · N Daily count · O type (hidden) · P stakeholder (hidden) · Q.. history (cases, revenue, billing)
export const COL = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9, K: 10, L: 11, M: 12, N: 13, O: 14, P: 15 } as const;
const HIST0 = 16;
export const letter = (i: number): string => (i >= 26 ? letter(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monLabel = (iso: string) => `${MON[+iso.slice(5, 7) - 1]} ${iso.slice(2, 4)}`;
const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const n = (v: unknown) => Number(v ?? 0) || 0;
const DEF = { header: 'BDD7EE', leaf: 'CFE2F3', total: '9FC5E8', rollup: 'EAD1DC', loc_total: 'F4B083' };
const S = (spec as any).rows;
export const fills = { header: S.header.cells.A.fill, zone_ab: S.zone_ab.cells.A.fill, nsew: S.nsew.cells.A.fill, roi: S.roi.cells.A.fill,
  pan: S.pan.cells.A.fill, cw_total: S.cw_total.cells.D.fill, zone_header_first: S.zone_header_single.cells.A.fill };

function blank(len: number): Cell[] { return Array.from({ length: len }, () => ({ v: null })); }

/** Location tracker (Main Tracker) for full / zonal-manager downloads. */
export function mainSheet(x: TExport): Sheet {
  const months = [...new Set(x.history.map((h) => h.month))].sort().reverse().slice(0, 12);
  const width = HIST0 + months.length * 3;
  const hist = new Map(x.history.map((h) => [`${h.month}|${h.location}|${h.client}`, h]));
  const rows: MRow[] = [];
  const R = () => rows.length + 2;              // excel row number of the next row (row 1 = title)
  const app = x.source === 'app';
  const leafRanges: { first: number; last: number }[] = [];
  const locTotals: { row: number; tier: string; location: string }[] = [];

  const leaf = (r: TRow, fill: string): MRow => {
    const rn = R(); const c = blank(width);
    const rate = n(r.rate), mtd = n(r.mtd), rev = n(r.revenue);
    c[COL.A] = { v: r.location }; c[COL.B] = { v: r.client };
    c[COL.D] = { v: n(r.target) };
    c[COL.E] = { v: r.entry == null ? null : n(r.entry) }; c[COL.F] = { v: r.closure == null ? null : n(r.closure) }; c[COL.G] = { v: r.cancelled == null ? null : n(r.cancelled) };
    c[COL.H] = app ? { v: mtd, f: `E${rn}-G${rn}` } : { v: mtd };
    c[COL.I] = { v: n(r.target) * rate, f: `D${rn}*${rate}` };
    c[COL.J] = Math.abs(rev - mtd * rate) < 1 ? { v: mtd * rate, f: `H${rn}*${rate}` } : { v: rev };
    c[COL.N] = { v: mtd - n(r.prev_mtd), f: `H${rn}-${n(r.prev_mtd)}` };
    c[COL.O] = { v: 'leaf' }; c[COL.P] = { v: r.stakeholder ?? 'Unassigned' };
    months.forEach((m, i) => { const h = hist.get(`${m}|${r.location}|${r.client}`);
      c[HIST0 + i * 3] = { v: h?.cases == null ? 0 : n(h.cases) }; c[HIST0 + i * 3 + 1] = { v: h?.revenue == null ? 0 : n(h.revenue) };
      c[HIST0 + i * 3 + 2] = { v: h?.billing == null ? null : n(h.billing) }; });
    return derived({ kind: 'leaf', fill, cells: c }, rn);
  };
  // K, L, M from I/J of the same row
  const derived = (row: MRow, rn: number): MRow => {
    const c = row.cells, I = n(c[COL.I].v), J = n(c[COL.J].v);
    c[COL.K] = { v: I ? J / I : 0, f: `IFERROR(J${rn}/I${rn},0)` };
    c[COL.L] = { v: '█'.repeat(Math.max(0, Math.floor((I ? J / I : 0) * 20))), f: `REPT("█",K${rn}*20)` };
    c[COL.M] = { v: J - I, f: `IFERROR(J${rn}-I${rn},0)` };
    return row;
  };
  const SUMCOLS = [COL.D, COL.E, COL.F, COL.G, COL.H, COL.I, COL.J, COL.N, ...months.flatMap((_, i) => [HIST0 + i * 3, HIST0 + i * 3 + 1, HIST0 + i * 3 + 2])];
  const sumRow = (kind: string, fill: string, a: string, b: string, cc: string, first: number, last: number, bold = true): MRow => {
    const rn = R(); const c = blank(width);
    c[COL.A] = { v: a }; c[COL.B] = { v: b }; c[COL.C] = { v: cc };
    for (const k of SUMCOLS) { const L = letter(k); let s = 0; for (let i = first; i <= last; i++) s += n(rows[i - 2]?.cells[k]?.v);
      c[k] = { v: s, f: `SUM(${L}${first}:${L}${last})` }; }
    return derived({ kind, fill, bold, cells: c }, rn);
  };
  const explicit = (kind: string, fill: string, a: string, cc: string, refs: number[], minus: number[] = []): MRow => {
    const rn = R(); const c = blank(width); c[COL.A] = { v: a }; c[COL.C] = { v: cc };
    for (const k of SUMCOLS) { const L = letter(k);
      const v = refs.reduce((s, r) => s + n(rows[r - 2].cells[k].v), 0) - minus.reduce((s, r) => s + n(rows[r - 2].cells[k].v), 0);
      const f = [...refs.map((r) => `${L}${r}`), ...minus.map((r) => `-${L}${r}`)].join('+').replace(/\+-/g, '-');
      c[k] = { v, f: f || '0' }; }
    return derived({ kind, fill, bold: true, cells: c }, rn);
  };

  const byZone = new Map<string, TRow[]>();
  [...x.rows].sort((a, b) => a.zone_order - b.zone_order || a.zone.localeCompare(b.zone) || a.loc_order - b.loc_order || a.location.localeCompare(b.location)
    || a.client_order - b.client_order || a.client.localeCompare(b.client)).forEach((r) => byZone.set(r.zone, [...(byZone.get(r.zone) ?? []), r]));
  rows.push({ kind: 'header', fill: fills.header, bold: true, height: 39.75, cells: [] });   // filled below
  const zoneTotals: { row: number; region: string }[] = [];
  let firstZone = true;
  for (const [zone, zr] of byZone) {
    const st = { ...DEF, ...(zr[0].zone_style ?? {}) };
    const locs = [...new Set(zr.map((r) => r.location))];
    const region = zr[0].region;
    if (st.header !== null) { const c = blank(width); c[COL.A] = { v: zone };
      rows.push({ kind: 'zone_header', fill: firstZone && zr[0].zone_style?.header ? st.header : (st.header ?? DEF.header), bold: true, cells: c }); }
    firstZone = false;
    if (locs.length === 1) {
      const first = R(); zr.forEach((r) => rows.push(leaf(r, st.leaf!))); const last = R() - 1;
      leafRanges.push({ first, last });
      const t = sumRow('zone_total', st.total!, `Total ${locs[0]}`, zr[0].tier, `${region} Client`, first, last);
      rows.push(t); zoneTotals.push({ row: R() - 1, region }); locTotals.push({ row: R() - 1, tier: zr[0].tier, location: locs[0] });
    } else {
      const clients = [...new Map(zr.map((r) => [r.client, r.client_order])).entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map((e) => e[0]);
      const rollFirst = R(); const blockFirst = rollFirst + clients.length + 1; const blockLast = blockFirst + zr.length + locs.length - 1;
      clients.forEach((cl) => {
        const rn = R(); const c = blank(width); c[COL.A] = { v: zone }; c[COL.B] = { v: cl };
        for (const k of SUMCOLS) { const L = letter(k); const v = zr.filter((r) => r.client === cl).reduce((s, r) => s + n(leaf(r, '').cells[k].v), 0);
          c[k] = { v, f: `SUMIFS(${L}$${blockFirst}:${L}$${blockLast},$B$${blockFirst}:$B$${blockLast},$B${rn},$O$${blockFirst}:$O$${blockLast},"leaf")` }; }
        rows.push(derived({ kind: 'rollup', fill: st.rollup!, cells: c }, rn));
      });
      const tiers = [...new Set(zr.map((r) => r.tier))];
      rows.push(sumRow('zone_total', st.total!, `Total ${zone}`, tiers.length === 1 ? tiers[0] : 'Zone A & B', `${region} Client`, rollFirst, R() - 1));
      zoneTotals.push({ row: R() - 1, region });
      for (const loc of locs) {
        const lr = zr.filter((r) => r.location === loc);
        const first = R(); lr.forEach((r) => rows.push(leaf(r, st.leaf!))); const last = R() - 1;
        leafRanges.push({ first, last });
        rows.push(sumRow('loc_total', st.loc_total!, `Total ${loc}`, lr[0].tier, 'Client Total', first, last));
        locTotals.push({ row: R() - 1, tier: lr[0].tier, location: loc });
      }
    }
  }
  const lastData = R() - 1;
  // Zone A / Zone B (by each location's tier), North / South / East / West, ROI, Pan India
  const tierRows = (t: string) => locTotals.filter((l) => l.tier === t).map((l) => l.row);
  if (tierRows('Zone A').length) rows.push(explicit('zone_ab', fills.zone_ab, 'Zone A', '', tierRows('Zone A')));
  if (tierRows('Zone B').length) rows.push(explicit('zone_ab', fills.zone_ab, 'Zone B', '', tierRows('Zone B')));
  const regions = ['North', 'South', 'East', 'West', ...new Set(zoneTotals.map((z) => z.region).filter((r) => !['North', 'South', 'East', 'West'].includes(r)))]
    .filter((r) => zoneTotals.some((z) => z.region === r));
  const regionRows: number[] = [];
  for (const reg of regions) {
    const rn = R(); const c = blank(width); c[COL.A] = { v: `${reg} Zone` }; c[COL.C] = { v: `${reg} Client` };
    for (const k of SUMCOLS) { const L = letter(k); const v = zoneTotals.filter((z) => z.region === reg).reduce((s, z) => s + n(rows[z.row - 2].cells[k].v), 0);
      c[k] = { v, f: `SUMIF($C$3:$C$${lastData},$C${rn},${L}$3:${L}$${lastData})` }; }
    c[COL.B] = { v: null };
    rows.push(derived({ kind: 'nsew', fill: fills.nsew, bold: true, cells: c }, rn)); regionRows.push(rn);
  }
  const panRow = R() + (x.mode === 'full' && locTotals.some((l) => l.location === x.roi_exclude) ? 1 : 0);
  const ex = locTotals.find((l) => l.location === x.roi_exclude);
  if (x.mode === 'full' && ex) {
    const rn = R(); const c = blank(width); c[COL.A] = { v: 'ROI' }; c[COL.C] = { v: `Pan India less ${x.roi_exclude}` };
    rows.push({ kind: 'roi', fill: fills.roi, bold: true, cells: c });   // values filled after Pan India
    void rn;
  }
  rows.push(explicit('pan', fills.pan, x.mode === 'full' ? 'Pan India' : 'Total (my locations)', x.mode === 'full' ? 'Pan Client' : '', regionRows));
  if (x.mode === 'full' && ex) {
    const rr = rows[rows.length - 2], rn = panRow - 1;
    for (const k of SUMCOLS) { const L = letter(k); rr.cells[k] = { v: n(rows[panRow - 2].cells[k].v) - n(rows[ex.row - 2].cells[k].v), f: `${L}${panRow}-${L}${ex.row}` }; }
    derived(rr, rn);
  }
  // Client-wise block and Operation stakeholders block (leaf rows only, so roll-ups are never double counted)
  rows.push({ kind: 'blank', cells: blank(width) });
  const cwTitle = blank(width); cwTitle[COL.D] = { v: `Client Wise Business Count Of ${monLabel(x.month)}` }; rows.push({ kind: 'cw_title', cells: cwTitle });
  rows.push({ kind: 'cw_header', fill: fills.header, bold: true, height: 42, cells: [] });
  const cwFirst = R();
  const clientsAll = [...new Map(x.rows.map((r) => [r.client, r.client_order])).entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map((e) => e[0]);
  const blockSum = (k: number, crit: (r: TRow) => boolean) => x.rows.filter(crit).reduce((s, r) => s + n(leaf(r, '').cells[k].v), 0);
  for (const cl of clientsAll) {
    const rn = R(); const c = blank(width); c[COL.C] = { v: cl };
    for (const k of SUMCOLS) { const L = letter(k);
      c[k] = { v: blockSum(k, (r) => r.client === cl), f: `SUMIFS(${L}$3:${L}$${lastData},$B$3:$B$${lastData},$C${rn},$O$3:$O$${lastData},"leaf")` }; }
    rows.push(derived({ kind: 'cw_row', cells: c }, rn));
  }
  rows.push(sumRow('cw_total', fills.cw_total, '', '', 'Total', cwFirst, R() - 1));
  rows.push({ kind: 'blank', cells: blank(width) });
  const shTitle = blank(width); shTitle[COL.C] = { v: 'Operation Stakeholders' }; rows.push({ kind: 'sh_title', cells: shTitle });
  rows.push({ kind: 'sh_header', fill: fills.header, bold: true, height: 40.5, cells: [] });
  const shFirst = R();
  for (const who of [...new Set(x.rows.map((r) => r.stakeholder ?? 'Unassigned'))].sort()) {
    const rn = R(); const c = blank(width); c[COL.C] = { v: who };
    for (const k of SUMCOLS) { const L = letter(k);
      c[k] = { v: blockSum(k, (r) => (r.stakeholder ?? 'Unassigned') === who), f: `SUMIFS(${L}$3:${L}$${lastData},$P$3:$P$${lastData},$C${rn},$O$3:$O$${lastData},"leaf")` }; }
    rows.push(derived({ kind: 'sh_row', cells: c }, rn));
  }
  rows.push(sumRow('sh_total', fills.cw_total, '', '', 'Total', shFirst, R() - 1));

  const headers = headerCells(x, months, width, 'Location');
  for (const r of rows) if (['header', 'cw_header', 'sh_header'].includes(r.kind)) r.cells = headers.map((h, i) => ({
    v: r.kind !== 'header' && i === COL.C ? (r.kind === 'cw_header' ? 'Client' : 'Operation Stakeholder') : r.kind === 'header' || i > COL.C ? (i >= COL.O && i < HIST0 ? '' : h) : null }));
  return { name: 'Main Tracker', title: ` Zonal Business Tracker Report — as on ${dmy(x.as_of)}`, headers, rows, histMonths: months, widths: widths(months.length) };
}

function headerCells(x: TExport, months: string[], width: number, first: string): string[] {
  const h: string[] = Array(width).fill('');
  Object.assign(h, [first, 'Client', '', `Target \n${monLabel(x.month)}`, 'Incoming \nMTD', 'Closure \nMTD', 'Cancelled \nMTD', 'Actual \nMTD',
    `Revenue Tgt \n${monLabel(x.month)}`, 'Actual\nRevenue', '% Achmt Against \nAllocated Tgt', 'ACHIEVED \n(In Graph)', 'Shortfall', `Daily Count\n${dmy(x.as_of)}`, 'Type', 'Stakeholder']);
  months.forEach((m, i) => { h[HIST0 + i * 3] = `Actual \nMTD ${monLabel(m)}`; h[HIST0 + i * 3 + 1] = `Actual\nRevenue ${monLabel(m)}`; h[HIST0 + i * 3 + 2] = `Actual Billing Amount ${monLabel(m)}`; });
  return h;
}
function widths(hm: number): number[] {
  const w = (spec as any).widths;
  return [w.A ?? 41, w.B ?? 15, w.C ?? 26, w.D ?? 13, 11, 11, 11, w.E ?? 11, w.F ?? 13, w.G ?? 13, w.H ?? 22, w.I ?? 40, w.K ?? 22, w.O ?? 17, 6, 18,
    ...Array.from({ length: hm * 3 }, (_, i) => (i % 3 === 2 ? 15 : i % 3 === 1 ? 13 : 10))];
}

/** Team (Branch Manager / BA) or own (executive) sheet: people instead of locations. */
export function peopleSheet(x: TExport, own: boolean): Sheet {
  const ppl = own ? x.people.filter((p) => p.is_me) : x.people;
  const width = HIST0; const rows: MRow[] = [];
  const R = () => rows.length + 2;
  rows.push({ kind: 'header', fill: fills.header, bold: true, height: 39.75, cells: [] });
  const totals: number[] = [];
  const SUMC = [COL.E, COL.F, COL.G, COL.H, COL.J, COL.N];
  const byPerson = new Map<string, PRow[]>(); ppl.forEach((p) => byPerson.set(p.person, [...(byPerson.get(p.person) ?? []), p]));
  const names = [...new Set([...byPerson.keys(), ...(own ? [] : x.team_members.map((t) => t.person))])].sort();
  for (const person of names) {
    const pr = byPerson.get(person) ?? [];
    const hc = blank(width); hc[COL.A] = { v: person }; hc[COL.B] = { v: (x.team_members.find((t) => t.person === person)?.manager ?? pr[0]?.manager) ? `Reports to ${x.team_members.find((t) => t.person === person)?.manager ?? pr[0]?.manager}` : '' };
    rows.push({ kind: 'zone_header', fill: DEF.header, bold: true, cells: hc });
    const first = R();
    for (const p of pr) {
      const rn = R(); const c = blank(width); const rate = n(p.rate);
      c[COL.A] = { v: p.location }; c[COL.B] = { v: p.client }; c[COL.C] = { v: p.reported_today ? 'Reported today' : 'Not reported today' };
      c[COL.E] = { v: n(p.entry) }; c[COL.F] = { v: n(p.closure) }; c[COL.G] = { v: n(p.cancelled) };
      c[COL.H] = { v: n(p.mtd), f: `E${rn}-G${rn}` };
      c[COL.J] = Math.abs(n(p.revenue) - n(p.mtd) * rate) < 1 ? { v: n(p.mtd) * rate, f: `H${rn}*${rate}` } : { v: n(p.revenue) };
      c[COL.N] = { v: n(p.mtd) - n(p.prev_mtd), f: `H${rn}-${n(p.prev_mtd)}` }; c[COL.O] = { v: 'leaf' }; c[COL.P] = { v: person };
      rows.push({ kind: 'leaf', fill: DEF.leaf, cells: c });
    }
    if (!pr.length) { const c = blank(width); c[COL.A] = { v: 'No figures entered this month' }; rows.push({ kind: 'leaf', fill: 'FFF2CC', cells: c }); }
    const last = R() - 1; const rn = R(); const c = blank(width);
    c[COL.A] = { v: `Total ${person}` }; c[COL.B] = { v: 'Client Total' };
    for (const k of SUMC) { const L = letter(k); let s = 0; for (let i = first; i <= last; i++) s += n(rows[i - 2].cells[k].v); c[k] = { v: s, f: `SUM(${L}${first}:${L}${last})` }; }
    rows.push({ kind: 'loc_total', fill: DEF.loc_total, bold: true, cells: c }); totals.push(rn);
  }
  if (!own) {
    const c = blank(width); c[COL.A] = { v: 'Team total' };
    for (const k of SUMC) { const L = letter(k); c[k] = { v: totals.reduce((s, r) => s + n(rows[r - 2].cells[k].v), 0), f: totals.map((r) => `${L}${r}`).join('+') || '0' }; }
    rows.push({ kind: 'pan', fill: fills.pan, bold: true, cells: c });
  }
  const headers = headerCells(x, [], width, own ? 'Location' : 'Person / Location');
  headers[COL.C] = 'Today'; headers[COL.D] = ''; headers[COL.I] = ''; headers[COL.K] = ''; headers[COL.L] = ''; headers[COL.M] = '';
  rows[0].cells = headers.map((h) => ({ v: h }));
  return { name: own ? 'My Performance' : 'My Team', title: `${own ? 'My performance' : 'My team'} — ${x.me} — as on ${dmy(x.as_of)}`, headers, rows, histMonths: [], widths: widths(0) };
}

export function sheetsFor(x: TExport): Sheet[] {
  if (x.mode === 'full' || x.mode === 'zm') return [mainSheet(x)];
  if (x.mode === 'team') return [peopleSheet(x, false), peopleSheet(x, true)];
  return [peopleSheet(x, true)];
}

const styleOf = (kind: string) => S[{ leaf: 'leaf', rollup: 'zone_client', zone_header: 'zone_header', zone_total: 'zone_total', loc_total: 'loc_total', zone_ab: 'zone_ab',
  nsew: 'nsew', roi: 'roi', pan: 'pan', header: 'header', cw_title: 'cw_title', cw_header: 'cw_header', cw_row: 'cw_row', cw_total: 'cw_total',
  sh_title: 'sh_title', sh_header: 'sh_header', sh_row: 'sh_row', sh_total: 'sh_total', blank: 'cw_title' }[kind] ?? 'leaf'];

/** Excel file with the tracker's colours. withFormulas=false gives a values-only copy for sharing. */
export async function buildWorkbook(x: TExport, withFormulas: boolean): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook(); wb.creator = 'CRUX IOPP';
  for (const sh of sheetsFor(x)) {
    const ws = wb.addWorksheet(sh.name, { views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }] });
    sh.widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.getColumn(COL.O + 1).hidden = true; ws.getColumn(COL.P + 1).hidden = true;
    const t = ws.getCell('A1'); t.value = sh.title; t.font = { bold: true, size: 14 }; ws.getRow(1).height = 21.75;
    sh.histMonths.forEach((m, i) => { const c = ws.getCell(1, HIST0 + i * 3 + 1); c.value = monLabel(m); c.font = { bold: true }; });
    if (sh.name === 'Main Tracker') { const c = ws.getCell(1, COL.N + 1); c.value = 'Daily Counts'; c.font = { bold: true }; c.fill = solid('CFE2F3'); }
    sh.rows.forEach((r, i) => {
      const row = ws.getRow(i + 2); const st = styleOf(r.kind);
      if (r.height) row.height = r.height;
      const len = Math.max(r.cells.length, sh.headers.length);
      for (let k = 0; k < len; k++) {
        const cell = row.getCell(k + 1); const m = r.cells[k] ?? { v: null };
        cell.value = withFormulas && m.f ? { formula: m.f, result: m.v as any } : (m.v as any);
        const base = st?.cells?.[letter(Math.min(k, 20))] ?? st?.cells?.A;
        const fill = r.kind === 'cw_header' || r.kind === 'sh_header' ? (k > COL.B ? r.fill : null) : r.fill;
        if (fill && k < (sh.name === 'Main Tracker' ? COL.O : COL.O) ) cell.fill = solid(fill);
        else if (fill && k >= HIST0) cell.fill = solid(fill);
        cell.font = { bold: r.bold ?? base?.font?.b ?? false, size: base?.font?.sz ?? 10, name: base?.font?.name ?? 'Arial',
          color: k === COL.L ? { argb: 'FF00B050' } : undefined };
        if (k === COL.K) cell.numFmt = '0%';
        else if (typeof m.v === 'number') cell.numFmt = '#,##0';
        cell.alignment = { vertical: 'middle', horizontal: k <= COL.C ? 'left' : 'center', wrapText: ['header', 'cw_header', 'sh_header'].includes(r.kind) };
        if (r.kind !== 'blank' && r.kind !== 'cw_title' && r.kind !== 'sh_title' && (r.cells[k]?.v != null || fill)) cell.border = thin;
      }
    });
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
export async function downloadExcel(x: TExport, withFormulas: boolean) {
  const buf = await buildWorkbook(x, withFormulas);
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a'); a.href = url;
  a.download = `Zonal_Tracker_${x.mode === 'full' ? '' : x.me.replace(/\W+/g, '_') + '_'}${x.as_of}${withFormulas ? '' : '_values'}.xlsx`;
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const solid = (hex: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF' + hex } });
const side = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } };
const thin = { top: side, left: side, bottom: side, right: side };
