// CaseLight's own store, outside Clio: SQLite (node:sqlite, no dependency).
// Holds OAuth tokens, synced case snapshots, per-user "last opened" markers, the AI digest
// cache, provider share links and the log of who opened them.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const file = process.env.DB_FILE || path.resolve('data/caselight.db');
fs.mkdirSync(path.dirname(file), { recursive: true });
export const db = new DatabaseSync(file);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS snapshots (matter_id INTEGER, synced_at TEXT, data TEXT, PRIMARY KEY (matter_id, synced_at));
  CREATE TABLE IF NOT EXISTS visits (user_key TEXT, matter_id INTEGER, seen_at TEXT, seen_ids TEXT, PRIMARY KEY (user_key, matter_id));
  CREATE TABLE IF NOT EXISTS llm_cache (key TEXT PRIMARY KEY, model TEXT, created_at TEXT, input_tokens INTEGER, output_tokens INTEGER, value TEXT);
  CREATE TABLE IF NOT EXISTS shares (token TEXT PRIMARY KEY, matter_id INTEGER, provider_id INTEGER, provider_name TEXT,
    policy TEXT, note TEXT, created_at TEXT, revoked_at TEXT);
  CREATE TABLE IF NOT EXISTS share_views (token TEXT, viewed_at TEXT, ip TEXT, ua TEXT);
`);
// Added after v1: doctor "tell me when the case moves" opt-in.
try { db.exec('ALTER TABLE shares ADD COLUMN following INTEGER DEFAULT 0'); } catch {}

export const kv = {
  get: (k) => { const r = db.prepare('SELECT v FROM kv WHERE k = ?').get(k); return r ? JSON.parse(r.v) : null; },
  set: (k, v) => db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, JSON.stringify(v)),
};
