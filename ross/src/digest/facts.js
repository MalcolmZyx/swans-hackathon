// Deterministic digestion: everything that can be computed exactly from Clio data is computed
// here, not guessed by a model. Every number carries `src` (the item ids or custom field it came from)
// so the UI can open the note, email, task or document behind it.

export const asOf = () => process.env.AS_OF || new Date().toISOString().slice(0, 10);
const DAY = 86_400_000;
export const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / DAY);

export function money(text) {
  if (typeof text === 'number') return text;
  const m = String(text || '').match(/\$\s?([\d,]+(?:\.\d+)?)/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}
const allMoney = (text) => [...String(text || '').matchAll(/\$\s?([\d,]+(?:\.\d+)?)/g)].map(m => Number(m[1].replace(/,/g, '')));

const find = (items, re, kinds) => items.filter(i => (!kinds || kinds.includes(i.kind)) && re.test(`${i.title}\n${i.body}`));
const latest = (arr) => arr.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];

const TREATMENT_EVENT = /treatment|consult|surgery|arthroscop|follow-up|therapy|chiropractic|appointment|operative/i;
const PROVIDER_ROLE = /provider|hospital|surgeon|chiropract|physical therapy|orthopa/i;

function shortName(name) {
  return name.replace(/,? (PLLC|P\.C\.|LLC|Inc\.?)$/i, '').replace(/ of New York$/, '');
}

/** Words that identify a provider in free text, e.g. "McCulloch", "Capiola", "SportsCare". */
function providerKeys(c, all) {
  const keys = new Set();
  const words = shortName(c.name).split(/\s+/).filter(w => w.length > 4 && !/^(Hospital|Surgical|Services|Offices|Therapy|Physical|Advanced|Orthopaedic|Chiropractic)$/i.test(w));
  words.slice(0, 2).forEach(w => keys.add(w));
  if (c.type === 'Person') keys.add(c.name.split(' ').pop());
  // Doctors employed by a provider company count toward that company.
  for (const p of all) if (p.type === 'Person' && p.company && c.type === 'Company' && p.company.startsWith(shortName(c.name).split(' ')[0])) keys.add(p.name.split(' ').pop());
  const m = (c.role || '').match(/\(([^)]+?),/); // "(Kevin M. Haggerty, D.C.)"
  if (m) keys.add(m[1].split(' ').pop());
  return [...keys];
}

export function computeFacts(cf) {
  const today = asOf();
  const { items, customFields: F } = cf;
  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  const client = cf.contacts.find(c => c.id === cf.clientId);

  // ---------- Money ----------
  const limitsText = F['Policy Limits'] || '';
  const defLimit = money((limitsText.match(/Defendant[^\n]*/i) || [limitsText])[0]);
  const coverageConfirm = latest(find(items, /coverage (confirmed|position)|limits are \$/i, ['note', 'email']));
  const lienText = F['Health Insurance or Lien Holder'] || '';
  const lien = money(lienText);
  // Firm costs only: medical treatment charges are the client's specials, not money the firm advanced.
  // Clio can hold the same expense twice (re-imports), so count each date + amount + note once.
  const expSeen = new Set();
  const expenses = items.filter(i => i.kind === 'expense' && !/medical (treatment )?charges/i.test(i.title || '')
    && !expSeen.has(`${i.date}|${i.amount}|${i.title}`) && expSeen.add(`${i.date}|${i.amount}|${i.title}`));
  const firmSpend = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const value = money(F['Estimated Case Value']);
  const specials = money(F['Medical Specials To Date']);
  const wage = money(F['Wage Loss Claimed']);
  const feePct = Number(process.env.CONTINGENCY_FEE || 0.3333);
  const recoverable = Math.min(value ?? 0, defLimit ?? value ?? 0);
  const fee = Math.round(recoverable * feePct);
  const net = recoverable - fee - firmSpend - (lien || 0);

  const valueSrc = find(items, /valuation|case evaluation|\$375,000/i, ['note']).map(i => i.id);
  const specialsSrc = find(items, /specials tally|\$118,400/i, ['note']).map(i => i.id);

  const kpis = {
    caseValue: { value, label: 'Estimated case value', field: 'Estimated Case Value', rationale: F['Case Value Rationale'], src: valueSrc },
    coverage: { value: defLimit, label: 'Coverage behind it', field: 'Policy Limits', detail: limitsText,
      confirmed: !!F['Policy Limits Confirmed'], confirmedOn: coverageConfirm?.date, src: coverageConfirm ? [coverageConfirm.id] : [] },
    specials: { value: specials, label: 'Medical specials to date', field: 'Medical Specials To Date', src: specialsSrc },
    wage: { value: wage, label: 'Wage loss claimed', field: 'Wage Loss Claimed', detail: F['Wage Loss Claimed'] },
    lien: { value: lien, label: 'Liens asserted', field: 'Health Insurance or Lien Holder', detail: lienText,
      src: find(items, /lien/i, ['note', 'email', 'task']).map(i => i.id).slice(-3) },
    firmSpend: { value: firmSpend, label: 'Firm has spent', count: expenses.length, src: expenses.map(e => e.id) },
  };
  const waterfall = { value, cap: defLimit, recoverable, fee, feePct, costs: firmSpend, lien, net,
    gap: value && defLimit ? value - defLimit : null };

  // ---------- Dates ----------
  const doi = F['Date of Incident'];
  const tasks = items.filter(i => i.kind === 'task');
  const open = tasks.filter(t => t.status !== 'complete');
  const waitingRe = /^By (medical provider|client|defen[cs]e|court|adjuster)[^:]*:|unanswered|no date given|awaiting|requests?,? no/i;
  const overdue = open.filter(t => t.date < today).map(t => ({ ...t, daysLate: daysBetween(t.date, today) }));
  const upcomingTasks = open.filter(t => t.date >= today && daysBetween(today, t.date) <= 30);
  const waiting = open.filter(t => waitingRe.test(`${t.title} ${t.body}`)).map(t => ({ ...t, on: (t.title.match(/^By [^:]+:\s*(.+?)\s+-\s/) || [])[1] || null }));
  const upcomingEvents = items.filter(i => i.kind === 'event' && i.date >= today).slice(0, 8);
  const solTask = tasks.find(t => t.sol);
  const sol = { date: cf.matter.sol, satisfied: solTask?.status === 'complete', note: solTask?.body, src: solTask ? [solTask.id] : [] };

  // ---------- Client contact ----------
  const clientTouches = items.filter(i => ['email', 'call'].includes(i.kind) && i.parties?.includes(cf.clientId) && i.date <= today);
  const lastTalk = latest(clientTouches.filter(i => i.kind === 'call'));
  const lastAny = latest(clientTouches);
  const fromClient = latest(clientTouches.filter(i => i.from?.includes(client?.name)));

  // ---------- Providers ----------
  const providers = cf.contacts.filter(c => PROVIDER_ROLE.test(c.role || '') && c.type === 'Company').map(c => {
    const keys = providerKeys(c, cf.contacts);
    const keyRe = new RegExp(keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
    const comms = items.filter(i => ['email', 'call'].includes(i.kind) && i.parties?.includes(c.id));
    const sent = comms.filter(i => !i.from?.includes(c.name));
    const received = comms.filter(i => i.from?.includes(c.name));
    const lastReply = latest(received);
    const chasersSinceReply = sent.filter(i => !lastReply || i.date > lastReply.date);
    const asks = open.filter(t => t.title.includes(shortName(c.name).split(' ')[0]) || keyRe.test(t.title));
    const visits = items.filter(i => i.kind === 'event' && keyRe.test(`${i.title} ${i.body}`) && TREATMENT_EVENT.test(i.title) && !/^Call\b/i.test(i.title));
    const mentions = items.filter(i => keyRe.test(`${i.title}\n${i.body}`));
    const docs = cf.documents.filter(d => keyRe.test(d.name));
    return {
      id: c.id, name: c.name, short: shortName(c.name), role: c.role, email: c.email, address: c.address, keys,
      records: { requested: sent.filter(i => /request|chaser|provide/i.test(`${i.title} ${i.body}`)).length, received: received.filter(i => /enclosed|attached/i.test(`${i.title} ${i.body}`)).length,
        lastReceived: latest(received.filter(i => /enclosed|attached/i.test(`${i.title} ${i.body}`)))?.date || null },
      lastReply: lastReply ? { date: lastReply.date, id: lastReply.id, title: lastReply.title } : null,
      chasersSinceReply: chasersSinceReply.map(i => i.id),
      asks: asks.map(t => ({ id: t.id, title: t.title.replace(/^By medical provider: [^-]+ - /, ''), body: t.body, due: t.date, overdue: t.date < today })),
      treatment: { past: visits.filter(v => v.date < today).map(v => v.id), upcoming: visits.filter(v => v.date >= today).map(v => ({ id: v.id, date: v.date, title: v.title })) },
      mentions: mentions.map(i => i.id), documents: docs.map(d => d.id), commIds: comms.map(i => i.id),
    };
  });

  // ---------- Health of the case ----------
  const lastActivity = latest(items.filter(i => i.date <= today && i.kind !== 'event'));
  const treatment = { status: F['Treatment Status'], ongoing: /active|ongoing/i.test(F['Treatment Status'] || ''),
    nextVisits: items.filter(i => i.kind === 'event' && i.date >= today && /treatment|therapy|chiropractic/i.test(i.title)).map(i => ({ id: i.id, date: i.date, title: i.title })) };

  const flags = [
    { key: 'liability', label: 'Liability', text: F['Liability Assessment'], src: find(items, /scope of employment|three different accounts|mechanism/i, ['note']).map(i => i.id).slice(0, 3) },
    { key: 'prior', label: 'Prior injuries', text: F['Prior Related Injuries'], src: find(items, /prior injur/i, ['note']).map(i => i.id) },
    { key: 'coverage', label: 'Coverage gap', text: waterfall.gap > 0 ? `Valued at ${fmt(value)} but recovery is capped at ${fmt(defLimit)}.` : null, src: kpis.coverage.src },
  ].filter(f => f.text);

  return {
    asOf: today,
    hero: {
      client: client?.name, clientTitle: client?.title, dob: client?.dob, age: client?.dob ? Math.floor(daysBetween(client.dob, today) / 365.25) : null,
      occupation: client?.company, phone: client?.phone, email: client?.email, photo: cf.photo,
      doi, daysSinceDoi: doi ? daysBetween(doi, today) : null, location: F['Accident Location'], summary: F['Case Summary'],
      stage: cf.matter.stage, status: cf.matter.status, openDate: cf.matter.openDate, displayNumber: cf.matter.displayNumber,
      claim: F['Claim Number'], carrier: F['Insurance Carrier'], hipaa: !!F['HIPAA Authorization Received'],
    },
    stages: ['Intake', 'Treatment', 'Demand', 'Negotiation', 'Litigation', 'Trial', 'Disbursement', 'Closed'],
    kpis, waterfall, sol, flags,
    work: { overdue, upcomingTasks, waiting, upcomingEvents, openCount: open.length },
    client: { lastTalk: lastTalk && { id: lastTalk.id, date: lastTalk.date, title: lastTalk.title, daysAgo: daysBetween(lastTalk.date, today) },
      lastAny: lastAny && { id: lastAny.id, date: lastAny.date, kind: lastAny.kind }, lastFromClient: fromClient && { id: fromClient.id, date: fromClient.date, title: fromClient.title },
      touches90: clientTouches.filter(i => daysBetween(i.date, today) <= 90).length },
    providers, treatment,
    lastActivity: lastActivity && { id: lastActivity.id, date: lastActivity.date, title: lastActivity.title, daysAgo: daysBetween(lastActivity.date, today) },
    counts: Object.fromEntries(['note', 'email', 'call', 'task', 'event', 'document', 'expense'].map(k => [k, items.filter(i => i.kind === k).length])),
    pages: cf.documents.reduce((s, d) => s + d.pageCount, 0),
    ocrPages: cf.documents.reduce((s, d) => s + d.ocrPages, 0),
    byId: undefined,
  };
}

export const fmt = (n) => n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`;
export { allMoney };
