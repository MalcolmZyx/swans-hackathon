// Offline digestion, used when no ANTHROPIC_API_KEY is set (and as the pre-filter that keeps
// the Claude path cheap). Generated from the case file on every sync; nothing here is Sapini-specific.
import { daysBetween } from './facts.js';

const SIGNALS = [
  [/surg|arthroscop|operative/i, 3], [/lien|medicaid/i, 2.5], [/coverage|limits?|self-insured|policy/i, 2.5],
  [/exhaust/i, 2], [/IME|independent medical|expert|radiolog/i, 2], [/served|summons|complaint|answer/i, 1.5],
  [/demand|offer|negotiat|settle/i, 2.5], [/deposition|compliance conference|motion|compel/i, 1.5],
  [/discrepan|contradict|inconsistent|three different|denied by the client|prior injur/i, 3],
  [/scope of employment|liability|mechanism/i, 2.5], [/recommend/i, 1.5], [/no date|still no|unanswered|fifth|third request/i, 2],
  [/valuation|case value|evaluation|\$\d{2,3},\d{3}/i, 2.5], [/wage|1099|commission/i, 1.5], [/limitations/i, 2],
];
const KIND_WEIGHT = { note: 1.5, email: 0.6, call: 0.8, task: 1, event: 0.7, document: 1.2, expense: 0.2 };
const ROUTINE = /^(RE: )?(Records request|Request for updated|Records chaser|Checking in|Year-end check-in|Client check-in)/i;

export function scoreItems(items, today) {
  return items.map(i => {
    const text = `${i.title}\n${i.body}`;
    let s = KIND_WEIGHT[i.kind] || 0.5;
    const tags = [];
    for (const [re, w] of SIGNALS) if (re.test(text)) { s += w; tags.push(re.source.split('|')[0].replace(/[\\^$]/g, '')); }
    if (ROUTINE.test(i.title)) s -= 2;
    const age = i.date ? daysBetween(i.date, today) : 999;
    if (age >= 0 && age < 45) s += 1.5; else if (age >= 0 && age < 120) s += 0.5;
    if (i.kind === 'task' && i.status !== 'complete' && i.date < today) s += 3;
    const importance = Math.max(1, Math.min(5, Math.round(s / 2.2)));
    return { id: i.id, importance, score: s, why: keySentence(i.body), tags };
  });
}

export function firstSentence(text = '') {
  const t = text.replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.{20,220}?[.!?])(\s|$)/);
  return m ? m[1] : t.slice(0, 200);
}

/** The most informative sentence in a body: the one carrying the most case signals (money, surgery, coverage...). */
export function keySentence(text = '') {
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z0-9])/).filter(s => s.length >= 40 && s.length <= 260);
  if (!sentences.length) return firstSentence(text);
  const score = (s) => SIGNALS.reduce((n, [re, w]) => n + (re.test(s) ? w : 0), 0) + (/\$[\d,]+/.test(s) ? 1 : 0);
  return sentences.map((s, k) => ({ s, v: score(s) - k * 0.15 })).sort((a, b) => b.v - a.v)[0].s;
}

/** Top N that matter: highest score, but never more than 3 from the same week, so the list tells a story. */
export function topItems(items, scores, n = 10, today) {
  const byId = Object.fromEntries(scores.map(s => [s.id, s]));
  const ranked = items.filter(i => i.date <= today && i.kind !== 'expense').sort((a, b) => byId[b.id].score - byId[a.id].score);
  const weeks = {};
  const out = [];
  for (const i of ranked) {
    const w = i.date.slice(0, 7);
    if ((weeks[w] = (weeks[w] || 0) + 1) > 3) continue;
    out.push({ id: i.id, why: byId[i.id].why });
    if (out.length === n) break;
  }
  return out.sort((a, b) => items.find(i => i.id === a.id).date.localeCompare(items.find(i => i.id === b.id).date));
}

// ---------- Injuries from the scanned medical record ----------
export const REGIONS = {
  head: /\b(head|brain|TBI|concuss|post[- ]?concuss|cranial|cognitive|headache|traumatic brain)/i,
  cervical: /\b(cervical|neck|C[1-7]-?[1-7]?\b|C\d-\d)/i,
  thoracic: /\b(thoracic|upper back|T\d{1,2}-\d)/i,
  lumbar: /\b(lumbar|low(er)? back|L[1-5]-(S1|L?\d)|lumbosacral)/i,
  'left shoulder': /\bleft shoulder|\bL(eft)?\.? shoulder/i,
  'right shoulder': /\bright shoulder|\bR(ight)?\.? shoulder/i,
  'left knee': /\bleft knee/i,
  'right knee': /\bright knee/i,
};
const FINDING = /(tear|herniat|bulg|protrusion|fracture|radiculopath|sprain|strain|derangement|impingement|labral|labrum|tendinosis|tendinopathy|effusion|stenosis|concussion|post[- ]concussion|traumatic brain|TBI|neuropathy|syndrome|contusion|internal derangement|chondromalacia|disc|bursitis|synovitis)/i;
const NOISE = /settlement|counsel|plaintiff's attorney|deposition|CPLR|interrogator|\bdemand\b|O(Stabilizing|Unchanged)|\[(Stabilizing|Unchanged)/i;
const NEGATIVE = /\bno (acute|disc|depressed|evidence|fracture)|without evidence|unremarkable|normal (height|signal)|rule out|objectively resolved/i;
const SECTION = /(impression|diagnos[ie]s|assessment|findings|conclusion)s?\s*[:\-]/i;

export function injuryCandidates(doc) {
  const out = [];
  for (const p of doc.pages) {
    const lines = p.text.split('\n').map(l => l.trim()).filter(Boolean);
    const inSection = SECTION.test(p.text);
    lines.forEach((line, k) => {
      const ctx = [line, lines[k + 1]].filter(Boolean).join(' ');
      if (!FINDING.test(ctx) || NOISE.test(line) || NEGATIVE.test(line)) return;
      for (const [region, re] of Object.entries(REGIONS)) {
        if (!re.test(line)) continue;
        const strong = /MRI|EMG|impression|tear|herniat|bulge|concussion|TBI|status post|labral repair/i.test(ctx);
        const icdOnly = /CD10|ICD|Visit No/i.test(line);
        out.push({ region, finding: ctx.replace(/\s+/g, ' ').replace(/^[^A-Za-z0-9]+/, '').slice(0, 190), page: p.page, docId: doc.id,
          weight: (inSection ? 2 : 1) + (strong ? 2 : 0) - (icdOnly ? 2 : 0), method: p.method });
      }
    });
  }
  return out;
}

export function summariseInjuries(cands) {
  const regions = {};
  for (const c of cands) {
    const r = (regions[c.region] ??= { region: c.region, mentions: 0, pages: new Set(), all: [] });
    r.mentions += c.weight;
    r.pages.add(`${c.docId}#${c.page}`);
    r.all.push(c);
  }
  return Object.values(regions).map(r => {
    const seen = new Set();
    const findings = r.all.sort((a, b) => b.weight - a.weight || a.page - b.page)
      .filter(f => { const k = f.finding.slice(0, 60).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6);
    return { region: r.region, mentions: r.mentions, pages: [...r.pages], findings };
  }).sort((a, b) => b.mentions - a.mentions);
}
