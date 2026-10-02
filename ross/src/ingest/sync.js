// Pulls one matter and everything hanging off it out of Clio (GET only), normalises it into
// a single CaseFile where every item carries a stable source reference, and extracts the text
// of every document page. The CaseFile is the only thing the digest layer ever reads.
import fs from 'node:fs/promises';
import path from 'node:path';
import { ClioReadOnlyClient, FIELDS } from '../clio/client.js';
import { CLIO_BASE, clioMode } from '../clio/oauth.js';
import { extractPdf, extractImages } from './extract.js';
import { db } from '../db.js';

const PHOTO_DIR = path.resolve('data/photos');
const webBase = () => process.env.CLIO_WEB_BASE || `${CLIO_BASE}/nc/#`;

export async function findMatter(clio) {
  if (process.env.CLIO_MATTER_ID) return Number(process.env.CLIO_MATTER_ID);
  const rows = await clio.all('matters.json', { query: process.env.CLIO_MATTER_QUERY || 'Sapini', fields: 'id,description,status' });
  if (!rows.length) throw new Error('No matter found in Clio matching "Sapini". Run the Swans setup app first.');
  return rows[0].id;
}

const partyName = (p) => p?.name || (p?.type === 'User' ? 'Firm' : 'Unknown');

export async function syncMatter({ onProgress = () => {} } = {}) {
  const clio = await ClioReadOnlyClient.fromEnv();
  const matterId = await findMatter(clio);
  onProgress('matter');
  const q = { matter_id: matterId };
  const [matter, relationships, notes, comms, tasks, events, activities, documents, me] = await Promise.all([
    clio.get(`matters/${matterId}.json`, { fields: FIELDS.matter }),
    clio.all('relationships.json', { ...q, fields: FIELDS.relationship }),
    clio.all('notes.json', { ...q, type: 'Matter', fields: FIELDS.note }),
    clio.all('communications.json', { ...q, fields: FIELDS.communication }),
    clio.all('tasks.json', { ...q, fields: FIELDS.task }),
    clio.all('calendar_entries.json', { ...q, fields: FIELDS.calendar_entry }),
    clio.all('activities.json', { ...q, type: 'ExpenseEntry', fields: FIELDS.activity }),
    clio.all('documents.json', { ...q, fields: FIELDS.document }),
    clio.get('users/who_am_i.json', { fields: 'id,name,email' }),
  ]);
  onProgress('contacts');
  const contactIds = [matter.client.id, ...relationships.map(r => r.contact.id)];
  const contacts = await Promise.all(contactIds.map(id => clio.get(`contacts/${id}.json`, { fields: FIELDS.contact })));
  const roleOf = Object.fromEntries(relationships.map(r => [r.contact.id, r.description]));
  roleOf[matter.client.id] = 'Client';

  const link = (section) => `${webBase()}/matters/${matterId}/${section}`;
  const items = [];
  for (const n of notes) items.push({ id: `note:${n.id}`, kind: 'note', date: n.date, title: n.subject, body: n.detail, etag: n.etag,
    author: n.author?.name, clioUrl: link('notes') });
  for (const c of comms) {
    const kind = /Phone/.test(c.type) ? 'call' : 'email';
    items.push({ id: `comm:${c.id}`, kind, date: c.date, title: c.subject, body: c.body, etag: c.etag,
      from: c.senders.map(partyName), to: c.receivers.map(partyName),
      parties: [...c.senders, ...c.receivers].filter(p => p.type === 'Contact').map(p => p.id), clioUrl: link('communications') });
  }
  for (const t of tasks) items.push({ id: `task:${t.id}`, kind: 'task', date: t.due_at?.slice(0, 10), title: t.name, body: t.description,
    status: t.status, sol: t.statute_of_limitations, etag: t.etag, clioUrl: link('tasks') });
  for (const e of events) items.push({ id: `event:${e.id}`, kind: 'event', date: e.start_at?.slice(0, 10), at: e.start_at, end: e.end_at,
    title: e.summary, body: e.description || '', etag: e.etag, clioUrl: link('calendar') });
  for (const a of activities) items.push({ id: `expense:${a.id}`, kind: 'expense', date: a.date, title: a.note.split('\n')[0],
    body: a.note, amount: a.total ?? a.price * a.quantity, etag: a.etag, clioUrl: link('activities') });

  const docs = [];
  let photo = null;
  // Fast path: the same PDFs ship in fixtures/, so use a local copy when name and size match Clio; download the rest in parallel.
  const local = new Map();
  const walk = async dir => { for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name); if (e.isDirectory()) await walk(p); else local.set(e.name, p); } };
  await walk(path.resolve('fixtures'));
  const bufs = await Promise.all(documents.map(async d => {
    const p = local.get(d.name);
    if (p) { const b = await fs.readFile(p); if (!d.size || b.length === d.size) return b; }
    return clio.download(d.id);
  }));
  // Keep each PDF on disk so page images and highlights never re-download it from Clio.
  await fs.mkdir(path.resolve('data/pages'), { recursive: true });
  await Promise.all(documents.map((d, i) => fs.writeFile(path.resolve('data/pages', `${d.id}.pdf`), bufs[i], { flag: 'wx' }).catch(() => {})));
  const texts = await Promise.all(bufs.map(b => extractPdf(b)));
  for (const [i, d] of documents.entries()) {
    onProgress('documents', i + 1, documents.length, d.name);
    const buf = bufs[i];
    const text = texts[i];
    docs.push({ id: `doc:${d.id}`, clioId: d.id, name: d.name, folder: d.parent?.name, receivedAt: (d.received_at || d.created_at)?.slice(0, 10),
      size: d.size, sha256: text.sha256, pageCount: text.pageCount, ocrPages: text.pages.filter(p => p.method === 'ocr').length, clioUrl: link('documents') });
    items.push({ id: `doc:${d.id}`, kind: 'document', date: (d.received_at || d.created_at)?.slice(0, 10), title: prettyDocName(d.name),
      body: `${d.parent?.name || ''} · ${text.pageCount} pages`, etag: d.etag, clioUrl: link('documents') });
    if (!photo && /photo[-_ ]?id|driver|licen[cs]e/i.test(d.name)) {
      const imgs = await extractImages(buf);
      if (imgs.length) {
        await fs.mkdir(PHOTO_DIR, { recursive: true });
        const biggest = imgs.sort((a, b) => b.length - a.length)[0];
        await fs.writeFile(path.join(PHOTO_DIR, `${d.id}.png`), biggest);
        photo = { docId: `doc:${d.id}`, url: `/media/photos/${d.id}.png` };
      }
    }
  }
  const cf = Object.fromEntries((matter.custom_field_values || []).map(v => [v.field_name, v.value]));
  const caseFile = {
    syncedAt: new Date().toISOString(),
    mode: clioMode(), source: clioMode() === 'live' ? 'Clio Manage (live)' : 'Clio v4 replica (fixtures)',
    clioRequests: clio.requests,
    me,
    matter: { id: matter.id, displayNumber: matter.display_number, description: matter.description, status: matter.status,
      openDate: matter.open_date, sol: matter.statute_of_limitations, stage: matter.matter_stage?.name,
      practiceArea: matter.practice_area?.name, attorney: matter.responsible_attorney?.name, clioUrl: `${webBase()}/matters/${matterId}`,
      updatedAt: matter.updated_at },
    customFields: cf,
    contacts: contacts.map(c => ({ id: c.id, name: c.name, type: c.type, role: roleOf[c.id], title: c.title, company: c.company?.name,
      dob: c.date_of_birth, email: c.email_addresses?.find(e => e.default_email)?.address || c.email_addresses?.[0]?.address,
      phone: c.phone_numbers?.[0]?.number, address: c.addresses?.[0] ? `${c.addresses[0].street}, ${c.addresses[0].city}, ${c.addresses[0].province}` : null })),
    clientId: matter.client.id,
    photo,
    documents: docs,
    items: items.sort((a, b) => (a.date || '').localeCompare(b.date || '')),
  };
  db.prepare('INSERT OR REPLACE INTO snapshots (matter_id, synced_at, data) VALUES (?, ?, ?)').run(matterId, caseFile.syncedAt, JSON.stringify(caseFile));
  return caseFile;
}

export function prettyDocName(name) {
  // "05-medical-bills__doc-20__records-and-bills-part2-pt-ortho-er-operative.pdf" -> "Records and bills part2 pt ortho er operative"
  const core = name.replace(/\.pdf$/i, '').split('__').pop().replace(/-/g, ' ');
  return core.charAt(0).toUpperCase() + core.slice(1);
}

export function latestSnapshot(matterId) {
  const r = matterId
    ? db.prepare('SELECT data FROM snapshots WHERE matter_id = ? ORDER BY synced_at DESC LIMIT 1').get(matterId)
    : db.prepare('SELECT data FROM snapshots ORDER BY synced_at DESC LIMIT 1').get();
  const cf = r ? JSON.parse(r.data) : null;
  // Never show a replica snapshot once connected to real Clio (or the reverse).
  return cf && (cf.mode || 'replica') === clioMode() ? cf : null;
}

export async function documentPages(caseFile, docId) {
  const d = caseFile.documents.find(x => x.id === docId);
  if (!d) return null;
  const cache = path.join(process.env.TEXT_CACHE_DIR || path.resolve('data/text-cache'), `${d.sha256}.json`);
  return { ...d, ...JSON.parse(await fs.readFile(cache, 'utf8')) };
}
