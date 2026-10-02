// Local Clio Manage v4 replica, read-only.
//
// Swans ships the Sapini matter as Clio v4 *request bodies* (fixtures/sapini-clio-data.json).
// This module replays those bodies into an in-memory Clio and answers the same GET endpoints,
// with the same response envelope ({ data, meta.paging.next }), that app.clio.com does.
// CaseLight never knows which one it is talking to: point CLIO_BASE_URL at app.clio.com with an
// OAuth token and the exact same sync code runs against the team's live Clio account.
// Writes are refused here exactly as CaseLight's own client refuses to send them.
import fs from 'node:fs';
import path from 'node:path';

const FIXTURES = process.env.REPLICA_FIXTURES_DIR || path.resolve('fixtures');
const USER = { id: 344000001, name: 'Alex Rivera', email: 'arivera@cedarlaw.test', type: 'User' };

function load() {
  const src = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'sapini-clio-data.json'), 'utf8'));
  let seq = 1000;
  const id = (base) => base + (seq++);
  const ids = { contact: {}, field: {}, folder: {}, stage: {} };
  const db = { contacts: [], custom_fields: [], matters: [], relationships: [], folders: [], documents: [],
    notes: [], communications: [], tasks: [], calendar_entries: [], activities: [], matter_stages: [] };
  const stamp = (d) => (d && d.length === 10 ? `${d}T15:00:00Z` : d) || '2023-05-07T15:00:00Z';

  src.matter_stages.stages_in_order.forEach((name, i) => {
    const s = { id: 7700 + i, name, order: i + 1, practice_area: { id: 501, name: 'Personal Injury' } };
    ids.stage[name] = s.id; db.matter_stages.push(s);
  });
  for (const { body } of src.custom_fields.items) {
    const f = { id: id(880000), ...body }; ids.field[body.name] = f.id; db.custom_fields.push(f);
  }
  for (const { ref, body } of src.contacts.items) {
    const name = body.type === 'Person' ? `${body.first_name} ${body.last_name}` : body.name;
    const c = { id: id(2100000), name, ...body, company: body.company ? { name: body.company } : null,
      created_at: '2023-05-07T15:00:00Z', updated_at: '2023-05-07T15:00:00Z' };
    ids.contact[ref] = c.id; db.contacts.push(c);
  }
  const contactRef = (c) => c && { id: c.id, name: c.name, type: 'Contact' };
  const byId = (coll, i) => db[coll].find(x => x.id === i);
  const resolve = (s) => {
    if (typeof s !== 'string') return s;
    if (s === '{{user_id}}' || s === '{{calendar_id}}') return USER.id;
    if (s === '{{matter_id}}') return matterId;
    if (s === '{{practice_area_id}}') return 501;
    const m = s.match(/^\{\{(contact|field|folder|stage):(.+)\}\}$/);
    return m ? ids[m[1]][m[2]] : s;
  };
  const deep = (o) => Array.isArray(o) ? o.map(deep) : o && typeof o === 'object'
    ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, deep(v)])) : resolve(o);

  const matterId = 1560000123;
  const mb = deep(src.matter.body);
  const stageName = src.matter_stages.sapini_stage;
  db.matters.push({
    id: matterId, etag: '"m1"', display_number: '00042-Sapini', number: 42,
    description: mb.description, status: mb.status, open_date: mb.open_date, close_date: null,
    statute_of_limitations: mb.statute_of_limitations,
    client: contactRef(byId('contacts', mb.client.id)),
    practice_area: { id: 501, name: 'Personal Injury' },
    matter_stage: { id: ids.stage[stageName], name: stageName },
    responsible_attorney: { id: USER.id, name: USER.name },
    custom_field_values: mb.custom_field_values.map((v, i) => {
      const f = byId('custom_fields', v.custom_field.id);
      return { id: `${f.field_type}-${9000 + i}`, field_name: f.name, field_type: f.field_type, value: v.value, custom_field: { id: f.id } };
    }),
    created_at: '2023-05-07T15:00:00Z', updated_at: '2026-09-25T15:00:00Z',
  });
  const party = (p) => p.type === 'User' ? { ...USER } : contactRef(byId('contacts', p.id));

  for (const { body } of src.relationships.items) {
    const b = deep(body);
    db.relationships.push({ id: id(330000), description: b.description, matter: { id: matterId }, contact: contactRef(byId('contacts', b.contact.id)) });
  }
  for (const { body } of src.folders.items) {
    const f = { id: id(4400000), name: body.name, parent: { id: matterId, type: 'Matter' }, type: 'Folder' };
    ids.folder[body.name] = f.id; db.folders.push(f);
  }
  for (const item of src.documents.items) {
    const b = deep(item.body);
    const folder = byId('folders', b.parent.id);
    db.documents.push({ id: id(5500000), name: b.name, type: 'Document', content_type: 'application/pdf', size: item.bytes,
      received_at: b.received_at, created_at: b.received_at, updated_at: b.received_at,
      parent: { id: folder.id, name: folder.name, type: 'Folder' }, matter: { id: matterId },
      latest_document_version: { uuid: item.sha256.slice(0, 32), size: item.bytes, fully_uploaded: true },
      _local_path: path.join(FIXTURES, item.local_path) });
  }
  for (const { body } of src.notes.items) {
    const b = deep(body);
    db.notes.push({ id: id(6600000), type: 'Matter', subject: b.subject, detail: b.detail, date: b.date,
      matter: { id: matterId }, author: { id: USER.id, name: USER.name }, created_at: stamp(b.date), updated_at: stamp(b.date) });
  }
  for (const { body } of src.communications.items) {
    const b = deep(body);
    db.communications.push({ id: id(7700000), type: b.type, subject: b.subject, body: b.body, date: b.date,
      matter: { id: matterId }, senders: b.senders.map(party), receivers: b.receivers.map(party),
      created_at: stamp(b.date), updated_at: stamp(b.date) });
  }
  for (const { body } of src.tasks.items) {
    const b = deep(body);
    db.tasks.push({ id: id(8800000), name: b.name, description: b.description, due_at: b.due_at, status: b.status,
      priority: b.statute_of_limitations ? 'High' : 'Normal', statute_of_limitations: !!b.statute_of_limitations,
      matter: { id: matterId }, assignee: { id: USER.id, name: USER.name, type: 'User' },
      completed_at: b.status === 'complete' ? stamp(b.due_at) : null, created_at: '2023-05-07T15:00:00Z', updated_at: stamp(b.due_at) });
  }
  for (const { body } of src.calendar_entries.items) {
    const b = deep(body);
    db.calendar_entries.push({ id: id(9900000), summary: b.summary, description: b.description, start_at: b.start_at, end_at: b.end_at,
      all_day: false, matter: { id: matterId }, calendar_owner: { id: USER.id, name: USER.name }, created_at: b.start_at, updated_at: b.start_at });
  }
  for (const { body } of src.expenses.items) {
    const b = deep(body);
    db.activities.push({ id: id(1110000), type: b.type, date: b.date, quantity: b.quantity, price: b.price, total: b.quantity * b.price,
      note: b.note, matter: { id: matterId }, user: { id: USER.id, name: USER.name }, created_at: stamp(b.date), updated_at: stamp(b.date) });
  }
  return db;
}

let DB;
const db = () => (DB ??= load());
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')));

function page(req, url, rows) {
  const limit = Math.min(Number(url.searchParams.get('limit') || 200), 200);
  const offset = Number(url.searchParams.get('page_token') || 0);
  const slice = rows.slice(offset, offset + limit).map(strip);
  const meta = { records: rows.length, paging: {} };
  if (offset + limit < rows.length) {
    const next = new URL(url); next.searchParams.set('page_token', String(offset + limit));
    meta.paging.next = next.toString();
  }
  return { data: slice, meta };
}

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

/** Mounted under /replica/api/v4. Returns true if it handled the request. */
export function handleReplica(req, res, url) {
  const m = url.pathname.match(/^\/replica\/api\/v4\/(.+?)(?:\.json)?$/);
  if (!m) return false;
  if (req.method !== 'GET') { send(res, 405, { error: { type: 'ReadOnly', message: 'CaseLight replica is read-only' } }); return true; }
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) { send(res, 401, { error: { type: 'Unauthorized' } }); return true; }

  const parts = m[1].split('/');
  const coll = parts[0];
  const d = db();
  const matterFilter = Number(url.searchParams.get('matter_id') || 0);
  const forMatter = (rows) => matterFilter ? rows.filter(r => r.matter?.id === matterFilter || r.parent?.id === matterFilter) : rows;

  if (coll === 'users' && parts[1] === 'who_am_i') return send(res, 200, { data: USER }), true;
  if (coll === 'documents' && parts[2] === 'download') {
    const doc = d.documents.find(x => x.id === Number(parts[1]));
    if (!doc) return send(res, 404, { error: { type: 'NotFound' } }), true;
    return send(res, 200, fs.readFileSync(doc._local_path), 'application/pdf'), true;
  }
  if (!(coll in d)) return send(res, 404, { error: { type: 'NotFound', message: coll } }), true;
  if (parts[1]) {
    const row = d[coll].find(x => String(x.id) === parts[1]);
    return row ? send(res, 200, { data: strip(row) }) : send(res, 404, { error: { type: 'NotFound' } }), true;
  }
  let rows = forMatter(d[coll]);
  const type = url.searchParams.get('type');
  if (type && coll === 'activities') rows = rows.filter(r => r.type === type);
  const since = url.searchParams.get('updated_since');
  if (since) rows = rows.filter(r => !r.updated_at || r.updated_at >= since);
  send(res, 200, page(req, url, rows));
  return true;
}
