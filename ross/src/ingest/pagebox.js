// Finds where a cited passage sits on a document page, so the UI can draw a highlight over the page image.
// Word boxes come from pdftotext -bbox for pages with a text layer, and from tesseract's TSV output for
// scanned pages. Both are cached on disk per page. Boxes are returned as fractions of the page (0..1).
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ClioReadOnlyClient } from '../clio/client.js';

const run = promisify(execFile);
const DIR = () => path.resolve('data/pages');
const norm = (w) => w.toLowerCase().replace(/[^a-z0-9$]/g, '');
const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

export async function ensurePdf(docId) {
  const pdf = path.join(DIR(), `${docId}.pdf`);
  try { await fs.access(pdf); } catch {
    await fs.mkdir(DIR(), { recursive: true });
    const clio = await ClioReadOnlyClient.fromEnv(); // GET only
    await fs.writeFile(pdf, await clio.download(docId));
  }
  return pdf;
}

async function wordBoxes(docId, page) {
  const cache = path.join(DIR(), `${docId}-${page}.words.json`);
  try { return JSON.parse(await fs.readFile(cache, 'utf8')); } catch {}
  const pdf = await ensurePdf(docId);
  let words = [];
  const { stdout } = await run('pdftotext', ['-bbox', '-f', String(page), '-l', String(page), pdf, '-'], { maxBuffer: 1 << 26 });
  const dim = stdout.match(/<page width="([\d.]+)" height="([\d.]+)"/);
  if (dim) {
    const W = Number(dim[1]), H = Number(dim[2]);
    for (const m of stdout.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
      words.push({ t: norm(unesc(m[5])), x: m[1] / W, y: m[2] / H, w: (m[3] - m[1]) / W, h: (m[4] - m[2]) / H });
    }
  }
  if (words.filter(w => w.t).length < 8) {
    // Scanned page: no text layer, so read word positions with tesseract.
    const base = path.join(DIR(), `${docId}-${page}.ocr`);
    await run('pdftoppm', ['-r', '200', '-png', '-f', String(page), '-l', String(page), '-singlefile', pdf, base]);
    const { stdout: tsv } = await run('tesseract', [`${base}.png`, 'stdout', '--psm', '3', 'tsv'], { maxBuffer: 1 << 26, env: { ...process.env, OMP_THREAD_LIMIT: '1' } });
    const rows = tsv.split('\n').slice(1).map(l => l.split('\t'));
    const pageRow = rows.find(r => r[0] === '1');
    const W = Number(pageRow?.[8]) || 1, H = Number(pageRow?.[9]) || 1;
    words = rows.filter(r => r[0] === '5' && r[11]?.trim()).map(r => ({ t: norm(r[11]), x: r[6] / W, y: r[7] / H, w: r[8] / W, h: r[9] / H }));
    await fs.rm(`${base}.png`, { force: true });
  }
  words = words.filter(w => w.t);
  await fs.mkdir(DIR(), { recursive: true });
  await fs.writeFile(cache, JSON.stringify(words));
  return words;
}

/** Rectangles (page fractions) covering the best match for `passage` on the page, or [] if it cannot be placed. */
export async function locate(docId, page, passage) {
  const q = String(passage || '').split(/\s+/).map(norm).filter(Boolean);
  if (q.length < 2) return { found: false, rects: [] };
  const words = await wordBoxes(docId, page);
  if (!words.length) return { found: false, rects: [] };
  const want = new Map(); for (const t of q) want.set(t, (want.get(t) || 0) + 1);
  const L = Math.min(words.length, q.length + 4);
  // Slide a window the length of the passage over the page; keep the one sharing the most words with it.
  const have = new Map(); let overlap = 0, best = { score: 0, s: 0 };
  const add = (t, d) => { const w = want.get(t) || 0, h = have.get(t) || 0, nh = h + d; have.set(t, nh); if (d > 0 && h < w) overlap++; if (d < 0 && nh < w) overlap--; };
  for (let k = 0; k < words.length; k++) {
    add(words[k].t, 1);
    if (k >= L) add(words[k - L].t, -1);
    if (overlap > best.score) best = { score: overlap, s: Math.max(0, k - L + 1), e: k };
  }
  if (best.score < Math.max(2, Math.ceil(q.length * 0.6))) return { found: false, rects: [] };
  let { s, e } = best;
  while (s < e && !want.has(words[s].t)) s++;
  while (e > s && !want.has(words[e].t)) e--;
  // One rectangle per text line.
  const lines = [];
  for (const w of words.slice(s, e + 1)) {
    const ln = lines.find(l => Math.abs((l.y + l.h / 2) - (w.y + w.h / 2)) < Math.max(l.h, w.h) * 0.6);
    if (ln) { const x2 = Math.max(ln.x + ln.w, w.x + w.w), y2 = Math.max(ln.y + ln.h, w.y + w.h); ln.x = Math.min(ln.x, w.x); ln.y = Math.min(ln.y, w.y); ln.w = x2 - ln.x; ln.h = y2 - ln.y; }
    else lines.push({ x: w.x, y: w.y, w: w.w, h: w.h });
  }
  const pad = 0.002;
  return { found: true, score: best.score / q.length, rects: lines.map(l => ({ x: Math.max(0, l.x - pad), y: Math.max(0, l.y - pad), w: Math.min(1, l.w + 2 * pad), h: l.h + 2 * pad })) };
}
