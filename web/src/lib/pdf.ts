// Letters and salary slips as real PDF files, made on the device (D-131, D-132; layout D-134). The PDF library loads only when needed.
import { parseLetter } from './letterFormat';

export type Letterhead = { name: string; place?: string; address?: string; website?: string; cin?: string; signatory_name?: string; signatory_title?: string;
  letterhead?: string | null; signature?: string | null; seal?: string | null };
export type LetterDoc = { ref_no: string; title: string; body: string; person: string; designation?: string | null; address?: string | null; issued_at: string; status: string; needs_signature: boolean;
  signed_at?: string | null; signed_name?: string | null; signature?: string | null; body_hash?: string };
export type Slip = { person: string; designation?: string | null; department?: string | null; month: string; joining_date?: string | null; pan_last4?: string | null; uan_last4?: string | null;
  bank_name?: string | null; bank_account_last4?: string | null; paid_days?: number | null; days_in_month?: number | null;
  earnings: { label: string; amount: number }[]; deductions: { label: string; amount: number }[]; gross: number; deductions_total: number; net: number };

const M = 22, W = 210, H = 297, CW = W - 2 * M, BOTTOM = H - 30;      // A4 in mm; text stops above the footer
const NAVY: [number, number, number] = [11, 31, 77], INK: [number, number, number] = [28, 30, 36], GREY: [number, number, number] = [105, 110, 122], RULE: [number, number, number] = [200, 205, 215];
const dt = (s: string) => new Date(s).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' });
const dtt = (s: string) => new Date(s).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' IST';
const rs = (v: number) => 'Rs. ' + Math.round(Number(v) || 0).toLocaleString('en-IN');
const clean = (s: string) => s.replace(/₹/g, 'Rs. ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/…/g, '...').replace(/·/g, '-');   // the built-in PDF fonts are Latin-1
const imgKind = (d: string) => (/^data:image\/jpe?g/i.test(d) ? 'JPEG' : 'PNG');
const imgSize = (d: string) => new Promise<{ w: number; h: number }>((res) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth || 1, h: i.naturalHeight || 1 }); i.onerror = () => res({ w: 4, h: 1 }); i.src = d; });
async function logoData(): Promise<string | null> {
  try { const b = await (await fetch(`${import.meta.env.BASE_URL}crux-logo.png`)).blob();
    return await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => res(null); r.readAsDataURL(b); }); } catch { return null; }
}
const fit = async (d: string, maxW: number, maxH: number) => { const s = await imgSize(d); const k = Math.min(maxW / s.w, maxH / s.h); return { w: s.w * k, h: s.h * k }; };

/** First-page letterhead: the uploaded strip, else the logo centred over a brand rule. Returns where text may start. */
async function head(doc: any, lh: Letterhead): Promise<number> {
  if (lh.letterhead) { const s = await imgSize(lh.letterhead); const h = Math.min(48, (W * s.h) / s.w); doc.addImage(lh.letterhead, imgKind(lh.letterhead), 0, 0, W, h); return h + 9; }
  const logo = await logoData();
  if (logo) { const z = await fit(logo, 62, 19); doc.addImage(logo, 'PNG', (W - z.w) / 2, 11, z.w, z.h); }
  else { doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...NAVY); doc.text(clean(lh.name || ''), W / 2, 22, { align: 'center' }); }
  doc.setDrawColor(...NAVY); doc.setLineWidth(0.7); doc.line(M, 35, W - M, 35);
  doc.setDrawColor(...RULE); doc.setLineWidth(0.2); doc.line(M, 36.2, W - M, 36.2);
  return 46;
}
/** Footer on every page (company, CIN, registered office) and a slim header on continuation pages. */
function chrome(doc: any, lh: Letterhead, ref: string, note: string) {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    if (i > 1) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GREY); doc.text(clean(lh.name || ''), M, 13); doc.text(clean(ref), W - M, 13, { align: 'right' });
      doc.setDrawColor(...RULE); doc.setLineWidth(0.2); doc.line(M, 15.5, W - M, 15.5); }
    doc.setDrawColor(...NAVY); doc.setLineWidth(0.4); doc.line(M, H - 23, W - M, H - 23);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...NAVY); doc.text(clean(lh.name || ''), W / 2, H - 18, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GREY);
    const l2 = [lh.cin ? `CIN: ${lh.cin}` : '', lh.address || lh.place || '', lh.website || ''].filter(Boolean).join('   |   ');
    doc.text(doc.splitTextToSize(clean(l2), CW), W / 2, H - 14, { align: 'center' });
    doc.setFontSize(7); doc.text(clean(note), M, H - 6.5); doc.text(`Page ${i} of ${n}`, W - M, H - 6.5, { align: 'right' });
  }
}

export async function letterPdf(l: LetterDoc, lh: Letterhead): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = await head(doc, lh); const LH = 5.5;
  const newPage = () => { doc.addPage(); y = 24; };
  const room = (need: number) => { if (y + need > BOTTOM) newPage(); };
  const body = () => { doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...INK); };
  /** Wrapped, justified text at x with the given width; flows over pages. */
  const flow = (text: string, x: number, width: number, justify = true) => {
    for (const part of clean(text).split('\n')) {
      const lines: string[] = doc.splitTextToSize(part, width);
      lines.forEach((ln, i) => { room(LH); const last = i === lines.length - 1;
        if (justify && !last && ln.trim().includes(' ')) doc.text(ln, x, y, { align: 'justify', maxWidth: width }); else doc.text(ln, x, y);
        y += LH; });
    }
  };

  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...NAVY); doc.text('PRIVATE AND CONFIDENTIAL', M, y, { charSpace: 0.6 });
  body(); doc.text(dt(l.issued_at), W - M, y, { align: 'right' }); y += 6;
  doc.setFontSize(9); doc.setTextColor(...GREY); doc.text(`Ref: ${l.ref_no}`, M, y); y += 9;
  body(); doc.text('To,', M, y); y += LH;
  doc.setFont('helvetica', 'bold'); doc.text(clean(l.person), M, y); y += LH; body();
  for (const ln of [l.designation, ...(l.address ? doc.splitTextToSize(clean(l.address), 95) : [])].filter(Boolean)) { doc.text(clean(String(ln)), M, y); y += LH; }
  y += 4; doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...NAVY);
  const tt: string[] = doc.splitTextToSize(clean(`Subject: ${l.title}`), CW); doc.text(tt, M, y); y += tt.length * 5.6 + 3; body();

  // signatures: the Company on the left, the seal in the middle when uploaded, the person on the right.
  // They close the letter itself, so they come before any annexure.
  let signed = false;
  const signatures = async () => {
    signed = true;
    room(58); y += 6; const top = y, rx = W - M - 72;
    doc.setFontSize(9.5); doc.setTextColor(...GREY); doc.text('For and on behalf of', M, y); y += 4.8;
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...INK); doc.setFontSize(10.5); doc.text(doc.splitTextToSize(clean(lh.name || 'the Company'), 78), M, y);
    if (lh.signature) { const z = await fit(lh.signature, 50, 17); doc.addImage(lh.signature, imgKind(lh.signature), M, top + 12, z.w, z.h); }
    if (lh.seal) { const z = await fit(lh.seal, 26, 26); doc.addImage(lh.seal, imgKind(lh.seal), M + 62, top + 6, z.w, z.h); }
    doc.setDrawColor(...RULE); doc.setLineWidth(0.2); doc.line(M, top + 31, M + 58, top + 31);
    doc.setFont('helvetica', 'bold'); doc.text(clean(lh.signatory_name || 'Authorised Signatory'), M, top + 36);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...GREY); if (lh.signatory_name && lh.signatory_title) doc.text(clean(lh.signatory_title), M, top + 40.6);
    if (l.status === 'signed' && l.signed_at) {
      doc.text(l.needs_signature ? 'Read, understood and accepted' : 'Received and acknowledged', rx, top);
      if (l.signature) { const z = await fit(l.signature, 62, 22); doc.addImage(l.signature, 'PNG', rx, top + 7, z.w, z.h); }
      doc.line(rx, top + 31, rx + 72, top + 31);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...INK); doc.text(clean(l.signed_name || l.person), rx, top + 36);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...GREY); doc.text(`Signed electronically on ${dtt(l.signed_at)}`, rx, top + 40.6);
    } else if (l.status === 'issued') {
      doc.text(l.needs_signature ? 'Read, understood and accepted' : 'Received and acknowledged', rx, top);
      doc.line(rx, top + 31, rx + 72, top + 31); doc.setFontSize(8.5); doc.text('Awaiting electronic signature in the CRUX app', rx, top + 36);
    }
    y = top + 46; body();
  };

  for (const b of parseLetter(l.body)) {
    if (b.t === 'title') { if (!signed) await signatures(); newPage(); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...NAVY);
      const t: string[] = doc.splitTextToSize(clean(b.text).toUpperCase(), CW); doc.text(t, W / 2, y, { align: 'center' }); y += t.length * 6 + 1;
      doc.setDrawColor(...NAVY); doc.setLineWidth(0.4); doc.line(W / 2 - 18, y - 2, W / 2 + 18, y - 2); y += 5; body(); continue; }
    if (b.t === 'h') { room(LH * 3); y += 2.5; doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...NAVY); flow(b.text, M, CW, false); y += 1.2; body(); continue; }
    if (b.t === 'num') { const ind = b.level ? 16 : 9, x0 = M + (b.level ? 8 : 0); room(LH); doc.setFont('helvetica', b.level ? 'normal' : 'bold'); doc.text(b.n, x0, y); body(); flow(b.text, M + ind, CW - ind); y += 1.6; continue; }
    if (b.t === 'bullet') { room(LH); doc.setFillColor(...NAVY); doc.circle(M + 4.2, y - 1.4, 0.75, 'F'); flow(b.text, M + 9, CW - 9); y += 0.8; continue; }
    if (b.t === 'table') { const kw = 62; y += 1;
      for (const [k, v] of b.rows) { const vl: string[] = doc.splitTextToSize(clean(v), CW - kw - 6), kl: string[] = doc.splitTextToSize(clean(k), kw - 6); const h = Math.max(vl.length, kl.length) * 5 + 3.6; room(h);
        doc.setFillColor(244, 246, 250); doc.rect(M, y - 4.4, kw, h, 'F'); doc.setDrawColor(...RULE); doc.setLineWidth(0.2); doc.rect(M, y - 4.4, CW, h); doc.line(M + kw, y - 4.4, M + kw, y - 4.4 + h);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(kl, M + 3, y); doc.setFont('helvetica', 'normal'); doc.text(vl, M + kw + 3, y); y += h; }
      y += 3.5; body(); continue; }
    flow(b.text, M, CW); y += 2.6;
  }

  if (!signed) await signatures();
  chrome(doc, lh, l.ref_no, l.status === 'signed' ? `${l.ref_no}  |  Electronically signed  |  Record ${String(l.body_hash ?? '').slice(0, 12)}` : `${l.ref_no}  |  ${l.status === 'issued' ? 'Not yet signed' : l.status}`);
  return doc.output('blob');
}

export async function payslipPdf(s: Slip, lh: Letterhead): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = await head(doc, lh);
  const mon = new Date(s.month + 'T12:00:00+05:30').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...NAVY); doc.text('PRIVATE AND CONFIDENTIAL', M, y, { charSpace: 0.6 }); y += 9;
  doc.setFontSize(13); doc.text(`Salary Slip - ${mon}`, W / 2, y, { align: 'center' }); y += 10;
  doc.setFontSize(9.5);
  const info: [string, string][] = [['Employee', s.person], ['Designation', s.designation || '-'], ['Department', s.department || '-'],
    ['Date of joining', s.joining_date ? dt(s.joining_date + 'T12:00:00+05:30') : '-'], ['PAN', s.pan_last4 ? `XXXXXX${s.pan_last4}` : '-'], ['UAN', s.uan_last4 ? `XXXXXXXX${s.uan_last4}` : '-'],
    ['Bank', s.bank_name ? `${s.bank_name}${s.bank_account_last4 ? `, a/c XXXX${s.bank_account_last4}` : ''}` : '-'],
    ['Paid days', s.paid_days != null ? `${s.paid_days}${s.days_in_month ? ` of ${s.days_in_month}` : ''}` : '-']];
  const half = CW / 2; const ih = Math.ceil(info.length / 2) * 6.4 + 5;
  doc.setFillColor(244, 246, 250); doc.rect(M, y - 5, CW, ih, 'F');
  info.forEach(([k, v], i) => { const x = M + 3 + (i % 2) * half, yy = y + Math.floor(i / 2) * 6.4;
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...GREY); doc.text(k, x, yy); doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.text(clean(String(v)), x + 32, yy); });
  y += ih + 3;
  const colW = half - 3, rows = Math.max(s.earnings.length, s.deductions.length, 1), rowH = 6.6;
  const table = (x: number, title: string, items: { label: string; amount: number }[], total: number, totalLabel: string) => {
    doc.setFillColor(...NAVY); doc.rect(x, y, colW, 7.8, 'F'); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255); doc.setFontSize(9.5);
    doc.text(title, x + 3, y + 5.3); doc.text('Amount', x + colW - 3, y + 5.3, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...INK);
    items.forEach((it, i) => { const yy = y + 7.8 + (i + 1) * rowH - 1.9; doc.text(clean(it.label), x + 3, yy); doc.text(rs(it.amount), x + colW - 3, yy, { align: 'right' }); });
    const ty = y + 7.8 + rows * rowH; doc.setDrawColor(...RULE); doc.setLineWidth(0.2); doc.line(x, ty + 1, x + colW, ty + 1);
    doc.setFont('helvetica', 'bold'); doc.text(totalLabel, x + 3, ty + 6.2); doc.text(rs(total), x + colW - 3, ty + 6.2, { align: 'right' });
    doc.rect(x, y, colW, 7.8 + rows * rowH + 8.8);
  };
  table(M, 'Earnings', s.earnings, s.gross, 'Gross earnings'); table(M + half + 3, 'Deductions', s.deductions, s.deductions_total, 'Total deductions');
  y += 7.8 + rows * rowH + 8.8 + 8;
  doc.setFillColor(...NAVY); doc.rect(M, y, CW, 12, 'F'); doc.setTextColor(255, 255, 255); doc.setFontSize(12); doc.text('Net pay', M + 4, y + 7.9); doc.text(rs(s.net), W - M - 4, y + 7.9, { align: 'right' });
  y += 19; doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...GREY);
  doc.text('This is a system-generated salary slip and does not require a signature. Please keep it confidential.', M, y);
  chrome(doc, lh, `Salary slip - ${mon}`, `Salary slip  |  ${mon}`);
  return doc.output('blob');
}

/** Save a made file on this phone or computer. */
export function saveBlob(b: Blob, name: string) {
  const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}
