// Copies the OCR engine and English language data into public/ocr so they are served from our own site
// (no third-party download at scan time). Runs before dev and build.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'ocr'); mkdirSync(out, { recursive: true });
const nm = (p) => join(root, 'node_modules', p);
for (const [src, dst] of [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
]) copyFileSync(nm(src), join(out, dst));
console.log('OCR assets copied to public/ocr');
