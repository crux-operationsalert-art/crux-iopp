// Letters and salary slips as real PDF files, made on the phone (D-131, D-132). The PDF library loads only when needed.
export type Letterhead = { name: string; place?: string; address?: string; website?: string; cin?: string; signatory_name?: string; signatory_title?: string; letterhead?: string | null; signature?: string | null };
export type LetterDoc = { ref_no: string; title: string; body: string; person: string; designation?: string | null; address?: string | null; issued_at: string; status: string; needs_signature: boolean;
  signed_at?: string | null; signed_name?: string | null; signature?: string | null; body_hash?: string };
export type Slip = { person: string; designation?: string | null; department?: string | null; month: string; joining_date?: string | null; pan_last4?: string | null; uan_last4?: string | null;
  bank_name?: string | null; bank_account_last4?: string | null; paid_days?: number | null; days_in_month?: number | null;
  earnings: { label: string; amount: number }[]; deductions: { label: string; amount: number }[]; gross: number; deductions_total: number; net: number };

const M = 18, W = 210, H = 297;                                   // A4 in mm
const dt = (s: string) => new Date(s).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' });
const dtt = (s: string) => new Date(s).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const rs = (v: number) => 'Rs. ' + Math.round(Number(v) || 0).toLocaleString('en-IN');
const imgKind = (d: string) => (/^data:image\/jpe?g/i.test(d) ? 'JPEG' : 'PNG');
const imgSize = (d: string) => new Promise<{ w: number; h: number }>((res) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth || 1, h: i.naturalHeight || 1 }); i.onerror = () => res({ w: 4, h: 1 }); i.src = d; });
async function logoData(): Promise<string | null> {
  try { const b = await (await fetch(`${import.meta.env.BASE_URL}crux-logo.png`)).blob();
    return await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => res(null); r.readAsDataURL(b); }); } catch { return null; }
}

/** The company letterhead at the top of a page; returns where the text may start. */
async function head(doc: any, lh: Letterhead): Promise<number> {
  if (lh.letterhead) {
    const s = await imgSize(lh.letterhead); const h = Math.min(45, (W * s.h) / s.w);
    doc.addImage(lh.letterhead, imgKind(lh.letterhead), 0, 0, W, h); return h + 8;
  }
  const logo = await logoData(); let x = M;
  if (logo) { const s = await imgSize(logo); const h = 16, w = Math.min(50, (h * s.w) / s.h); doc.addImage(logo, 'PNG', M, 12, w, h); x = M + w + 6; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(20); doc.text(lh.name || 'Company', x, 19);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90);
  const sub = doc.splitTextToSize([lh.address || lh.place, lh.website].filter(Boolean).join('  |  '), W - x - M); doc.text(sub, x, 24.5);
  doc.setDrawColor(40); doc.setLineWidth(0.5); doc.line(M, 32, W - M, 32);
  return 42;
}
function foot(doc: any, lh: Letterhead, note: string) {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setDrawColor(190); doc.setLineWidth(0.2); doc.line(M, H - 16, W - M, H - 16);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(110);
    doc.text([lh.name, lh.cin ? `CIN ${lh.cin}` : '', lh.website].filter(Boolean).join('  |  '), M, H - 11.5);
    doc.text(`${note}  |  Page ${i} of ${n}`, W - M, H - 11.5, { align: 'right' });
  }
}

export async function letterPdf(l: LetterDoc, lh: Letterhead): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = await head(doc, lh);
  const room = (need: number) => { if (y + need > H - 22) { doc.addPage(); y = 22; } };
  doc.setTextColor(30); doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(`Ref: ${l.ref_no}`, M, y); doc.text(`Date: ${dt(l.issued_at)}`, W - M, y, { align: 'right' }); y += 9;
  doc.setFont('helvetica', 'bold'); doc.text(l.person, M, y); y += 5; doc.setFont('helvetica', 'normal');
  for (const ln of [l.designation, ...(l.address ? doc.splitTextToSize(l.address, 90) : [])].filter(Boolean)) { doc.text(String(ln), M, y); y += 5; }
  y += 5; doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5);
  const tt = doc.splitTextToSize(`Subject: ${l.title}`, W - 2 * M); doc.text(tt, M, y); y += tt.length * 5.5 + 3;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
  for (const para of l.body.split(/\n{2,}/)) {
    for (const raw of para.split('\n')) {
      const bullet = /^\s*[-•]\s+/.test(raw); const text = raw.replace(/^\s*[-•]\s+/, '');
      const lines = doc.splitTextToSize(text, W - 2 * M - (bullet ? 6 : 0));
      for (let i = 0; i < lines.length; i++) { room(5.4); if (bullet && i === 0) doc.text('•', M + 1.5, y); doc.text(lines[i], M + (bullet ? 6 : 0), y); y += 5.4; }
    }
    y += 3;
  }
  room(46); y += 4;
  doc.text(`For ${lh.name || 'the company'}`, M, y);
  if (lh.signature) { const s = await imgSize(lh.signature); const h = 16, w = Math.min(55, (h * s.w) / s.h); doc.addImage(lh.signature, imgKind(lh.signature), M, y + 2, w, h); }
  doc.setFont('helvetica', 'bold'); doc.text(lh.signatory_name || 'Authorised Signatory', M, y + 24);
  doc.setFont('helvetica', 'normal'); if (lh.signatory_name && lh.signatory_title) doc.text(lh.signatory_title, M, y + 29);
  const sx = W - M - 75;
  if (l.status === 'signed' && l.signed_at) {
    doc.text(l.needs_signature ? 'Read, understood and accepted' : 'Received and acknowledged', sx, y);
    if (l.signature) doc.addImage(l.signature, 'PNG', sx, y + 2, 60, 18);
    doc.setFont('helvetica', 'bold'); doc.text(l.signed_name || l.person, sx, y + 24);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90);
    doc.text(`Signed digitally in the CRUX app on ${dtt(l.signed_at)}`, sx, y + 29);
  } else if (l.status === 'issued' && l.needs_signature) {
    doc.setFontSize(9); doc.setTextColor(150); doc.text('Awaiting the employee\'s signature', sx, y + 12);
  }
  foot(doc, lh, l.status === 'signed' ? `${l.ref_no} | digitally signed | check ${String(l.body_hash ?? '').slice(0, 10)}` : `${l.ref_no} | ${l.status === 'issued' ? 'not yet signed' : l.status}`);
  return doc.output('blob');
}

export async function payslipPdf(s: Slip, lh: Letterhead): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = await head(doc, lh);
  const mon = new Date(s.month + 'T12:00:00+05:30').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  doc.setTextColor(20); doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(`Salary slip for ${mon}`, W / 2, y, { align: 'center' }); y += 9;
  doc.setFontSize(9.5);
  const info: [string, string][] = [['Employee', s.person], ['Designation', s.designation || '—'], ['Department', s.department || '—'],
    ['Date of joining', s.joining_date ? dt(s.joining_date + 'T12:00:00+05:30') : '—'], ['PAN', s.pan_last4 ? `XXXXXX${s.pan_last4}` : '—'], ['UAN', s.uan_last4 ? `XXXXXXXX${s.uan_last4}` : '—'],
    ['Bank', s.bank_name ? `${s.bank_name}${s.bank_account_last4 ? `, a/c XXXX${s.bank_account_last4}` : ''}` : '—'],
    ['Paid days', s.paid_days != null ? `${s.paid_days}${s.days_in_month ? ` of ${s.days_in_month}` : ''}` : '—']];
  const half = (W - 2 * M) / 2;
  info.forEach(([k, v], i) => { const x = M + (i % 2) * half, yy = y + Math.floor(i / 2) * 6;
    doc.setFont('helvetica', 'normal'); doc.setTextColor(100); doc.text(k, x, yy); doc.setTextColor(20); doc.setFont('helvetica', 'bold'); doc.text(String(v), x + 32, yy); });
  y += Math.ceil(info.length / 2) * 6 + 5;
  const colW = half - 3, rows = Math.max(s.earnings.length, s.deductions.length, 1), rowH = 6.5;
  const table = (x: number, title: string, items: { label: string; amount: number }[], total: number, totalLabel: string) => {
    doc.setFillColor(238, 238, 238); doc.rect(x, y, colW, 7.5, 'F'); doc.setFont('helvetica', 'bold'); doc.setTextColor(20); doc.setFontSize(9.5);
    doc.text(title, x + 2.5, y + 5.2); doc.text('Amount', x + colW - 2.5, y + 5.2, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    items.forEach((it, i) => { const yy = y + 7.5 + (i + 1) * rowH - 1.8; doc.text(it.label, x + 2.5, yy); doc.text(rs(it.amount), x + colW - 2.5, yy, { align: 'right' }); });
    const ty = y + 7.5 + rows * rowH; doc.setDrawColor(150); doc.setLineWidth(0.2); doc.line(x, ty + 1, x + colW, ty + 1);
    doc.setFont('helvetica', 'bold'); doc.text(totalLabel, x + 2.5, ty + 6); doc.text(rs(total), x + colW - 2.5, ty + 6, { align: 'right' });
    doc.setDrawColor(150); doc.rect(x, y, colW, 7.5 + rows * rowH + 8.5);
  };
  table(M, 'Earnings', s.earnings, s.gross, 'Gross earnings'); table(M + half + 3, 'Deductions', s.deductions, s.deductions_total, 'Total deductions');
  y += 7.5 + rows * rowH + 8.5 + 9;
  doc.setFillColor(238, 238, 238); doc.rect(M, y, W - 2 * M, 11, 'F'); doc.setFontSize(12); doc.text('Net pay', M + 3, y + 7.4); doc.text(rs(s.net), W - M - 3, y + 7.4, { align: 'right' });
  y += 18; doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(110);
  doc.text('This is a computer-generated salary slip and does not need a signature.', M, y);
  foot(doc, lh, `Salary slip | ${mon}`);
  return doc.output('blob');
}

/** Save a made file on this phone or computer. */
export function saveBlob(b: Blob, name: string) {
  const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}
