// What a treating provider sees. Built server-side from an explicit allow-list policy the attorney
// sets per provider; anything not allowed is never serialised, so it cannot leak through the client.
import { randomBytes } from 'node:crypto';
import { db } from '../db.js';
import { providerUpdate, aiEnabled } from '../digest/llm.js';
import { fmt } from '../digest/facts.js';

// Three switches in the Share sheet. "status" = case status + what we need; "treatment" = injuries,
// treatment and records; "coverage" = the insurance limit (off unless the attorney turns it on).
// Case value, internal notes, settlement talk and liens have no switch: they are never shared.
export const DEFAULT_POLICY = { status: true, treatment: true, coverage: false, hiddenItems: [], note: '' };
export const SHARE_DAYS = 30;
const expand = (p) => ({ ...p, milestones: p.status, asks: p.status, records: p.treatment, lien: false });

// Milestones a provider may see: public procedural events and treatment, never internal notes.
const MILESTONE = /summons|complaint|answer|bill of particulars|served|demand package|IME|examination|compliance conference|deposition|surgery|arthroscopy|discovery|coverage confirm|exhausted|lien/i;

export function milestoneCandidates(digest) {
  return digest.timeline
    .filter(i => ['email', 'event', 'document'].includes(i.kind) && i.date <= digest.facts.asOf && MILESTONE.test(i.title))
    .map(i => ({ id: i.id, date: i.date, kind: i.kind, title: providerSafeTitle(i) }))
    .reverse()
    .filter((m, k, arr) => arr.findIndex(x => norm(x.title) === norm(m.title)) === k);
}

const norm = (t) => t.toLowerCase().replace(/[^a-z]/g, '').slice(0, 28);
const nice = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function providerSafeTitle(i) {
  if (i.kind === 'document') return i.title.replace(/\b(ime|bop|mri)\b/gi, m => m.toUpperCase());
  return i.title.replace(/^RE: /, '').replace(/, claim SIR\d+/, '').replace(/Defendants? /i, 'Defense ');
}

export async function providerView(digest, providerId, policy0 = DEFAULT_POLICY, { withAi = true } = {}) {
  const policy = expand({ ...DEFAULT_POLICY, ...policy0 });
  const f = digest.facts;
  const p = f.providers.find(x => x.id === providerId);
  if (!p) return null;
  const view = { provider: { name: p.name, short: p.short }, patient: { name: f.hero.client, dob: f.hero.dob, doi: f.hero.doi },
    firm: { attorney: digest.meta.matter.attorney, name: process.env.FIRM_NAME || `${digest.meta.matter.attorney}'s office`, email: process.env.FIRM_EMAIL || digest.meta.attorneyEmail || '' }, asOf: f.asOf, note: policy.note || '' };

  if (policy.status) {
    view.status = { stage: f.hero.stage, stages: f.stages, open: f.hero.status === 'Open',
      lastMovement: f.lastActivity?.date, daysSinceMovement: f.lastActivity?.daysAgo, treatmentOngoing: f.treatment.ongoing };
  }
  if (policy.milestones) {
    const hidden = new Set(policy.hiddenItems || []);
    view.milestones = milestoneCandidates(digest).filter(m => !hidden.has(m.id)).slice(0, 12);
  }
  if (policy.asks) view.asks = p.asks.map(a => ({ title: a.title, detail: a.body, due: a.due, overdue: a.overdue }));
  if (policy.records) {
    view.records = { requested: p.records.requested, received: p.records.received, lastReceived: p.records.lastReceived,
      unansweredRequests: p.chasersSinceReply.length,
      onFile: digest.meta.documents.filter(d => p.documents.includes(d.id)).map(d => ({ name: d.name.split('__').pop(), pages: d.pageCount, received: d.receivedAt })) };
  }
  if (policy.treatment) view.injuries = (digest.injuries || []).slice(0, 6).map(r => r.region);
  if (policy.treatment) view.treatment = { ongoing: f.treatment.ongoing, upcoming: (p.treatment.upcoming.length ? p.treatment.upcoming : f.treatment.nextVisits || [])
    .filter(u => /treatment|therapy|chiro|visit|appointment/i.test(u.title) && !/call/i.test(u.title))
    // Other providers' names stay out of this provider's view: keep only the kind of care.
    .map(u => ({ date: u.date, title: (u.title.match(/:\s*([^,(]+)/)?.[1] || u.title).replace(/\s*\(.*$/, '').trim() })), pastVisitsOnCalendar: p.treatment.past.length };
  // The office's own side of the case: what it has billed on this matter and its visits on the firm's calendar.
  if (policy.treatment) {
    const key = (p.name.match(/[A-Z][a-z]{3,}/) || [p.name])[0];
    const seen = new Set();
    const bills = digest.timeline.filter(i => i.kind === 'expense' && /medical (treatment )?charges/i.test(i.title) && i.title.includes(key)
      && !seen.has(`${i.date}|${i.amount}`) && seen.add(`${i.date}|${i.amount}`));
    if (bills.length) {
      const span = bills.map(b => b.body.match(/services (\d{4}-\d\d-\d\d) to (\d{4}-\d\d-\d\d)/)).filter(Boolean);
      view.billing = { total: bills.reduce((t, b) => t + (b.amount || 0), 0), count: bills.length,
        from: span.map(m => m[1]).sort()[0] || null, to: span.map(m => m[2]).sort().at(-1) || null,
        status: /payment status unknown/i.test(bills.at(-1).body) ? 'Unpaid · on lien until the case resolves' : 'See statement',
        inSpecials: true };
    }
    view.visits = digest.timeline.filter(i => ['event', 'task'].includes(i.kind) && i.title.includes(key) && i.date && !/call|chaser|follow up|request/i.test(i.title))
      .sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8)
      .map(i => ({ date: i.date, title: (i.title.match(/^[^:,]+:\s*([^,(]+)/)?.[1] || i.title).replace(/\s*\(.*$/, '').trim(), upcoming: i.date > f.asOf }));
    view.provider.role = p.role || '';
  }
  if (policy.coverage) view.coverage = { liabilityLimit: f.kpis.coverage.value, confirmed: f.kpis.coverage.confirmed, confirmedOn: f.kpis.coverage.confirmedOn };
  if (policy.lien) view.lien = { amount: f.kpis.lien.value, holder: 'New York State Medicaid' };

  if (withAi && aiEnabled()) {
    try { view.update = await providerUpdate(view); view.updateSource = 'claude'; } catch (e) { view.updateError = e.message; }
  }
  if (!view.update) view.update = templateUpdate(view);
  return view;
}

function templateUpdate(v) {
  const bits = [];
  if (v.status) bits.push(`${v.patient.name.split(' ')[0]}'s case is open and in ${v.status.stage.toLowerCase()}${v.status.lastMovement ? `; it last moved on ${nice(v.status.lastMovement)}` : ''}.`);
  if (v.treatment?.ongoing) bits.push('Treatment is recorded as ongoing.');
  if (v.coverage) bits.push(`A ${fmt(v.coverage.liabilityLimit)} liability policy has been confirmed${v.coverage.confirmedOn ? ` in writing on ${nice(v.coverage.confirmedOn)}` : ''}.`);
  return { summary: bits.join(' '), asks: (v.asks || []).map(a => a.title) };
}

export function createShare({ matterId, providerId, providerName, policy, note }) {
  const token = randomBytes(18).toString('base64url');
  db.prepare('INSERT INTO shares (token, matter_id, provider_id, provider_name, policy, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(token, matterId, providerId, providerName, JSON.stringify(policy), note || '', new Date().toISOString());
  return token;
}

export function getShare(token) {
  const s = db.prepare('SELECT * FROM shares WHERE token = ?').get(token);
  return s && { ...s, policy: JSON.parse(s.policy), following: !!s.following, expiresAt: expiresAt(s), expired: Date.parse(expiresAt(s)) < Date.now() };
}

export function listShares(matterId) {
  return db.prepare('SELECT * FROM shares WHERE matter_id = ? ORDER BY created_at DESC').all(matterId).map(s => ({
    ...s, policy: JSON.parse(s.policy), following: !!s.following, expiresAt: expiresAt(s),
    views: db.prepare('SELECT viewed_at, ua FROM share_views WHERE token = ? ORDER BY viewed_at DESC').all(s.token),
  }));
}

export const logView = (token, req) => db.prepare('INSERT INTO share_views (token, viewed_at, ip, ua) VALUES (?, ?, ?, ?)')
  .run(token, new Date().toISOString(), req.socket.remoteAddress || '', (req.headers['user-agent'] || '').slice(0, 200));
export const revokeShare = (token) => db.prepare('UPDATE shares SET revoked_at = ? WHERE token = ?').run(new Date().toISOString(), token);

const expiresAt = (s) => new Date(Date.parse(s.created_at) + SHARE_DAYS * 864e5).toISOString();
export const setFollowing = (token, on) => db.prepare('UPDATE shares SET following = ? WHERE token = ?').run(on ? 1 : 0, token);
