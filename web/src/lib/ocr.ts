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

/** File → page images (a photo is one page; a PDF gives its first two pages). */
async function toCanvases(file: Blob, password?: string): Promise<HTMLCanvasElement[]> {
  if (file.type === 'application/pdf') {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const url = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = url;
    let doc;
    try { doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), password }).promise; }
    catch (e: any) { if (e?.name === 'PasswordException') throw new NeedPassword(e.code === 2); throw new Error('This PDF could not be opened. Upload a photo of the card instead.'); }
    const out: HTMLCanvasElement[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, 2); i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 2.5 });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
      out.push(c);
    }
    return out;
  }
  let bmp: ImageBitmap | HTMLImageElement;
  try { bmp = await createImageBitmap(file); }
  catch {
    bmp = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('This photo format cannot be opened on this phone. Take the photo with the camera (JPG) or upload a PDF.')); i.src = URL.createObjectURL(file); });
  }
  const w = 'naturalWidth' in bmp ? bmp.naturalWidth : bmp.width, h = 'naturalHeight' in bmp ? bmp.naturalHeight : bmp.height;
  const k = Math.min(2.5, 2200 / Math.max(w, h));                         // enlarge small photos, shrink huge ones
  const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  const g = c.getContext('2d')!; g.filter = 'grayscale(1) contrast(1.35)'; g.drawImage(bmp, 0, 0, c.width, c.height);
  return [c];
}
function rotate(src: HTMLCanvasElement, deg: 90 | 180 | 270) {
  const c = document.createElement('canvas'); const s = deg !== 180;
  c.width = s ? src.height : src.width; c.height = s ? src.width : src.height;
  const g = c.getContext('2d')!; g.translate(c.width / 2, c.height / 2); g.rotate((deg * Math.PI) / 180); g.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

export type ScanResult = { parsed: Parsed; check: ReturnType<typeof verdict>; text: string };

/** Read a document and check it is the one asked for. Tries the photo turned sideways / upside down if needed. */
export async function scanDocument(file: Blob, expected: Kind, onProgress?: (p: number, label: string) => void, password?: string): Promise<ScanResult> {
  if (file.size > 10 * 1024 * 1024) throw new Error('The file is larger than 10 MB. Take a smaller photo or scan.');
  onProgress?.(0, 'Opening the file');
  const pages = await toCanvases(file, password);
  report = onProgress;
  const w = await getWorker();
  try {
  let best: ScanResult | null = null;
  const tryText = (text: string): ScanResult => { const parsed = parseText(text); return { parsed, check: verdict(expected, parsed), text }; };
  let text = '';
  for (const p of pages) text += '\n' + (await w.recognize(p)).data.text;
  best = tryText(text);
  if (best.check.ok || file.type === 'application/pdf' || best.parsed.detected !== 'unknown') return best;
  for (const deg of [90, 270, 180] as const) {                              // photo taken sideways or upside down
    onProgress?.(0, `Reading (turning the photo ${deg}°)`);
    const r = tryText((await w.recognize(rotate(pages[0], deg))).data.text);
    if (r.check.ok || r.parsed.detected !== 'unknown') return r;
  }
  return best;
  } finally { if (report === onProgress) report = undefined; }
}
