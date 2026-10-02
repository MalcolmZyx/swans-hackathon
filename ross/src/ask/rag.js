// Ask: retrieval over everything synced from Clio for this matter (notes, emails, calls, tasks,
// calendar, expenses and every OCR'd document page). BM25 picks passages; Claude answers only from
// them with numbered cites when an API key is set, otherwise the best sentences are quoted verbatim.
// Below a relevance floor the answer is "Not in the file." rather than a guess.
import { documentPages } from '../ingest/sync.js';
import * as llm from '../digest/llm.js';

const STOP = new Set('say said says show showed shows conclude concluded find found happen happened still need needs going go think mean doing like give gave current currently a an the of to in on for and or is are was were be been it its this that what when where who whom which how why do does did has have had with by at as from about any there their his her he she they we our you your i me my can could would should will not no yes get got much many does tell me know file case than then so if into out up down over under again just also any all'.split(' '));
const tok = (s) => (s.toLowerCase().replace(/paed/g, 'ped').replace(/haem/g, 'hem').match(/[a-z0-9$][a-z0-9$.,-]*[a-z0-9]|[a-z0-9]/g) || []).map(w => w.replace(/[.,]/g, '')).filter(w => w.length > 1 && !STOP.has(w)).map(stem);
// Everyday words a lawyer uses for what the file says another way. Matching one counts as matching the term.
const SYN = { coverage: ['limit', 'policy', 'insurance', 'insurer'], insurance: ['coverage', 'policy', 'limit'], surgery: ['arthroscopy', 'operation', 'operative', 'repair'], injury: ['tear', 'diagnosis', 'fracture'], injuries: ['tear', 'diagnosis'], doctor: ['dr', 'physician'], paid: ['payment', 'paid'], owe: ['lien'], settle: ['offer', 'negotiation'], settlement: ['offer', 'negotiation'], adjuster: ['claim', 'carrier'], hurt: ['pain', 'injury'], job: ['employ', 'wage'], income: ['wage', 'earning'], salary: ['wage', 'earning'], court: ['summon', 'complaint', 'index'], surgeon: ['dr', 'orthopedic', 'surgery', 'surgical'], orthopedic: ['ortho', 'surgeon'], treating: ['treatment', 'provider', 'physician'], lawyer: ['attorney', 'counsel'], attorney: ['counsel', 'esq'], accident: ['crash', 'collision', 'incident'], crash: ['accident', 'collision', 'incident'], car: ['vehicle', 'auto'], employer: ['employ', 'company'], work: ['employ', 'job', 'wage'], pt: ['physical', 'therapy'], therapy: ['pt', 'physical', 'rehab'], deposition: ['ebt', 'examination'], ime: ['independent', 'examination'], medicaid: ['lien'], expert: ['report', 'witness'] };
const matchCount = (text, terms) => { const have = new Set(tok(text)); return terms.filter(t => have.has(t) || syns(t).some(x => have.has(x))).length; };
const syns = (t) => (SYN[t] || []).map(stem);
const stem = (w) => { if (w.length > 4) w = w.replace(/(ings?|ed|es|s)$/, ''); return w.length >= 7 && !/\d/.test(w) ? w.slice(0, 6) : w; };
// Clio stores some text HTML-escaped; answers and highlights need the plain characters.
const dec = (t) => String(t || '').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
const nice = (d) => d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';

let built = null;

async function index(cf) {
  if (built?.syncedAt === cf.syncedAt) return built;
  const chunks = [];
  for (const i of cf.items) {
    if (i.kind === 'document') continue;
    const text = `${i.title}\n${i.body || ''}`;
    for (const part of split(text, 900)) chunks.push({ key: i.id, id: i.id, title: i.title, date: i.date, kind: i.kind, text: part, label: `${i.kind} · ${nice(i.date)} · ${i.title}` });
  }
  for (const d of cf.documents) {
    const doc = await documentPages(cf, d.id).catch(() => null);
    for (const p of doc?.pages || []) {
      for (const part of split(p.text || '', 1200)) {
        chunks.push({ key: `${d.id}#${p.page}`, id: d.id, docId: d.id, page: p.page, title: `${prettyName(d.name)}, p.${p.page}`, date: d.receivedAt, kind: 'page', text: part,
          label: `document page · ${prettyName(d.name)} p.${p.page}` });
      }
    }
  }
  const df = new Map();
  let total = 0;
  for (const c of chunks) {
    c.tokens = tok(`${c.title} ${c.text}`); total += c.tokens.length;
    c.tf = new Map(); for (const t of c.tokens) c.tf.set(t, (c.tf.get(t) || 0) + 1);
    for (const t of c.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  }
  built = { syncedAt: cf.syncedAt, chunks, df, avg: total / Math.max(1, chunks.length), N: chunks.length };
  return built;
}

function split(text, size) {
  const clean = text.replace(/[ \t]+/g, ' ').trim();
  if (clean.length <= size) return clean ? [clean] : [];
  const out = [];
  for (let k = 0; k < clean.length; k += size - 150) out.push(clean.slice(k, k + size));
  return out;
}
const prettyName = (n) => n.split('__').pop().replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ');

function search(ix, q, k = 8) {
  const terms = [...new Set(tok(q))].filter(t => ix.df.has(t) || syns(t).some(x => ix.df.has(x)));
  const idf = (t) => Math.log(1 + (ix.N - ix.df.get(t) + 0.5) / (ix.df.get(t) + 0.5));
  const bm = (c, t, w = 1) => { const f = c.tf.get(t); return f ? w * idf(t) * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * c.tokens.length / ix.avg)) : 0; };
  const scored = [];
  for (const c of ix.chunks) {
    let s = 0, hit = 0;
    for (const t of terms) {
      let part = ix.df.has(t) ? bm(c, t) : 0;
      if (!part) for (const x of syns(t)) if (ix.df.has(x)) part = Math.max(part, bm(c, x, 0.6));
      if (part) { hit++; s += part; }
    }
    // Firm records (notes, emails, tasks) explain; scanned pages corroborate. Nudge toward the former.
    if (s) scored.push({ c, s: s * (c.kind === 'page' ? 0.85 : c.kind === 'expense' ? 0.4 : 1), coverage: hit / Math.max(1, terms.length) });
  }
  scored.sort((a, b) => b.s - a.s);
  const seen = new Set(), out = [];
  for (const r of scored) { if (seen.has(r.c.key)) continue; seen.add(r.c.key); out.push(r); if (out.length >= k) break; }
  return { terms, results: out, asked: tok(q).length };
}

// A quoted sentence must itself cover the question: every term for short questions, two thirds for long ones.
const need = (terms) => terms.length <= 1 ? terms.length : terms.length <= 3 ? terms.length - 1 : Math.ceil(terms.length * 2 / 3);
const DATE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b20\d\d-\d\d-\d\d\b/i;
const MONEY = /\$\s?\d/;
function bestSentences(text, terms, n = 2, want = {}, dated = false) {
  const sents = text.replace(/([a-z,;])\s*\n\s*([a-z])/g, '$1 $2').split(/\n+|(?<=[.!?])\s+(?=[A-Z$(])/).map(x => x.trim()).filter(s => s.length > 35 && s.length < 400 && /^[A-Z0-9$"(“]/.test(s));
  return sents.map(s => ({ s, sc: matchCount(s, terms) })).filter(x => x.sc >= need(terms) && (!want.date || dated || DATE.test(x.s)) && (!want.money || MONEY.test(x.s))).sort((a, b) => (b.sc + Math.min(b.s.length, 240) / 400) - (a.sc + Math.min(a.s.length, 240) / 400)).slice(0, n).map(x => x.s.trim());
}

// The sentence on a cited passage that matches the question best: what the UI highlights at the source.
function topSentence(c, terms) {
  let body = c.text.startsWith(c.title) ? c.text.slice(c.title.length) : c.text;
  // Scanned pages wrap lines mid-sentence; join them so the highlight covers the whole finding.
  if (c.kind === 'page') body = body.replace(/\s*\n\s*/g, ' ');
  const sents = body.split(/\n+|(?<=[.!?])\s+(?=[A-Z$(])/).map(x => x.trim()).filter(x => x.length > 25 && x.length < 400);
  const scored = sents.map(x => ({ x, sc: matchCount(x, terms) })).sort((a, b) => b.sc - a.sc);
  return scored[0]?.sc ? scored[0].x : (sents[0] || body.trim().slice(0, 220));
}

const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const day = (d) => nice(String(d).slice(0, 10));
const amt = (n) => new RegExp(`\\$\\s?${Math.round(n).toLocaleString('en-US').replace(/,/g, ',?')}`);
function factAnswer(q, f, ix) {
  const k = f.kpis || {}, h = f.hero || {}, w = f.waterfall || {};
  if (/\b(worth|case value|value of the case|valued)\b/i.test(q) && k.caseValue?.value != null)
    return { text: `${usd(k.caseValue.value)}.${w.cap && w.cap < k.caseValue.value ? ` But recovery is capped at the ${usd(w.cap)} policy unless a second defendant is reached.` : ''}`, src: k.caseValue.src || [], match: amt(k.caseValue.value) };
  if (/\b(policy limits?|limits|coverage|insurance)\b/i.test(q) && !/health insurance|medicaid|lien/i.test(q) && k.coverage?.value != null)
    return { text: `The defendant's liability policy is ${usd(k.coverage.value)}${k.coverage.confirmed ? `, confirmed in writing${k.coverage.confirmedOn ? ` on ${day(k.coverage.confirmedOn)}` : ''}` : ', not yet confirmed in writing'}.`, src: k.coverage.src || [], match: amt(k.coverage.value) };
  if (/\b(lien|medicaid)\b/i.test(q) && k.lien?.value != null)
    return { text: `${usd(k.lien.value)}. ${String(k.lien.detail || '').split(/(?<=\.)\s/)[0]}`.trim(), src: k.lien.src || [], match: amt(k.lien.value) };
  if (/\b(medical bills|specials|medical (costs|expenses|charges))\b/i.test(q) && k.specials?.value != null)
    return { text: `${usd(k.specials.value)} in medical specials to date.`, src: k.specials.src || [], match: amt(k.specials.value) };
  if (/\b(wage|lost (earnings|income|wages))\b/i.test(q) && k.wage?.value != null)
    return { text: `${usd(k.wage.value)} in wage loss is claimed.`, src: [], match: amt(k.wage.value) };
  if (/\bwhen\b.*\b(accident|crash|collision|incident|injured|hurt)\b|\bdate of (the )?(accident|incident|loss)\b/i.test(q) && h.doi)
    return { text: `${day(h.doi)}${h.location ? `, ${h.location}` : ''}.`, src: [], match: /April 23, 2023|Apr(il)?\.? 23|4\/23\/2023|2023-04-23/i };
  if (/statute of limitations|\bsol\b|limitations (date|period)/i.test(q) && (f.sol?.date || f.sol?.src?.length)) {
    const due = typeof f.sol.date === 'string' ? f.sol.date : ix.chunks.find(c => c.id === f.sol.src?.[0])?.date;
    return { text: `${due ? `${day(due)}. ` : ''}${f.sol.satisfied ? 'Satisfied: the notice of claim was served and suit was commenced in time.' : 'Not yet satisfied.'}`, src: f.sol.src || [], match: /limitation|satisfied/i };
  }
  if (/\bhow did\b.*\b(happen|accident|crash|occur)|\bwhat happened\b|\bhow was he (hurt|injured)\b/i.test(q) && h.summary)
    return { text: `${h.summary}${h.doi ? ` It happened on ${day(h.doi)}.` : ''}`, src: [], match: /Metro-North|sideswip|Cedar Street|collision|struck/i };
  const provs = f.providers || [];
  const named = provs.find(p => p.name.split(/[\s,]+/).some(w => w.length > 4 && !/(services|medical|provider|offices|associates|surgical|physical|therapy|center|hospital)/i.test(w) && new RegExp(`\\b${w}`, 'i').test(q)));
  if (named && /\b(need|want|waiting|outstanding|owe|asked)\b/i.test(q))
    return { text: named.asks?.length ? `${named.asks.map(a => a.title).join('; ')}.${named.asks.some(a => a.overdue) ? ' It is overdue.' : ''}` : `Nothing is outstanding from ${named.short || named.name}.`, src: (named.asks || []).map(a => a.id).filter(Boolean), match: new RegExp(named.name.split(/[\s,]+/)[0], 'i') };
  if (/\bwho\b.*\b(doctors?|surgeons?|providers?|treating|orthop|chiropract|physical therap)/i.test(q) && provs.length) {
    const want = /surgeon|orthop/i.test(q) ? provs.filter(p => /orthop|surg/i.test(p.role || '')) : /chiro/i.test(q) ? provs.filter(p => /chiro/i.test(p.role || '')) : /therap/i.test(q) ? provs.filter(p => /therap/i.test(p.role || '')) : provs.filter(p => /treating/i.test(p.role || ''));
    const list = (want.length ? want : provs).slice(0, 4);
    return { text: list.map(p => `${p.name}: ${String(p.role || '').replace(/^(Treating provider|Medical provider):?,?\s*/i, '')}`).join('. ') + '.', src: [], match: new RegExp(list.map(p => p.name.split(/[\s,]+/)[0].replace(/[^\w]/g, '')).join('|'), 'i') };
  }
  return null;
}

export async function ask(cf, question, facts = null) {
  const q = String(question || '').slice(0, 500).trim();
  if (!q) return { answer: '', cites: [], notFound: true, source: 'none' };
  const ix = await index(cf);
  const { terms, results, asked } = search(ix, q);
  const top = results[0];
  // Relevance floor: the best passage must contain most of what was asked about.
  const weak = !top || top.coverage < (terms.length >= 3 ? 0.6 : 0.99) || terms.length < Math.min(2, asked);
  const passages = results.slice(0, 6).map(r => r.c);
  const toCite = (c, n) => ({ n, id: c.id, docId: c.docId || null, page: c.page || null, title: dec(c.title), date: c.date, kind: c.kind, snippet: dec(topSentence(c, terms)) });
  // Numbers are never AI: questions about the case's key figures are answered from the computed facts, with their sources.
  const fact = facts && factAnswer(q, facts, ix);
  if (fact) {
    const byKey = new Map(ix.chunks.map(c => [c.id, c]));
    const own = fact.src.map(id => byKey.get(id)).filter(c => c && fact.match.test(c.text));
    const firm = ix.chunks.filter(c => c.kind !== 'page' && c.kind !== 'expense' && fact.match.test(c.text));
    const pages = ix.chunks.filter(c => c.kind === 'page' && fact.match.test(c.text));
    const backup = [...new Map([...own, ...passages.filter(c => fact.match.test(c.text)), ...firm, ...pages].map(c => [c.key, c])).values()].slice(0, 2);
    const page = backup.some(c => c.kind === 'page') ? null : ix.chunks.find(c => c.kind === 'page' && fact.match.test(c.text));
    if (page) backup.push(page);
    if (backup.length) return { answer: `${fact.text} ${backup.map((_, k) => `[${k + 1}]`).join('')}`, cites: backup.map((c, k) => ({ ...toCite(c, k + 1), snippet: dec(c.text.split(/\n+|(?<=[.!?])\s+/).find(x => fact.match.test(x)) || topSentence(c, terms)) })), notFound: false, source: 'facts' };
  }
  const nearest = passages.slice(0, 3).map((c, k) => toCite(c, k + 1));

  if (llm.askEnabled() && passages.length) {
    try {
      const r = await llm.askCase(q, passages);
      const used = [...new Set(r.cites)].filter(n => n >= 1 && n <= passages.length);
      if (r.not_in_file || !used.length) return { answer: 'Not in the file.', cites: [], nearest, notFound: true, source: 'claude' };
      // Renumber cites 1..k in order of use so the text and the list agree.
      const map = new Map(used.map((n, k) => [n, k + 1]));
      const answer = r.answer.replace(/\[(\d+)\]/g, (m, n) => map.has(+n) ? `[${map.get(+n)}]` : '');
      return { answer, cites: used.map(n => toCite(passages[n - 1], map.get(n))), notFound: false, source: 'claude' };
    } catch (e) { console.error('ask:', e.message); }
  }
  if (weak) return { answer: 'Not in the file.', cites: [], nearest, notFound: true, source: 'search' };
  // "When / what date" questions must be answered by a sentence with a date in it; "how much" by an amount.
  const want = { date: /\b(when|date|dated)\b/i.test(q), money: /\b(how much|limits?|amount|worth|value|cost)\b/i.test(q) };
  const dateTerms = want.date ? terms.filter(t => !['date', 'dated'].includes(t)) : terms;
  const picked = [];
  for (const c of passages.slice(0, 4)) {
    const dated = want.date && c.kind !== 'page' && c.date;
    // Quote the body, not the entry's own title line.
    const bodyText = c.text.startsWith(c.title) ? c.text.slice(c.title.length) : c.text;
    let s = bestSentences(bodyText, dateTerms, 1, want, dated)[0];
    if (s && dated && !DATE.test(s)) s = `${s.replace(/[.\s]+$/, '')} (${nice(c.date)}).`;
    if (s && !picked.some(p => p.s === s)) picked.push({ s, c });
    if (picked.length === 2) break;
  }
  // Always back the answer with the record itself when a document page supports it, so it can be opened.
  if (picked.length && !picked.some(p => p.c.kind === 'page')) {
    const wide = search(ix, q, 40).results.map(r => r.c).filter(c => c.kind === 'page').slice(0, 12);
    // Prefer the page that says what the answer says (e.g. the radiology finding, not a list that names the MRI).
    const said = [...new Set(tok(picked[0].s))].filter(t => !terms.includes(t));
    let best = null;
    for (const c of wide) {
      for (const s of bestSentences(c.text, terms.length > 2 ? terms : dateTerms, 4, want, false)) {
        if (matchCount(s, terms) < Math.max(2, need(terms)) || picked.some(p => p.s === s)) continue;
        const sc = matchCount(s, terms) + 2 * matchCount(s, said);
        if (!best || sc > best.sc) best = { s, c, sc };
      }
    }
    if (best) picked.push({ s: best.s, c: best.c, quiet: true });
  }
  if (!picked.length) return { answer: 'Not in the file.', cites: [], nearest, notFound: true, source: 'search' };
  // A supporting page is cited after the answer rather than quoted into it.
  const cites = picked.map((p, k) => ({ ...toCite(p.c, k + 1), ...(p.quiet ? { snippet: dec(p.s) } : {}) }));
  return { answer: dec(picked.map((p, k) => p.quiet ? `[${k + 1}]` : `${p.s} [${k + 1}]`).join(' ')), cites, notFound: false, source: 'search' };
}
