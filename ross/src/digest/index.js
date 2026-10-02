// Orchestrates digestion of one synced CaseFile into what the dashboard and provider portal render.
import { computeFacts, fmt, daysBetween } from './facts.js';
import { scoreItems, topItems, keySentence, injuryCandidates, summariseInjuries } from './heuristic.js';
import * as llm from './llm.js';
import { documentPages } from '../ingest/sync.js';
import { db } from '../db.js';

const MEDICAL = /medical|bills|expert|records/i;
const nice = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export async function buildDigest(cf) {
  const facts = computeFacts(cf);
  const today = facts.asOf;
  const scores = scoreItems(cf.items, today);
  const scoreById = Object.fromEntries(scores.map(s => [s.id, s]));
  const ai = llm.aiEnabled();
  const errors = [];

  let enriched = null;
  if (ai) {
    try { enriched = (await llm.enrichItems(cf.items.filter(i => i.kind !== 'expense'))).results; }
    catch (e) { errors.push(`enrich: ${e.message}`); }
  }
  const importance = (id) => enriched?.[id]?.importance ?? scoreById[id]?.importance ?? 1;
  const why = (id) => enriched?.[id]?.why ?? scoreById[id]?.why;

  // ---------- Injuries ----------
  const injuryDocs = [];
  let allCands = [];
  for (const d of cf.documents.filter(d => MEDICAL.test(d.folder || ''))) {
    const doc = await documentPages(cf, d.id);
    if (!doc) continue;
    const cands = injuryCandidates(doc);
    allCands.push(...cands);
    injuryDocs.push({ doc, pages: [...new Set(cands.map(c => c.page))] });
  }
  let injuries = summariseInjuries(allCands);
  let injurySource = 'heuristic';
  if (ai) {
    try {
      const found = [];
      for (const { doc, pages } of injuryDocs) if (pages.length) found.push(...await llm.extractInjuries(doc, pages));
      const regions = {};
      for (const f of found.filter(f => f.region !== 'other')) {
        const r = (regions[f.region] ??= { region: f.region, mentions: 0, pages: [], findings: [] });
        r.mentions++; r.pages.push(`${f.docId}#${f.page}`);
        if (r.findings.length < 6 && !r.findings.some(x => x.finding === f.diagnosis)) r.findings.push({ finding: f.diagnosis, quote: f.quote, page: f.page, docId: f.docId, sourceType: f.source_type });
      }
      injuries = Object.values(regions).sort((a, b) => b.mentions - a.mentions);
      injurySource = 'claude';
    } catch (e) { errors.push(`injuries: ${e.message}`); }
  }

  // ---------- Brief ----------
  let brief, briefSource = 'heuristic';
  if (ai) {
    try { brief = await llm.caseBrief(facts, cf.items, enriched); briefSource = brief.cached ? 'claude (cached)' : 'claude'; }
    catch (e) { errors.push(`brief: ${e.message}`); }
  }
  if (!brief) brief = heuristicBrief(cf, facts, scores, today);

  const timeline = cf.items.map(i => ({ ...i, importance: importance(i.id), why: why(i.id), providerRelevant: enriched?.[i.id]?.provider_relevant ?? null }));

  return {
    facts, brief, briefSource, injuries, injurySource, timeline, errors,
    ai: { enabled: ai, models: llm.MODELS, spend: llm.spend() },
    meta: { attorneyEmail: cf.me?.email || '', syncedAt: cf.syncedAt, source: cf.source, clioRequests: cf.clioRequests, items: cf.items.length, documents: cf.documents, matter: cf.matter, contacts: cf.contacts },
  };
}

function heuristicBrief(cf, facts, scores, today) {
  const { kpis, work, hero } = facts;
  const top10 = topItems(cf.items, scores, 10, today);
  const notes = cf.items.filter(i => i.kind === 'note' && i.date <= today);
  const byId = Object.fromEntries(scores.map(s => [s.id, s]));
  // One beat per era of the case: split the life of the file into 6 equal windows, take the strongest note in each.
  const start = new Date(hero.openDate || notes[0]?.date).getTime(), end = new Date(today).getTime();
  const beats = [];
  for (let w = 0; w < 6; w++) {
    const a = start + (end - start) * w / 6, b = start + (end - start) * (w + 1) / 6;
    const inWin = notes.filter(n => { const t = new Date(n.date).getTime(); return t >= a && t < b; });
    const best = inWin.sort((x, y) => byId[y.id].score - byId[x.id].score)[0];
    if (best) beats.push({ text: `${best.title}. ${keySentence(best.body)}`, cites: [best.id] });
  }
  const gap = facts.waterfall.gap;
  const headline = `${hero.stage}, ${Math.floor(hero.daysSinceDoi / 365)} years post-incident. Valued at ${fmt(kpis.caseValue.value)}${gap > 0 ? ` but recovery is capped at ${fmt(kpis.coverage.value)} of coverage` : ''}; ${work.overdue.length} overdue, ${work.waiting.length} waiting on others.`;
  const risks = [
    ...facts.flags.map(f => ({ title: f.label, detail: f.text, cites: f.src })),
    ...(kpis.lien.value ? [{ title: 'Lien comes off the top', detail: keySentence(kpis.lien.detail), cites: kpis.lien.src }] : []),
  ].slice(0, 5);
  const next = [...work.overdue, ...work.upcomingTasks.filter(t => !work.overdue.includes(t))]
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5)
    .map(t => ({ text: `${t.date < today ? `Overdue ${daysBetween(t.date, today)}d` : `Due ${nice(t.date)}`}: ${t.title.replace(/^By medical provider: /, 'Chase ')}`, cites: [t.id] }));
  return { headline, story: beats, top10, risks, next_moves: next };
}

// ---------- "What changed since I last opened this matter" ----------
export function changesSince(cf, userKey, { since } = {}) {
  const prev = db.prepare('SELECT seen_at, seen_ids FROM visits WHERE user_key = ? AND matter_id = ?').get(userKey, cf.matter.id);
  let changed, basis;
  if (since) {
    changed = cf.items.filter(i => i.date > since && i.date <= (process.env.AS_OF || new Date().toISOString().slice(0, 10)));
    basis = { type: 'date', since };
  } else if (prev) {
    const seen = new Set(JSON.parse(prev.seen_ids));
    changed = cf.items.filter(i => !seen.has(`${i.id}:${i.etag}`));
    basis = { type: 'visit', since: prev.seen_at };
  } else {
    changed = [];
    basis = { type: 'first-visit' };
  }
  return { basis, items: changed.map(i => i.id) };
}

export function markSeen(cf, userKey) {
  db.prepare('INSERT OR REPLACE INTO visits (user_key, matter_id, seen_at, seen_ids) VALUES (?, ?, ?, ?)')
    .run(userKey, cf.matter.id, new Date().toISOString(), JSON.stringify(cf.items.map(i => `${i.id}:${i.etag}`)));
}
