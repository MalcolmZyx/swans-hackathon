import type { CaseData, Source } from "./types";
import { fmtDate } from "./format";
import { loadPages, pageCite, pageSource, type DocPages } from "./pages";

/**
 * Ask (DESIGN.md §16): BM25 over every entry and every OCR'd page, then an answer written only
 * from the top passages with numbered cites, or "Not in the file." Each cite carries the Source the
 * UI opens, with the matching sentence (or the page lines) to highlight.
 */

const STOP = new Set(
  "a an and are as at be been by did do does for from had has have he her his how i in is it its me my of on or our she so than that the their them then there these they this to was we were what when where which who whom why will with you your any about after before into over under up down out more most no not only own same can just should now".split(" "),
);
const SYNONYMS: Record<string, string[]> = {
  coverage: ["limit", "policy", "insurance", "insurer"],
  insurance: ["coverage", "policy", "limit"],
  surgery: ["arthroscopy", "operation", "operative", "repair"],
  injury: ["tear", "diagnosis", "fracture"],
  doctor: ["dr", "physician"],
  owe: ["lien"],
  settle: ["offer", "negotiation"],
  settlement: ["offer", "negotiation"],
  adjuster: ["claim", "carrier"],
  job: ["employ", "wage"],
  income: ["wage", "earning"],
  salary: ["wage", "earning"],
  court: ["summon", "complaint", "index"],
};

function stem(w: string): string {
  if (w.length <= 4) return w;
  return w.replace(/(ing|ed|es|s)$/, "");
}

export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/\$?[a-z0-9][a-z0-9,.]*[a-z0-9]|\$?[a-z0-9]/g) ?? [])
    .map((t) => t.replace(/,/g, ""))
    .filter((t) => !STOP.has(t))
    .map(stem);
}

type Passage = {
  key: string;
  kind: string;
  title: string;
  date?: string;
  text: string;
  toks: string[];
  scale: number;
  source: Source;
  doc?: DocPages;
  page?: number; // index
};

let index: { key: string; passages: Passage[]; df: Map<string, number>; avg: number } | null = null;

async function buildIndex(data: CaseData) {
  const docs = await loadPages(data);
  const key = `${data.pulledAt}:${docs.length}`;
  if (index?.key === key) return index;
  const passages: Passage[] = [];
  for (const e of data.events) {
    if (e.kind === "document" || e.kind === "milestone") continue;
    const text = `${e.title}\n${e.body}`;
    passages.push({ key: e.id, kind: e.kind, title: e.title, date: e.date, text, toks: tokens(text), scale: 1, source: e.source });
  }
  for (const f of data.facts) {
    const text = `${f.name}: ${String(f.value)}`;
    passages.push({ key: `fact:${f.name}`, kind: "fact", title: f.name, text, toks: tokens(text), scale: 1, source: f.source });
  }
  for (const d of docs) {
    d.pages.forEach((p, i) => {
      const text = p.lines.map((l) => l[0]).join("\n");
      if (text.trim().length < 20) return;
      passages.push({ key: `doc:${d.doc}#${i + 1}`, kind: "document", title: `${d.title}, p.${i + 1}`, text, toks: tokens(text), scale: 0.85, source: pageSource(d, pageCite(d, i, 0, -1)), doc: d, page: i });
    });
  }
  const df = new Map<string, number>();
  for (const p of passages) for (const t of new Set(p.toks)) df.set(t, (df.get(t) ?? 0) + 1);
  const avg = passages.reduce((s, p) => s + p.toks.length, 0) / Math.max(1, passages.length);
  index = { key, passages, df, avg };
  return index;
}

function search(ix: NonNullable<typeof index>, q: string[]) {
  const N = ix.passages.length;
  const k1 = 1.2;
  const b = 0.75;
  const terms: [string, number][] = [];
  for (const t of new Set(q)) {
    if (ix.df.has(t)) terms.push([t, 1]);
    for (const s of SYNONYMS[t] ?? []) if (ix.df.has(stem(s))) terms.push([stem(s), 0.6]);
  }
  const scored = ix.passages.map((p) => {
    const tf = new Map<string, number>();
    for (const t of p.toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    const norm = Math.max(0.25, 1 - b + (b * p.toks.length) / ix.avg);
    let s = 0;
    for (const [t, w] of terms) {
      const f = tf.get(t);
      if (!f) continue;
      const df = ix.df.get(t)!;
      s += w * Math.log(1 + (N - df + 0.5) / (df + 0.5)) * ((f * (k1 + 1)) / (f + k1 * norm));
    }
    return { p, s: s * p.scale, hits: q.filter((t) => tf.has(t)).length };
  });
  return scored.filter((r) => r.s > 0).sort((a, b) => b.s - a.s).slice(0, 8);
}

/** The sentence (or 1-3 page lines) on a passage that best matches the question. */
function locate(p: Passage, q: string[]): { snippet: string; source: Source } {
  const qs = new Set(q);
  const cover = (s: string) => tokens(s).filter((t) => qs.has(t)).length;
  if (p.doc && p.page != null) {
    const lines = p.doc.pages[p.page].lines;
    let best = { from: 0, to: 0, s: -1 };
    for (let i = 0; i < lines.length; i++) {
      for (let n = 0; n < 3 && i + n < lines.length; n++) {
        const s = cover(lines.slice(i, i + n + 1).map((l) => l[0]).join(" ")) - n * 0.3;
        if (s > best.s) best = { from: i, to: i + n, s };
      }
    }
    const cite = pageCite(p.doc, p.page, best.from, best.to);
    return { snippet: cite.text, source: pageSource(p.doc, cite) };
  }
  const sentences = p.text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim().length > 8);
  const best = sentences.reduce((a, s) => (cover(s) > cover(a) ? s : a), sentences[0] ?? p.title);
  return { snippet: best.trim(), source: { ...p.source, quote: best.trim() } };
}

export type AskCite = { n: number; title: string; kind: string; date?: string; page?: number; snippet: string; source: Source };
export type AskResult = { answer: string; cites: AskCite[]; nearest?: AskCite[]; notFound: boolean; via: "gemini" | "search" | "none"; error?: string };

const cache = new Map<string, AskResult>();

const PROMPT = `You answer an attorney's question about one personal-injury case file, using ONLY the numbered passages given.
Write 1-3 plain sentences. Put the passage number in square brackets after each claim, like [2]. List every number you used in cites.
If the passages do not answer the question, set not_in_file true and answer "Not in the file." Never guess or use outside knowledge.`;

async function gemini(question: string, passages: { n: number; label: string; text: string }[]) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const body = passages.map((p) => `[${p.n}] ${p.label}\n${p.text}`).join("\n\n");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: PROMPT }] },
      contents: [{ role: "user", parts: [{ text: `Question: ${question}\n\nPassages:\n${body}` }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: { answer: { type: "STRING" }, cites: { type: "ARRAY", items: { type: "INTEGER" } }, not_in_file: { type: "BOOLEAN" } },
          required: ["answer", "cites", "not_in_file"],
        },
      },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message ?? `Gemini returned ${res.status}`);
  const text = (json.candidates?.[0]?.content?.parts ?? []).filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text ?? "").join("");
  return JSON.parse(text) as { answer: string; cites: number[]; not_in_file: boolean };
}

function cite(n: number, p: Passage, q: string[]): AskCite {
  const { snippet, source } = locate(p, q);
  return { n, title: p.doc ? p.doc.title : p.title, kind: p.kind, date: p.date, page: p.page != null ? p.page + 1 : undefined, snippet: snippet.length > 160 ? `${snippet.slice(0, 157)}…` : snippet, source };
}

export async function ask(data: CaseData, question: string): Promise<AskResult> {
  const ix = await buildIndex(data);
  const q = tokens(question);
  const hits = search(ix, q);
  const cacheKey = `${question.trim().toLowerCase()}|${hits.map((h) => h.p.key).join(",")}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const uniq = new Set(q).size;
  const weak = !hits.length || (uniq >= 3 ? hits[0].hits / uniq < 0.6 : hits[0].hits < uniq);
  const nearest = hits.slice(0, 3).map((h, i) => cite(i + 1, h.p, q));
  let result: AskResult;

  try {
    const top = hits.slice(0, 6);
    const out = top.length
      ? await gemini(
          question,
          top.map((h, i) => {
            const loc = locate(h.p, q);
            const text = h.p.doc ? `${loc.snippet}\n…\n${h.p.text.slice(0, 2500)}` : h.p.text.slice(0, 2500);
            return { n: i + 1, label: `${h.p.kind}${h.p.date ? ` · ${fmtDate(h.p.date)}` : ""} · ${h.p.title}`, text };
          }),
        )
      : null;
    if (out) {
      const used = [...new Set(out.cites)].filter((n) => n >= 1 && n <= top.length);
      if (out.not_in_file || !used.length) {
        result = { answer: "Not in the file.", cites: [], nearest, notFound: true, via: "gemini" };
      } else {
        // Renumber 1..k in order of use so the text and the list agree.
        const order = [...out.answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])).filter((n) => used.includes(n));
        const seq = [...new Set([...order, ...used])];
        const map = new Map(seq.map((n, i) => [n, i + 1]));
        const answer = out.answer.replace(/\[(\d+)\]/g, (m, n) => (map.has(Number(n)) ? `[${map.get(Number(n))}]` : ""));
        result = { answer, cites: seq.map((n) => cite(map.get(n)!, top[n - 1].p, q)), notFound: false, via: "gemini" };
      }
    } else if (weak) {
      result = { answer: "Not in the file.", cites: [], nearest, notFound: true, via: "none" };
    } else {
      // Extractive: quote the best sentences from the top passages.
      const picks = hits.slice(0, 2).map((h, i) => cite(i + 1, h.p, q));
      result = { answer: picks.map((c) => `${c.snippet} [${c.n}]`).join(" "), cites: picks, notFound: false, via: "search" };
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (weak) return { answer: "Not in the file.", cites: [], nearest, notFound: true, via: "none", error };
    const picks = hits.slice(0, 2).map((h, i) => cite(i + 1, h.p, q));
    return { answer: picks.map((c) => `${c.snippet} [${c.n}]`).join(" "), cites: picks, notFound: false, via: "search", error };
  }
  cache.set(cacheKey, result);
  return result;
}
