// Claude-powered digestion. Three jobs, each cached so a case is never re-digested from scratch:
//   1. enrichItems   – Haiku 4.5 scores every note/email/task (importance, why it matters). Cached per item content hash,
//                      so opening the case again, or a sync that adds 3 emails, only pays for the 3 new emails.
//   2. extractInjuries – Haiku 4.5 reads only the pages the heuristic pre-filter flags in the scanned records and
//                      returns structured findings with page numbers. Cached per document sha256.
//   3. caseBrief     – Opus 5.5 writes the 90-second brief from the facts + enriched items, citing item ids.
//                      Cached on the hash of every input, so it only re-runs when the case actually moved.
//   4. providerUpdate – Haiku 4.5 writes the provider-facing status note from ONLY the fields the attorney chose
//                      to share. The model never sees anything else, so it cannot leak strategy.
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { db } from '../db.js';

export const MODELS = { bulk: process.env.BULK_MODEL || 'claude-haiku-4-5', brief: process.env.BRIEF_MODEL || 'claude-opus-5-5' };
export const PRICES = { 'claude-haiku-4-5': [1, 5], 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10] }; // $ per MTok in/out
const PROMPT_VERSION = 'v3';

// Ask can also run on OpenAI when only an OpenAI key is configured. Same prompt, same JSON shape, same cache.
export const askEnabled = () => aiEnabled() || !!process.env.OPENAI_API_KEY;
async function openaiJson(system, user, schema) {
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: `${system}\n\nReply with one JSON object matching this JSON Schema:\n${JSON.stringify(schema)}` }, { role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return { value: JSON.parse(j.choices[0].message.content), usage: { input_tokens: j.usage?.prompt_tokens, output_tokens: j.usage?.completion_tokens }, model };
}
export const aiEnabled = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
let client;
const anthropic = () => (client ??= new Anthropic());
const hash = (x) => createHash('sha256').update(PROMPT_VERSION + JSON.stringify(x)).digest('hex').slice(0, 32);

function cached(key) {
  const r = db.prepare('SELECT value FROM llm_cache WHERE key = ?').get(key);
  return r ? JSON.parse(r.value) : undefined;
}
function store(key, model, usage, value) {
  db.prepare('INSERT OR REPLACE INTO llm_cache (key, model, created_at, input_tokens, output_tokens, value) VALUES (?, ?, ?, ?, ?, ?)')
    .run(key, model, new Date().toISOString(), usage?.input_tokens || 0, usage?.output_tokens || 0, JSON.stringify(value));
}

async function json(model, system, user, schema, { maxTokens = 16000, effort } = {}) {
  const params = {
    model, max_tokens: maxTokens, system,
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema }, ...(effort ? { effort } : {}) },
  };
  let res;
  if (model.startsWith('claude-opus-5') || model.startsWith('claude-sonnet-5')) {
    // Server-side refusal fallback, routed by category.
    res = await anthropic().beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }).finalMessage();
  } else {
    res = await anthropic().messages.create(params);
  }
  if (res.stop_reason === 'refusal') throw new Error(`Claude declined (${res.stop_details?.category || 'unknown'})`);
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return { value: JSON.parse(text), usage: res.usage, model: res.model || model };
}

const itemText = (i) => `[${i.id}] ${i.date} ${i.kind.toUpperCase()}${i.from ? ` from ${i.from.join(', ')} to ${i.to.join(', ')}` : ''}${i.status ? ` (${i.status})` : ''}: ${i.title}\n${i.body}`;

// ---------- 1. Item enrichment ----------
const ENRICH_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'importance', 'why', 'provider_relevant'],
    properties: { id: { type: 'string' }, importance: { type: 'integer' }, why: { type: 'string' }, provider_relevant: { type: 'boolean' } } } } },
};
const ENRICH_SYSTEM = `You triage entries in a US personal-injury case file for the attorney who has to get up to speed.
For each entry return: importance 1-5 (5 = changes case value, coverage, liability, deadlines or treatment; 1 = routine admin),
why: one plain sentence, under 25 words, saying what this entry means for the case (not a restatement of its subject),
provider_relevant: true only if a treating medical provider would legitimately need it (their bills/records, treatment, case status) and it reveals no strategy.`;

export async function enrichItems(items) {
  const out = {};
  const todo = [];
  for (const i of items) {
    const key = `enrich:${hash([i.id, i.title, i.body, i.status, i.date])}`;
    const hit = cached(key);
    if (hit) out[i.id] = hit; else todo.push({ i, key });
  }
  for (let k = 0; k < todo.length; k += 40) {
    const batch = todo.slice(k, k + 40);
    const { value, usage, model } = await json(MODELS.bulk, ENRICH_SYSTEM, batch.map(b => itemText(b.i)).join('\n\n---\n\n'), ENRICH_SCHEMA, { maxTokens: 8000 });
    const per = { input_tokens: Math.round(usage.input_tokens / batch.length), output_tokens: Math.round(usage.output_tokens / batch.length) };
    for (const b of batch) {
      const r = value.items.find(x => x.id === b.i.id);
      if (!r) continue;
      out[b.i.id] = r; store(b.key, model, per, r);
    }
  }
  return { results: out, fresh: todo.length };
}

// ---------- 2. Injuries from scanned records ----------
const INJURY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['findings'],
  properties: { findings: { type: 'array', items: { type: 'object', additionalProperties: false,
    required: ['region', 'diagnosis', 'page', 'quote', 'source_type'],
    properties: { region: { type: 'string', enum: ['head', 'cervical', 'thoracic', 'lumbar', 'left shoulder', 'right shoulder', 'left knee', 'right knee', 'other'] },
      diagnosis: { type: 'string' }, page: { type: 'integer' }, quote: { type: 'string' },
      source_type: { type: 'string', enum: ['imaging', 'treating', 'operative', 'emergency', 'defense', 'other'] } } } } },
};
const INJURY_SYSTEM = `You read OCR'd pages from medical records in a personal-injury file. Extract the client's diagnosed injuries.
Only report a finding stated on the page (imaging impression, diagnosis, assessment, operative finding). Quote the exact OCR words (under 20 words).
Skip billing codes without a diagnosis, normal/negative findings, and anything about a different patient. Page numbers are given as [p.N].`;

export async function extractInjuries(doc, candidatePages) {
  const key = `injury:${hash([doc.sha256, candidatePages])}`;
  const hit = cached(key);
  if (hit) return hit;
  const pages = doc.pages.filter(p => candidatePages.includes(p.page));
  const findings = [];
  for (let k = 0; k < pages.length; k += 12) {
    const chunk = pages.slice(k, k + 12).map(p => `[p.${p.page}]\n${p.text.slice(0, 6000)}`).join('\n\n');
    const { value, usage, model } = await json(MODELS.bulk, INJURY_SYSTEM, `Document: ${doc.name}\n\n${chunk}`, INJURY_SCHEMA, { maxTokens: 8000 });
    findings.push(...value.findings.map(f => ({ ...f, docId: doc.id })));
    store(`${key}:part${k}`, model, usage, null);
  }
  store(key, MODELS.bulk, null, findings);
  return findings;
}

// ---------- 3. The brief ----------
const cite = { type: 'array', items: { type: 'string' } };
const BRIEF_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['headline', 'story', 'top10', 'risks', 'next_moves'],
  properties: {
    headline: { type: 'string' },
    story: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'cites'], properties: { text: { type: 'string' }, cites: cite } } },
    top10: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'why'], properties: { id: { type: 'string' }, why: { type: 'string' } } } },
    risks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'detail', 'cites'], properties: { title: { type: 'string' }, detail: { type: 'string' }, cites: cite } } },
    next_moves: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'cites'], properties: { text: { type: 'string' }, cites: cite } } },
  },
};
const BRIEF_SYSTEM = `You brief a personal-injury trial attorney who is opening this matter cold and has 90 seconds.
Write like a sharp senior associate: concrete, numbers first, no hedging, no legal boilerplate.
headline: one sentence, under 30 words, the single most important thing about where this case stands.
story: 4-6 beats in chronological order, each one sentence, together telling how the case got here.
top10: the ten entries out of the whole file that matter most, each with a why under 20 words.
risks: 3-5 things that could cost the client money, each with one-sentence detail.
next_moves: 3-5 concrete actions, most urgent first.
Every claim must cite the entry ids it rests on, exactly as given in square brackets, e.g. "note:6601012". Never invent ids.`;

export async function caseBrief(facts, items, enriched) {
  const compactFacts = {
    asOf: facts.asOf, client: facts.hero.client, doi: facts.hero.doi, stage: facts.hero.stage, summary: facts.hero.summary,
    value: facts.kpis.caseValue.value, coverage: facts.kpis.coverage.value, coverageDetail: facts.kpis.coverage.detail,
    specials: facts.kpis.specials.value, wage: facts.kpis.wage.detail, lien: facts.kpis.lien.detail, firmSpend: facts.kpis.firmSpend.value,
    overdue: facts.work.overdue.map(t => `${t.id} ${t.title} (due ${t.date})`), lastClientCall: facts.client.lastTalk,
  };
  const body = items.filter(i => i.kind !== 'expense').map(i => `${itemText(i)}${enriched?.[i.id] ? `\n(triage: ${enriched[i.id].importance}/5)` : ''}`).join('\n\n---\n\n');
  const user = `CASE FACTS (computed from Clio fields):\n${JSON.stringify(compactFacts, null, 1)}\n\nCASE FILE ENTRIES:\n\n${body}`;
  const key = `brief:${hash(user)}`;
  const hit = cached(key);
  if (hit) return { ...hit, cached: true };
  const { value, usage, model } = await json(MODELS.brief, BRIEF_SYSTEM, user, BRIEF_SCHEMA, { effort: 'medium', maxTokens: 32000 });
  const ids = new Set(items.map(i => i.id));
  const clean = (arr) => arr.filter(x => ids.has(x));
  value.story.forEach(s => (s.cites = clean(s.cites)));
  value.risks.forEach(s => (s.cites = clean(s.cites)));
  value.next_moves.forEach(s => (s.cites = clean(s.cites)));
  value.top10 = value.top10.filter(t => ids.has(t.id));
  store(key, model, usage, value);
  return { ...value, cached: false };
}

// ---------- 4. Provider-facing update ----------
const PROVIDER_SCHEMA = { type: 'object', additionalProperties: false, required: ['summary', 'asks'],
  properties: { summary: { type: 'string' }, asks: { type: 'array', items: { type: 'string' } } } };

export async function providerUpdate(shared) {
  const key = `provider:${hash(shared)}`;
  const hit = cached(key);
  if (hit) return hit;
  const { value, usage, model } = await json(MODELS.bulk,
    `You write a short, warm, plain-English status update from a personal-injury law firm to a medical provider treating their client on a lien.
Use ONLY the facts given. Never speculate about value, strategy, or liability. summary: 2-3 sentences. asks: what the firm needs from this office, imperative, one line each.`,
    JSON.stringify(shared), PROVIDER_SCHEMA, { maxTokens: 2000 });
  store(key, model, usage, value);
  return value;
}

export function spend() {
  const rows = db.prepare('SELECT model, SUM(input_tokens) i, SUM(output_tokens) o, COUNT(*) n FROM llm_cache GROUP BY model').all();
  let total = 0;
  const byModel = rows.filter(r => r.model).map(r => {
    const [pi, po] = PRICES[r.model] || PRICES[MODELS.brief];
    const usd = (r.i * pi + r.o * po) / 1e6; total += usd;
    return { model: r.model, inputTokens: r.i, outputTokens: r.o, calls: r.n, usd };
  });
  return { byModel, total };
}

// ---------- 5. Ask (RAG answer over retrieved passages) ----------
const ASK_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['answer', 'cites', 'not_in_file'],
  properties: { answer: { type: 'string' }, cites: { type: 'array', items: { type: 'integer' } }, not_in_file: { type: 'boolean' } },
};
const ASK_SYSTEM = `You answer an attorney's question about one personal-injury case file, using ONLY the numbered passages given.
Lead with the direct answer in a few words (for example "The left, yes. The right, not yet."), then 1-2 plain sentences of support. Put the passage number in square brackets after each claim, like [2]. List every number you used in cites.
If the passages do not answer the question, set not_in_file true and answer "Not in the file." Never guess or use outside knowledge.`;

export async function askCase(question, passages) {
  const key = `ask:${hash([question.toLowerCase().trim(), passages.map(p => p.key)])}`;
  const hit = cached(key);
  if (hit) return hit;
  const ctx = passages.map((p, i) => `[${i + 1}] ${p.label}\n${p.text}`).join('\n\n');
  const user = `Passages:\n\n${ctx}\n\nQuestion: ${question}`;
  const { value, usage, model } = aiEnabled() ? await json(MODELS.bulk, ASK_SYSTEM, user, ASK_SCHEMA, { maxTokens: 1500 }) : await openaiJson(ASK_SYSTEM, user, ASK_SCHEMA);
  store(key, model, usage, value);
  return value;
}
