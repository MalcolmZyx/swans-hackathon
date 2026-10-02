// Page-level text extraction for documents pulled from Clio.
// Native text first (pdftotext); pages that come back empty are scans, so they
// are rasterised and OCR'd with tesseract. Results are cached by file sha256,
// so a document is only ever read once, no matter how many times the case is opened.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
const CACHE_DIR = process.env.TEXT_CACHE_DIR || path.resolve('data/text-cache');
const MIN_NATIVE_CHARS = 40;

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function pageCount(file) {
  const { stdout } = await run('pdfinfo', [file]);
  const m = stdout.match(/Pages:\s+(\d+)/);
  return m ? Number(m[1]) : 0;
}

async function nativeText(file, page) {
  const { stdout } = await run('pdftotext', ['-layout', '-f', String(page), '-l', String(page), file, '-'], { maxBuffer: 1 << 26 });
  return stdout;
}

async function ocrPage(file, page, tmp) {
  const base = path.join(tmp, `p${page}`);
  await run('pdftoppm', ['-r', '150', '-gray', '-png', '-f', String(page), '-l', String(page), '-singlefile', file, base]);
  const { stdout } = await run('tesseract', [`${base}.png`, '-', '--psm', '3'], { maxBuffer: 1 << 26, env: { ...process.env, OMP_THREAD_LIMIT: '1' } });
  await fs.rm(`${base}.png`, { force: true });
  return stdout;
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  });
  await Promise.all(workers);
  return out;
}

/** Returns { sha256, pages: [{ page, text, method: 'native'|'ocr' }] }, cached. */
export async function extractPdf(buf, { onProgress } = {}) {
  const hash = sha256(buf);
  const cacheFile = path.join(CACHE_DIR, `${hash}.json`);
  try { return JSON.parse(await fs.readFile(cacheFile, 'utf8')); } catch {}

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'caselight-'));
  const file = path.join(tmp, 'doc.pdf');
  await fs.writeFile(file, buf);
  const n = await pageCount(file);
  let done = 0;
  const pages = await pool([...Array(n).keys()].map(k => k + 1), Math.max(1, os.cpus().length), async (page) => {
    let text = await nativeText(file, page);
    let method = 'native';
    if (text.replace(/\s/g, '').length < MIN_NATIVE_CHARS) { text = await ocrPage(file, page, tmp); method = 'ocr'; }
    done++; onProgress?.(done, n);
    return { page, text: text.replace(/\f/g, '').trim(), method };
  });
  await fs.rm(tmp, { recursive: true, force: true });
  const result = { sha256: hash, pageCount: n, pages };
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify(result));
  return result;
}

/** Pull embedded images (e.g. the client's photo ID) out of a PDF. Returns PNG buffers. */
export async function extractImages(buf) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'caselight-img-'));
  const file = path.join(tmp, 'doc.pdf');
  await fs.writeFile(file, buf);
  await run('pdfimages', ['-png', file, path.join(tmp, 'img')]);
  const names = (await fs.readdir(tmp)).filter(f => f.startsWith('img') && f.endsWith('.png')).sort();
  const out = [];
  for (const f of names) out.push(await fs.readFile(path.join(tmp, f)));
  await fs.rm(tmp, { recursive: true, force: true });
  return out;
}
