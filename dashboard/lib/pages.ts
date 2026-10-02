import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { CaseData, PdfCite, Source } from "./types";

/** Per-page text of the case PDFs, written by pdf_text.py: lines with boxes as page fractions. */
type Line = [string, number, number, number, number];
type Page = { w: number; h: number; ocr: boolean; lines: Line[] };
export type DocPages = { doc: number; name: string; title: string; folder: string; pages: Page[] };

const DIR = path.join(process.cwd(), "data", "pdf_text");
let cache: { key: string; docs: DocPages[] } | null = null;

export async function loadPages(data: CaseData): Promise<DocPages[]> {
  let files: string[];
  try {
    files = (await readdir(DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const stamps = await Promise.all(files.map(async (f) => `${f}:${(await stat(path.join(DIR, f))).mtimeMs}`));
  const key = stamps.join("|");
  if (cache?.key === key) return cache.docs;
  const meta = new Map(data.documents.map((d) => [Number(d.source.recordId), d]));
  const docs: DocPages[] = [];
  for (const f of files) {
    const id = Number(f.replace(".json", ""));
    const d = meta.get(id);
    if (!d) continue;
    const json = JSON.parse(await readFile(path.join(DIR, f), "utf-8")) as { pages: Page[] };
    docs.push({ doc: id, name: d.filename ?? d.title, title: d.title, folder: d.folder ?? "", pages: json.pages });
  }
  cache = { key, docs };
  return docs;
}

/** A PdfCite for lines [from, to] of a page, highlighted. */
export function pageCite(d: DocPages, pageIndex: number, from: number, to: number): PdfCite {
  const p = d.pages[pageIndex];
  const lines = p.lines.slice(from, to + 1);
  return {
    doc: d.doc,
    name: d.name,
    title: d.title,
    folder: d.folder,
    page: pageIndex + 1,
    pages: d.pages.length,
    size: [p.w, p.h],
    rects: lines.map(([, x0, y0, x1, y1]) => [x0, y0, x1, y1]),
    text: lines.map((l) => l[0]).join(" "),
  };
}

export function pageSource(d: DocPages, cite: PdfCite): Source {
  return { kind: "document", recordId: d.doc, field: `page ${cite.page}`, label: `Document: ${d.name}`, api: `GET /api/v4/documents/${d.doc}/download`, pdf: [cite] };
}

// ---------- Injuries (§14): finding word + body region, page-cited ----------

const FINDING = /\b(tear|torn|herniat\w*|bulg\w*|fractur\w*|radiculopath\w*|sprain\w*|strain\w*|labr\w*|impingement|effusion|stenosis|concussion|tbi|derangement|chondromalacia|bursitis|tendin\w*|contusion|disc)\b/i;
const NEGATIVE = /\b(no acute|unremarkable|rule out|r\/o|negative for|no evidence|within normal|denies)\b/i;
const NOISE = /\b(settlement|counsel|deposition|cplr|plaintiff|defendant|attorney|esq|verified|bill of particulars|interrogator)\b/i;
const STRONG = /\b(mri|emg|tear|status post|s\/p|labral repair|arthroscop\w*)\b/i;
const SECTION = /\b(impression|diagnos\w*|assessment|findings)\b/i;
const BILLING = /\b(cpt|icd|\d{5}\b|units?|charges?)\b/i;

const REGIONS: [string, RegExp][] = [
  ["left shoulder", /\b(left|lt\.?|l)\s+shoulder\b/i],
  ["right shoulder", /\b(right|rt\.?|r)\s+shoulder\b/i],
  ["left knee", /\b(left|lt\.?|l)\s+knee\b/i],
  ["right knee", /\b(right|rt\.?|r)\s+knee\b/i],
  ["head", /\b(head|concussion|tbi|post-?concussi\w*)\b/i],
  ["cervical", /\b(cervical|neck|c[3-7]-c?[4-7])\b/i],
  ["thoracic", /\b(thoracic|t\d{1,2}-t?\d{1,2})\b/i],
  ["lumbar", /\b(lumbar|low back|l[1-5]-[ls]?[1-5])\b/i],
];

export type Injury = { region: string; weight: number; sources: Source[] };

export async function injuries(data: CaseData): Promise<Injury[]> {
  const docs = (await loadPages(data)).filter((d) => /medical|bills|expert|records/i.test(d.folder));
  const byRegion = new Map<string, { weight: number; hits: { w: number; d: DocPages; p: number; l: number }[] }>();
  for (const d of docs) {
    d.pages.forEach((page, p) => {
      let inSection = false;
      page.lines.forEach(([line], l) => {
        if (SECTION.test(line)) inSection = true;
        const both = `${line} ${page.lines[l + 1]?.[0] ?? ""}`;
        if (!FINDING.test(line) || NEGATIVE.test(both) || NOISE.test(both)) return;
        let w = 1 + (inSection ? 2 : 0) + (STRONG.test(both) ? 2 : 0) - (BILLING.test(line) ? 2 : 0);
        if (w <= 0) return;
        for (const [region, re] of REGIONS) {
          if (!re.test(both)) continue;
          const r = byRegion.get(region) ?? { weight: 0, hits: [] };
          r.weight += w;
          r.hits.push({ w, d, p, l });
          byRegion.set(region, r);
          w = Math.max(0.5, w - 1);
        }
      });
    });
  }
  return [...byRegion.entries()]
    .filter(([, r]) => r.weight >= 3)
    .sort((a, b) => b[1].weight - a[1].weight)
    .map(([region, r]) => {
      const best = [...r.hits].sort((a, b) => b.w - a.w).slice(0, 3);
      const sources = best.map((h) => {
        const nextIsPart = h.l + 1 < h.d.pages[h.p].lines.length && FINDING.test(h.d.pages[h.p].lines[h.l + 1][0]);
        return pageSource(h.d, pageCite(h.d, h.p, h.l, nextIsPart ? h.l + 1 : h.l));
      });
      return { region, weight: r.weight, sources };
    });
}

/** "Both shoulders · Head · Cervical" — left/right pairs collapse. */
export function injuryLabels(list: Injury[]): { label: string; sources: Source[] }[] {
  const out: { label: string; sources: Source[] }[] = [];
  const done = new Set<string>();
  for (const inj of list) {
    if (done.has(inj.region)) continue;
    const m = /^(left|right) (\w+)$/.exec(inj.region);
    if (m) {
      const other = list.find((i) => i.region === `${m[1] === "left" ? "right" : "left"} ${m[2]}`);
      if (other) {
        done.add(other.region);
        done.add(inj.region);
        out.push({ label: `Both ${m[2]}s`, sources: [inj.sources[0], other.sources[0]] });
        continue;
      }
    }
    done.add(inj.region);
    out.push({ label: inj.region.charAt(0).toUpperCase() + inj.region.slice(1), sources: inj.sources.slice(0, 1) });
  }
  return out.slice(0, 6);
}
