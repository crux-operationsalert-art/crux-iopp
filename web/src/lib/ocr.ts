// On-phone document reading (D-87): the photo or PDF is turned into page images and read by Tesseract in the browser.
// Nothing is sent anywhere for reading; the engine and English data are served from this site (public/ocr) and cached.
import { Kind, parseText, Parsed, verdict } from './ocrParse';

type Box = { x0: number; y0: number; x1: number; y1: number };
type Word = { text: string; confidence: number; bbox: Box };
type Line = { bbox: Box; baseline: Box; words: Word[] };
type Worker = { recognize: (img: HTMLCanvasElement) => Promise<{ data: { text: string; confidence: number; words?: Word[]; lines?: Line[] } }> };
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

/** Open a photo (the phone's own orientation tag is applied). */
async function loadImage(file: Blob) {
  let bmp: ImageBitmap | HTMLImageElement;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions); }
  catch {
    bmp = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('This photo format cannot be opened on this phone. Take the photo with the camera (JPG) or upload a PDF.')); i.src = URL.createObjectURL(file); });
  }
  const w = 'naturalWidth' in bmp ? bmp.naturalWidth : bmp.width, h = 'naturalHeight' in bmp ? bmp.naturalHeight : bmp.height;
  return { bmp, w, h };
}

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
  const { bmp, w, h } = await loadImage(file);
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

function scaled(src: CanvasImageSource, w: number, h: number, k: number) {
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext('2d')!; g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, c.width, c.height); return c;
}
/** Turn by any angle (degrees, clockwise) on a white sheet large enough to hold the whole picture. */
function tilt(src: HTMLCanvasElement, deg: number) {
  const a = (deg * Math.PI) / 180, co = Math.abs(Math.cos(a)), si = Math.abs(Math.sin(a));
  const c = document.createElement('canvas'); c.width = Math.ceil(src.width * co + src.height * si); c.height = Math.ceil(src.width * si + src.height * co);
  const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingQuality = 'high';
  g.translate(c.width / 2, c.height / 2); g.rotate(a); g.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

export type Prepared = { blob: Blob; changed: boolean; turned: 0 | 90 | 180 | 270; straightened: number; cropped: boolean };

/** Make a photo ready to read and to look at (D-128): turned upright, straightened, and cropped to the document when the
 *  document fills only part of the frame. Upright is the turn at which the reader finds the most confident words; the tilt
 *  comes from the slope of the text lines; the crop is the area that holds text plus a margin (never tighter than that).
 *  A PDF, or a photo where nothing can be made out, is returned untouched. Nothing leaves this device. */
export async function prepareImage(file: Blob, opts: { crop?: boolean } = {}, onProgress?: (p: number, label: string) => void): Promise<Prepared> {
  const same: Prepared = { blob: file, changed: false, turned: 0, straightened: 0, cropped: false };
  if (file.type === 'application/pdf' || !file.type.startsWith('image/')) return same;
  const { bmp, w, h } = await loadImage(file);
  const full = scaled(bmp, w, h, Math.min(1, 3600 / Math.max(w, h)));
  const mayCrop = opts.crop !== false;
  report = onProgress;
  try {
    const wk = await getWorker();
    type Look = { good: Word[]; W: number; H: number; k: number; score: number; skew: number; box: Box };
    /** Read a working copy (longest side up to 1800 px) and report the confident words, the slope of the text and where it sits. */
    const look = async (src: HTMLCanvasElement): Promise<Look> => {
      const k = Math.min(1, 1800 / Math.max(src.width, src.height));
      const c = k < 1 ? scaled(src, src.width, src.height, k) : src;
      const r = (await wk.recognize(stretched(c))).data;
      const good = (r.words ?? []).filter((x) => x.confidence >= 60 && /[A-Za-z0-9]{3,}/.test(x.text));
      const box = good.length ? { x0: Math.min(...good.map((g) => g.bbox.x0)), y0: Math.min(...good.map((g) => g.bbox.y0)),
                                  x1: Math.max(...good.map((g) => g.bbox.x1)), y1: Math.max(...good.map((g) => g.bbox.y1)) } : { x0: 0, y0: 0, x1: c.width, y1: c.height };
      const slopes = (r.lines ?? []).filter((l) => l.baseline && l.words.filter((x) => x.confidence >= 60).length >= 2 && l.bbox.x1 - l.bbox.x0 > (box.x1 - box.x0) * 0.25)
        .map((l) => (Math.atan2(l.baseline.y1 - l.baseline.y0, l.baseline.x1 - l.baseline.x0) * 180) / Math.PI).sort((a, b) => a - b);
      const mid = slopes.length >= 2 ? slopes[Math.floor(slopes.length / 2)] : 0;
      return { good, W: c.width, H: c.height, k, score: good.reduce((a, x) => a + x.confidence, 0), skew: Math.abs(mid) > 0.7 && Math.abs(mid) < 20 ? mid : 0, box };
    };
    /** Straighten by `skew` and cut to `box` (given in the working copy of `src`, grown by the margins), keeping track of what was done. */
    const fix = (src: HTMLCanvasElement, l: Look, mx: number, my: number, cut: boolean) => {
      let out = src;
      let b = { x0: Math.max(0, l.box.x0 - (l.box.x1 - l.box.x0) * mx - l.W * 0.02) / l.k, y0: Math.max(0, l.box.y0 - (l.box.y1 - l.box.y0) * my - l.H * 0.02) / l.k,
                x1: Math.min(l.W, l.box.x1 + (l.box.x1 - l.box.x0) * mx + l.W * 0.02) / l.k, y1: Math.min(l.H, l.box.y1 + (l.box.y1 - l.box.y0) * my + l.H * 0.02) / l.k };
      if (l.skew) {
        const a = (-l.skew * Math.PI) / 180, cx = src.width / 2, cy = src.height / 2, t = tilt(src, -l.skew);
        const pt = (x: number, y: number) => [(x - cx) * Math.cos(a) - (y - cy) * Math.sin(a) + t.width / 2, (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a) + t.height / 2];
        const ps = [pt(b.x0, b.y0), pt(b.x1, b.y0), pt(b.x0, b.y1), pt(b.x1, b.y1)];
        b = { x0: Math.max(0, Math.min(...ps.map((q) => q[0]))), y0: Math.max(0, Math.min(...ps.map((q) => q[1]))),
              x1: Math.min(t.width, Math.max(...ps.map((q) => q[0]))), y1: Math.min(t.height, Math.max(...ps.map((q) => q[1]))) };
        out = t;
      }
      const did = cut && ((b.x1 - b.x0) * (b.y1 - b.y0)) / (out.width * out.height) < 0.6;
      if (did) {
        const c = document.createElement('canvas'); c.width = Math.round(b.x1 - b.x0); c.height = Math.round(b.y1 - b.y0);
        c.getContext('2d')!.drawImage(out, Math.round(b.x0), Math.round(b.y0), c.width, c.height, 0, 0, c.width, c.height); out = c;
      }
      return { out, did };
    };

    // 1. which way up: the quarter turn at which the reader finds the most confident words
    let best: (Look & { deg: 0 | 90 | 180 | 270 }) | null = null;
    for (const deg of [0, 90, 270, 180] as const) {
      onProgress?.(0, deg ? 'Finding which way up the photo is' : 'Checking the photo');
      const l = { ...(await look(deg ? rotate(full, deg) : full)), deg };
      if (!best || l.score > best.score) best = l;
      if (l.good.length >= 10 && l === best) break;                     // clearly the right way up
    }
    if (!best || best.good.length < 3) return same;                      // nothing readable: leave it alone
    // 2. upright, straightened, and roughly cut around the text (wide margins: this first look may have missed some of it)
    onProgress?.(0, 'Straightening the photo');
    const a = fix(best.deg ? rotate(full, best.deg) : full, best, 0.6, 0.6, mayCrop);
    let out = a.out, straightened = best.skew, cropped = a.did;
    // 3. look again now that the text is level and larger: remove what tilt is left and cut to the document with a normal margin
    if (best.skew || a.did) {
      const again = await look(out);
      if (again.good.length >= 3) { const b = fix(out, again, 0.18, 0.22, mayCrop); out = b.out; straightened += again.skew; cropped = cropped || b.did; }
    }
    if (!best.deg && !straightened && !cropped) return same;
    if (Math.max(out.width, out.height) > 2600) out = scaled(out, out.width, out.height, 2600 / Math.max(out.width, out.height));
    const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/jpeg', 0.9));
    if (!blob) return same;
    return { blob, changed: true, turned: best.deg, straightened: Math.round(straightened * 10) / 10, cropped };
  } finally { if (report === onProgress) report = undefined; }
}
/** The corrected picture as a file to store. `mark` names it "corrected-…" (a tidy-up of an earlier upload, not a new one). */
export function preparedFile(p: Prepared, name: string, mark: boolean) {
  const base = name.replace(/^corrected-/, '').replace(/\.[A-Za-z0-9]+$/, '') || 'document';
  return new File([p.blob], `${mark ? 'corrected-' : ''}${base}.jpg`, { type: 'image/jpeg' });
}

export type ScanResult = { parsed: Parsed; check: ReturnType<typeof verdict>; text: string };
const keyOf = (r: ScanResult) => `${r.parsed.number ?? (r.parsed.candidates ?? []).join(',')}|${r.parsed.ifsc ?? ''}`;

/** Read a document and check it is the one asked for. The image is read in up to three differently prepared versions.
 *  Aadhaar is accepted on one reading (its check digit catches misreads); PAN and bank details have no check digit, so
 *  two readings must agree — a number read differently each time is never offered as if it were certain. */
export async function scanDocument(file: Blob, expected: Kind, onProgress?: (p: number, label: string) => void, password?: string, turn: 0 | 90 | 180 | 270 = 0): Promise<ScanResult> {
  if (file.size > 10 * 1024 * 1024) throw new Error('The file is larger than 10 MB. Take a smaller photo or scan.');
  onProgress?.(0, 'Opening the file');
  const src = await toSource(file, password);
  if (turn) src.pages = src.pages.map((c) => rotate(c, turn));                 // the reader was told which way up it is
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
  /** Which way up is the page? A small copy is read at each quarter turn; real words only appear the right way up. */
  const bestTurn = async (page: HTMLCanvasElement): Promise<0 | 90 | 180 | 270> => {
    const k = Math.min(1, 1200 / Math.max(page.width, page.height));
    const small = document.createElement('canvas'); small.width = Math.round(page.width * k); small.height = Math.round(page.height * k);
    small.getContext('2d')!.drawImage(page, 0, 0, small.width, small.height);
    let best: 0 | 90 | 180 | 270 = 0, top = 0, upright = 0;
    for (const deg of [0, 90, 270, 180] as const) {
      const { data } = await w.recognize(stretched(deg ? rotate(small, deg) : small));
      const wordsSeen = (data.text.match(/[A-Za-z]{4,}/g) ?? []).length + 2 * (data.text.match(/\b\d{4}\b/g) ?? []).length;
      const score = wordsSeen * Math.max(1, data.confidence) * (parseText(data.text).detected !== 'unknown' ? 3 : 1);
      if (deg === 0) upright = score;
      if (score > top) { top = score; best = deg; }
    }
    return best !== 0 && top > upright * 1.3 ? best : 0;                    // only turn when another way up is clearly better
  };
  try {
    const passes: [string, (c: HTMLCanvasElement) => HTMLCanvasElement][] = [['Reading', stretched], ['Checking (second reading)', (c) => c], ['Checking (third reading)', binarised]];
    let turned = !!turn;
    for (let i = 0; i < passes.length; i++) {
      const [label, prep] = passes[i];
      onProgress?.(0, label);
      let text = '';
      for (const p of src.pages) text += '\n' + (await w.recognize(prep(p))).data.text;
      runs.push(tryText(text));
      const d = decide(false); if (d) return d;
      if (i === 0 && !turned && !runs[0].check.ok) {                          // first reading failed: is the photo sideways or upside down?
        turned = true;
        onProgress?.(0, 'Checking which way up the photo is');
        const deg = await bestTurn(src.pages[0]);
        if (deg) { src.pages = src.pages.map((c) => rotate(c, deg)); runs.length = 0; i = -1; onProgress?.(0, `Turning the photo ${deg}°`); }
      }
    }
    return decide(true)!;
  } finally { if (report === onProgress) report = undefined; }
}
