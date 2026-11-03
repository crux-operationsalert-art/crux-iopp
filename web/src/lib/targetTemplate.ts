// Prefilled targets template (option 3): people × clients with the rate; revenue is a formula (cases × rate).
import { read, utils } from 'xlsx';

export type TplRow = { person_id: string; person: string; branch_id: string; client_id: string; location: string; client: string; zone: string | null;
  rate: number | null; cases: number | null; revenue: number | null; collection: number | null; last_cases: number | null; last_revenue: number | null };
export type TplPerson = { person_id: string; person: string; designation: string | null; manager: string | null; style: 'client' | 'total' | null;
  revenue: number | null; collection: number | null; cases: number | null };
export type Tpl = { month: string; locked: boolean; lock_at: string; people: TplPerson[]; rows: TplRow[] };

const CW = ['Person', 'Zone', 'Location', 'Client', 'Rate ₹ / case', 'Last month cases', 'Last month revenue ₹', 'Target cases', 'Target revenue ₹ (auto)', 'Collection target ₹', 'person_id', 'branch_id', 'client_id'];
const TT = ['Person', 'Designation', 'Reports to', 'Revenue target ₹', 'Collection target ₹', 'person_id'];

export async function downloadTemplate(t: Tpl) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const head = (ws: any, cols: string[], widths: number[]) => {
    ws.addRow(cols); ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
    widths.forEach((w, i) => (ws.getColumn(i + 1).width = w)); ws.views = [{ state: 'frozen', ySplit: 1 }];
  };
  const input = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } } as const;
  const inr = '#,##,##0';

  const a = wb.addWorksheet('Client-wise');
  head(a, CW, [24, 16, 18, 22, 12, 12, 16, 12, 18, 18, 6, 6, 6]);
  t.rows.forEach((r, i) => {
    const n = i + 2;
    a.addRow([r.person, r.zone ?? '', r.location, r.client, r.rate ?? null, r.last_cases ?? null, r.last_revenue ?? null, r.cases ?? null,
      { formula: `IF(H${n}="","",H${n}*E${n})` }, r.collection ?? null, r.person_id, r.branch_id, r.client_id]);
    a.getCell(`H${n}`).fill = input; a.getCell(`J${n}`).fill = input;
    ['E', 'G', 'I', 'J'].forEach((c) => (a.getCell(`${c}${n}`).numFmt = inr));
    if (r.rate == null) a.getCell(`E${n}`).note = 'No rate on file: revenue cannot be worked out for this client · location.';
  });
  const last = t.rows.length + 1, tot = last + 1;
  a.addRow(['TOTAL', '', '', '', '', { formula: `SUM(F2:F${last})` }, { formula: `SUM(G2:G${last})` }, { formula: `SUM(H2:H${last})` },
    { formula: `SUM(I2:I${last})` }, { formula: `SUM(J2:J${last})` }]);
  a.getRow(tot).font = { bold: true }; ['G', 'I', 'J'].forEach((c) => (a.getCell(`${c}${tot}`).numFmt = inr));
  ['K', 'L', 'M'].forEach((c) => (a.getColumn(c).hidden = true));
  a.autoFilter = { from: 'A1', to: `J${last}` };

  const b = wb.addWorksheet('Monthly totals');
  head(b, TT, [24, 22, 22, 18, 18, 6]);
  t.people.forEach((p, i) => {
    const n = i + 2;
    b.addRow([p.person, p.designation ?? '', p.manager ?? '', p.style === 'total' ? p.revenue : null, p.style === 'total' ? p.collection : null, p.person_id]);
    b.getCell(`D${n}`).fill = input; b.getCell(`E${n}`).fill = input; b.getCell(`D${n}`).numFmt = inr; b.getCell(`E${n}`).numFmt = inr;
  });
  b.getColumn('F').hidden = true;

  const h = wb.addWorksheet('How to fill');
  h.getColumn(1).width = 110;
  [`Targets for ${new Date(t.month + 'T12:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`, '',
    'Fill ONE of the two sheets for each person (yellow cells only):',
    '  • Client-wise — target cases and collection per client · location. Revenue is worked out from the rate; do not type it.',
    '  • Monthly totals — only the revenue and collection expected for the month; the person decides the client mix.',
    'Leave a cell blank to keep what is already set. Enter 0 to set a zero target.',
    'Do not change the hidden id columns, add people or rename sheets. Upload the file in Targets → Bulk upload, check the preview, then Apply.',
    `Target setting closes ${new Date(t.lock_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} (end of the 5th working day).`,
  ].forEach((l, i) => { h.addRow([l]); if (i === 0) h.getRow(1).font = { bold: true, size: 14 }; });

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const el = document.createElement('a'); el.href = url; el.download = `CRUX_targets_${t.month.slice(0, 7)}.xlsx`; el.click(); URL.revokeObjectURL(url);
}

const cell = (v: unknown) => (v === undefined || v === null || String(v).trim() === '' ? null : Number(String(v).replace(/[₹,\s]/g, '')));

/** Reads a filled template back into save_targets rows (blank cells are left out). */
export async function readTemplate(file: File): Promise<{ rows: Record<string, unknown>[]; problems: string[] }> {
  const wb = read(await file.arrayBuffer());
  const rows: Record<string, unknown>[] = []; const problems: string[] = [];
  const grid = (name: string) => (wb.Sheets[name] ? utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: null }) : null);
  const a = grid('Client-wise'), b = grid('Monthly totals');
  if (!a && !b) return { rows, problems: ['This is not the targets template (sheets “Client-wise” / “Monthly totals” not found).'] };
  const idx = (hdr: unknown[], name: string) => hdr.findIndex((h) => String(h ?? '').trim() === name);
  if (a) {
    const hd = a[0] ?? []; const [p, br, cl, cs, co] = ['person_id', 'branch_id', 'client_id', 'Target cases', 'Collection target ₹'].map((x) => idx(hd, x));
    if ([p, br, cl, cs, co].some((x) => x < 0)) problems.push('Client-wise sheet: the header row was changed.');
    else a.slice(1).forEach((r, i) => {
      if (!r[p]) return;
      const cases = cell(r[cs]), col = cell(r[co]);
      if ((cases != null && Number.isNaN(cases)) || (col != null && Number.isNaN(col))) { problems.push(`Client-wise row ${i + 2}: not a number.`); return; }
      if (cases == null && col == null) return;
      rows.push({ person_id: r[p], branch_id: r[br], client_id: r[cl], cases, collection: col, _sheet: 'Client-wise', _row: i + 2 });
    });
  }
  if (b) {
    const hd = b[0] ?? []; const [p, rv, co] = ['person_id', 'Revenue target ₹', 'Collection target ₹'].map((x) => idx(hd, x));
    if ([p, rv, co].some((x) => x < 0)) problems.push('Monthly totals sheet: the header row was changed.');
    else b.slice(1).forEach((r, i) => {
      if (!r[p]) return;
      const rev = cell(r[rv]), col = cell(r[co]);
      if ((rev != null && Number.isNaN(rev)) || (col != null && Number.isNaN(col))) { problems.push(`Monthly totals row ${i + 2}: not a number.`); return; }
      if (rev == null && col == null) return;
      rows.push({ person_id: r[p], revenue: rev, collection: col, _sheet: 'Monthly totals', _row: i + 2 });
    });
  }
  return { rows, problems };
}
