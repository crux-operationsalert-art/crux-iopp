// On-phone document reading (D-87): the photo or PDF is turned into page images and read by Tesseract in the browser.
// Nothing is sent anywhere for reading; the engine and English data are served from this site (public/ocr) and cached.
import { Kind, parseText, Parsed, verdict } from './ocrParse';

type Worker = { recognize: (img: HTMLCanvasElement) => Promise<{ data: { text: string; confidence: number } }> };
let worker: Promise<Worker> | null = null;
let report: ((p: number, label: string) => void) | undefined;   // the scan in progress (one worker is shared by every card)
const base = () => new URL('./ocr/', document.baseURI).href;

async function getWorker(): Promise<Worker> {
  if (!worker) {
    worker = (async () => {
      const T = await import('tesseract.js');
      return (await T.createWorker('eng', 1, {
        workerPath: base() + 'worker.min.js', corePath: base(), langPath: base(), gzip: true, workerBlobURL: false,
        logger: (m: { status: string; progress: number }) => report?.(m.progress, m.status.startsWith('recogn') ? 'Reading' : 'Preparing the reader (first time only)'),
      })) as unknown as Worker;
    })();
    worker.catch(() => { worker = null; });
  }
  return worker;
}

export class NeedPassword extends Error { constructor(public wrong: boolean) { super(wrong ? 'Wrong PDF password.' : 'This PDF is password-protected.'); } }

type Source = { pages: HTMLCanvasElement[]; pdfText?: string };

/** File → page images in colour, sized so small print is about three times larger (a PDF also gives its text layer,
 *  which e-Aadhaar / e-PAN PDFs carry and which is exact). */
async function toSource(file: Blob, password?: string): Promise<Source> {
  if (file.type === 'application/pdf') {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const url = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = url;
    let doc;
    try { doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), password }).promise; }
    catch (e: any) { if (e?.name === 'PasswordException') throw new NeedPassword(e.code === 2); throw new Error('This PDF could not be opened. Upload a photo of the card instead.'); }
    const pages: HTMLCanvasElement[] = []; let pdfText = '';
    for (let i = 1; i <= Math.min(doc.numPages, 2); i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      let lastY: number | null = null;
      for (const it of tc.items as any[]) { const y = it.transform?.[5]; pdfText += (lastY !== null && Math.abs(y - lastY) > 2 ? '\n' : ' ') + (it.str ?? ''); lastY = y; }
      pdfText += '\n';
      const vp = page.getViewport({ scale: 3 });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
      pages.push(c);
    }
    return { pages, pdfText };
  }
  let bmp: ImageBitmap | HTMLImageElement;
  try { bmp = await createImageBitmap(file); }
  catch {
    bmp = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('This photo format cannot be opened on this phone. Take the photo with the camera (JPG) or upload a PDF.')); i.src = URL.createObjectURL(file); });
  }
  const w = 'naturalWidth' in bmp ? bmp.naturalWidth : bmp.width, h = 'naturalHeight' in bmp ? bmp.naturalHeight : bmp.height;
  const k = Math.max(0.6, Math.min(3, 2900 / Math.max(w, h)));           // small photos enlarged up to 3×, huge ones reduced
  const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  const g = c.getContext('2d')!; g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, c.width, c.height);
  return { pages: [c] };
}

/** Grey with the darkest 1% → black and the lightest 1% → white (gentle; keeps small print sharp). */
function stretched(src: HTMLCanvasElement) {
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(src, 0, 0);
  const im = g.getImageData(0, 0, c.width, c.height); const d = im.data; const hist = new Uint32Array(256); const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) { const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; d[i] = y; hist[y]++; }
  let lo = 0, hi = 255, acc = 0;
  for (; lo < 255; lo++) { acc += hist[lo]; if (acc > n * 0.01) break; }
  for (acc = 0; hi > 0; hi--) { acc += hist[hi]; if (acc > n * 0.01) break; }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) { const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / span)); d[i] = d[i + 1] = d[i + 2] = v; }
  g.putImageData(im, 0, 0); return c;
}
/** Black-and-white against the local background (helps with shadows, tinted / patterned card backgrounds). */
function binarised(src: HTMLCanvasElement) {
  const s = stretched(src); const w = s.width, h = s.height;
  const b = document.createElement('canvas'); b.width = w; b.height = h;
  const bg = b.getContext('2d', { willReadFrequently: true })!; bg.filter = `blur(${Math.max(8, Math.round(w / 120))}px)`; bg.drawImage(s, 0, 0);
  const g = s.getContext('2d', { willReadFrequently: true })!;
  const im = g.getImageData(0, 0, w, h), bk = bg.getImageData(0, 0, w, h).data, d = im.data;
  for (let i = 0; i < d.length; i += 4) { const v = d[i] < bk[i] - 18 ? 0 : 255; d[i] = d[i + 1] = d[i + 2] = v; }
  g.putImageData(im, 0, 0); return s;
}
function rotate(src: HTMLCanvasElement, deg: 90 | 180 | 270) {
  const c = document.createElement('canvas'); const s = deg !== 180;
  c.width = s ? src.height : src.width; c.height = s ? src.width : src.height;
  const g = c.getContext('2d')!; g.translate(c.width / 2, c.height / 2); g.rotate((deg * Math.PI) / 180); g.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

export type ScanResult = { parsed: Parsed; check: ReturnType<typeof verdict>; text: string };
const keyOf = (r: ScanResult) => `${r.parsed.number ?? (r.parsed.candidates ?? []).join(',')}|${r.parsed.ifsc ?? ''}`;

/** Read a document and check it is the one asked for. The image is read in up to three differently prepared versions.
 *  Aadhaar is accepted on one reading (its check digit catches misreads); PAN and bank details have no check digit, so
 *  two readings must agree — a number read differently each time is never offered as if it were certain. */
export async function scanDocument(file: Blob, expected: Kind, onProgress?: (p: number, label: string) => void, password?: string): Promise<ScanResult> {
  if (file.size > 10 * 1024 * 1024) throw new Error('The file is larger than 10 MB. Take a smaller photo or scan.');
  onProgress?.(0, 'Opening the file');
  const src = await toSource(file, password);
  const tryText = (text: string): ScanResult => { const parsed = parseText(text); return { parsed, check: verdict(expected, parsed), text }; };
  if (src.pdfText && src.pdfText.replace(/\s/g, '').length > 30) { const r = tryText(src.pdfText); if (r.check.ok) return r; }   // e-Aadhaar / e-PAN: exact text
  report = onProgress;
  const w = await getWorker();
  const runs: ScanResult[] = [];
  const decide = (final: boolean): ScanResult | null => {
    const ok = runs.filter((r) => r.check.ok);
    if (expected === 'aadhaar' && ok.length) return ok[0];
    const votes = new Map<string, ScanResult[]>(); for (const r of ok) votes.set(keyOf(r), [...(votes.get(keyOf(r)) ?? []), r]);
    const top = [...votes.values()].sort((a, b) => b.length - a.length)[0];
    if (top && top.length >= 2) return top[0];
    const other = runs.filter((r) => !['unknown', expected].includes(r.parsed.detected));      // consistently another document
    if (other.length >= 2 && other.every((r) => r.parsed.detected === other[0].parsed.detected)) return other[0];
    if (!final) return null;
    if (top) return { ...top[0], check: { ok: false, retake: true, message: `We could not read the ${expected === 'bank' ? 'account number / IFSC' : 'number'} with certainty — it read differently each time. Take a sharper photo (flat, good light, no glare, close enough to fill the frame), or type it from this document.` } };
    return runs.find((r) => r.parsed.detected === expected) ?? other[0] ?? runs[0];
  };
  try {
    const passes: [string, (c: HTMLCanvasElement) => HTMLCanvasElement][] = [['Reading', stretched], ['Checking (second reading)', (c) => c], ['Checking (third reading)', binarised]];
    for (const [label, prep] of passes) {
      onProgress?.(0, label);
      let text = '';
      for (const p of src.pages) text += '\n' + (await w.recognize(prep(p))).data.text;
      runs.push(tryText(text));
      const d = decide(false); if (d) return d;
    }
    if (file.type !== 'application/pdf' && runs.every((r) => r.parsed.detected === 'unknown')) {
      for (const deg of [90, 270, 180] as const) {                          // photo taken sideways or upside down
        onProgress?.(0, `Reading (turning the photo ${deg}°)`);
        const rot = rotate(src.pages[0], deg);
        const a = tryText((await w.recognize(stretched(rot))).data.text);
        if (a.parsed.detected === 'unknown') continue;
        runs.push(a, tryText((await w.recognize(rot)).data.text));
        const d = decide(false); if (d) return d;
        break;
      }
    }
    return decide(true)!;
  } finally { if (report === onProgress) report = undefined; }
}
