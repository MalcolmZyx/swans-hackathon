// CaseLight HTTP server. Zero framework: node:http + static files.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { handleReplica } from './clio/replica.js';
import { authorizeUrl, exchangeCode, redirectUri, hasCredentials, clioMode, disconnect, CLIO_BASE } from './clio/oauth.js';
import { ClioReadOnlyClient } from './clio/client.js';
import { syncMatter, latestSnapshot, documentPages } from './ingest/sync.js';
import { buildDigest, changesSince, markSeen } from './digest/index.js';
import { providerView, createShare, getShare, listShares, logView, revokeShare, milestoneCandidates, DEFAULT_POLICY, setFollowing } from './share/provider.js';
import { kv } from './db.js';
import { ask } from './ask/rag.js';
import { ensurePdf, locate } from './ingest/pagebox.js';

const run = promisify(execFile);
// Listen where the Clio app's registered redirect URI points (127.0.0.1:3000/callback by default).
const REDIRECT = new URL(redirectUri());
const PORT = Number(process.env.PORT || REDIRECT.port || 3000);
process.env.PORT = String(PORT);
const PUBLIC = path.resolve('public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

let state = { caseFile: null, digest: null, syncing: null, progress: null };

async function ensureCase() {
  if (state.digest) return state;
  state.caseFile ??= latestSnapshot();
  if (!state.caseFile) await doSync();
  state.digest ??= await buildDigest(state.caseFile);
  return state;
}

async function doSync() {
  state.syncing ??= (async () => {
    try {
      state.caseFile = await syncMatter({ onProgress: (...a) => (state.progress = a) });
      state.digest = await buildDigest(state.caseFile);
    } finally { state.syncing = null; state.progress = null; }
  })();
  return state.syncing;
}

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
async function body(req) { let s = ''; for await (const c of req) s += c; return s ? JSON.parse(s) : {}; }
const userKey = (req) => (req.headers.cookie?.match(/cl_user=([\w-]+)/) || [])[1] || 'default';

async function serveFile(res, file) {
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}

const routes = [
  ['GET', /^\/api\/case$/, async (req, res, m, url) => {
    const { caseFile, digest } = await ensureCase();
    const changes = changesSince(caseFile, userKey(req), { since: url.searchParams.get('since') });
    json(res, 200, { ...digest, changes });
  }],
  ['POST', /^\/api\/sync$/, async (req, res) => {
    await doSync();
    json(res, 200, { ok: true, syncedAt: state.caseFile.syncedAt });
  }],
  ['GET', /^\/api\/sync\/progress$/, async (req, res) => json(res, 200, { syncing: !!state.syncing, progress: state.progress })],
  ['POST', /^\/api\/seen$/, async (req, res) => { const { caseFile } = await ensureCase(); markSeen(caseFile, userKey(req)); json(res, 200, { ok: true }); }],
  ['GET', /^\/api\/doc\/([\w:%]+)\/pages$/, async (req, res, m) => {
    const { caseFile } = await ensureCase();
    const d = await documentPages(caseFile, decodeURIComponent(m[1]));
    d ? json(res, 200, d) : json(res, 404, { error: 'not found' });
  }],
  ['GET', /^\/media\/page\/(\d+)\/(\d+)\.png$/, async (req, res, m) => {
    const [, docId, page] = m;
    const file = path.resolve(`data/pages/${docId}-${page}.png`);
    try { await fs.access(file); } catch {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const pdf = await ensurePdf(docId);
      await run('pdftoppm', ['-r', '110', '-png', '-f', page, '-l', page, '-singlefile', pdf, file.replace(/\.png$/, '')]);
    }
    serveFile(res, file);
  }],
  // The cited document itself, so "Open PDF" lands on the cited page (#page=N) in the browser's viewer.
  ['GET', /^\/media\/doc\/(\d+)\.pdf$/, async (req, res, m) => {
    const { caseFile } = await ensureCase();
    if (!caseFile.documents.some(d => d.clioId === Number(m[1]))) return json(res, 404, { error: 'not in this matter' });
    const buf = await fs.readFile(await ensurePdf(m[1]));
    res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': 'inline', 'cache-control': 'no-cache' }); res.end(buf);
  }],
  // Where a cited passage sits on a page, as page fractions, for the highlight overlay.
  ['GET', /^\/api\/doc\/(\d+)\/page\/(\d+)\/locate$/, async (req, res, m, url) => {
    const { caseFile } = await ensureCase();
    if (!caseFile.documents.some(d => d.clioId === Number(m[1]))) return json(res, 404, { error: 'not in this matter' });
    json(res, 200, await locate(m[1], Number(m[2]), url.searchParams.get('q')));
  }],
  ['GET', /^\/media\/photos\/(\d+\.png)$/, async (req, res, m) => serveFile(res, path.resolve('data/photos', m[1]))],

  // ---------- Provider sharing ----------
  ['GET', /^\/api\/shares$/, async (req, res) => { const { caseFile, digest } = await ensureCase(); json(res, 200, { shares: listShares(caseFile.matter.id), milestones: milestoneCandidates(digest), defaultPolicy: DEFAULT_POLICY }); }],
  ['POST', /^\/api\/shares\/preview$/, async (req, res) => {
    const { digest } = await ensureCase(); const b = await body(req);
    json(res, 200, await providerView(digest, b.providerId, { ...DEFAULT_POLICY, ...b.policy }));
  }],
  ['POST', /^\/api\/shares$/, async (req, res) => {
    const { caseFile, digest } = await ensureCase(); const b = await body(req);
    const p = digest.facts.providers.find(x => x.id === b.providerId);
    const token = createShare({ matterId: caseFile.matter.id, providerId: p.id, providerName: p.name, policy: { ...DEFAULT_POLICY, ...b.policy }, note: b.policy?.note });
    json(res, 200, { token, url: `/p/${token}` });
  }],
  ['POST', /^\/api\/shares\/([\w-]+)\/revoke$/, async (req, res, m) => { revokeShare(m[1]); json(res, 200, { ok: true }); }],
  // Demo switch: open the doctor's screen for the provider the firm most needs something from.
  ['GET', /^\/doctor$/, async (req, res) => {
    const { caseFile, digest } = await ensureCase();
    const want = Number(new URL(req.url, 'http://x').searchParams.get('provider'));
    const p = digest.facts.providers.find(x => x.id === want) || digest.facts.providers.find(x => x.asks?.length) || digest.facts.providers[0];
    const live = listShares(caseFile.matter.id).find(s => s.provider_id === p.id && !s.revoked_at && !s.expired && !s.policy?.coverage);
    const token = live?.token || createShare({ matterId: caseFile.matter.id, providerId: p.id, providerName: p.name, policy: { ...DEFAULT_POLICY }, note: '' });
    res.writeHead(302, { location: `/p/${token}?view=demo` }); res.end();
  }],
  ['GET', /^\/api\/demo\/providers$/, async (req, res) => { const { digest } = await ensureCase(); json(res, 200, digest.facts.providers.map(p => ({ id: p.id, name: p.name }))); }],
  ['GET', /^\/p\/([\w-]+)$/, async (req, res) => serveFile(res, path.join(PUBLIC, 'provider.html'))],
  ['POST', /^\/api\/ask$/, async (req, res) => {
    const { caseFile, digest } = await ensureCase(); const b = await body(req);
    json(res, 200, await ask(caseFile, b.q, digest?.facts));
  }],
  ['POST', /^\/api\/p\/([\w-]+)\/follow$/, async (req, res, m) => {
    const s = getShare(m[1]);
    if (!s || s.revoked_at || s.expired) return json(res, 404, { error: 'This link is no longer active.' });
    const b = await body(req); setFollowing(s.token, !!b.follow);
    json(res, 200, { ok: true, following: !!b.follow });
  }],
  ['GET', /^\/api\/p\/([\w-]+)$/, async (req, res, m) => {
    const s = getShare(m[1]);
    if (!s || s.revoked_at || s.expired) return json(res, 404, { error: 'This link is no longer active. Contact the firm for a new one.' });
    const { digest } = await ensureCase();
    if (!req.headers['x-preview']) logView(s.token, req);
    json(res, 200, { ...await providerView(digest, s.provider_id, s.policy), following: s.following, expiresAt: s.expiresAt });
  }],

  // ---------- Clio OAuth ----------
  ['GET', /^\/auth\/clio$/, async (req, res) => {
    const st = randomBytes(12).toString('hex'); kv.set('oauth_state', st);
    res.writeHead(302, { location: authorizeUrl(st) }); res.end();
  }],
  ['GET', new RegExp(`^(${REDIRECT.pathname.replace(/[/.]/g, '\\$&')}|/auth/clio/callback)$`), async (req, res, m, url) => {
    if (url.searchParams.get('error')) { res.writeHead(302, { location: `/?clio_error=${encodeURIComponent(url.searchParams.get('error_description') || url.searchParams.get('error'))}` }); return res.end(); }
    if (url.searchParams.get('state') !== kv.get('oauth_state')) return json(res, 400, { error: 'OAuth state mismatch. Start again from Connect Clio.' });
    try { await exchangeCode(url.searchParams.get('code')); }
    catch (e) { res.writeHead(302, { location: `/?clio_error=${encodeURIComponent(e.message.slice(0, 200))}` }); return res.end(); }
    // Fresh pull from the real Clio account.
    state = { caseFile: null, digest: null, syncing: null, progress: null };
    doSync().catch(e => (state.lastError = e.message));
    res.writeHead(302, { location: '/case?connected=1' }); res.end();
  }],
  ['GET', /^\/api\/clio\/status$/, async (req, res) => json(res, 200, {
    mode: clioMode(), credentials: hasCredentials(), base: CLIO_BASE, redirectUri: redirectUri(),
    source: state.caseFile?.source || null, connectedAs: state.caseFile?.mode === 'live' ? state.caseFile?.me?.name : null, matter: state.caseFile?.matter?.displayNumber || null, syncing: !!state.syncing, syncedAt: state.caseFile?.syncedAt || null, lastError: state.lastError || null,
  })],
  ['POST', /^\/api\/clio\/disconnect$/, async (req, res) => {
    disconnect(); state = { caseFile: null, digest: null, syncing: null, progress: null }; json(res, 200, { ok: true });
  }],
];

// Hosted deploys set APP_PASSWORD: the attorney side asks for it (any username). Doctor links stay open,
// since the token in the link is their access. Loopback is exempt: that is the server reading its own replica.
const OPEN = /^\/(doctor|api\/demo\/providers|p\/[\w-]+|api\/p\/[\w-]+(\/follow)?|provider\.(css|html)|provider-view\.js|common\.js|styles\.css|favicon\.ico|healthz)$/;
const digestOf = (s) => createHash('sha256').update(String(s)).digest();
function authorised(req, url) {
  const pw = process.env.APP_PASSWORD;
  if (!pw || OPEN.test(url.pathname)) return true;
  const ip = req.socket.remoteAddress || '';
  if ((ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') && !req.headers['x-forwarded-for']) return true;
  const [, b64] = (req.headers.authorization || '').match(/^Basic (.+)$/) || [];
  const given = b64 ? Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':') : '';
  return timingSafeEqual(digestOf(given), digestOf(pw));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
    if (!authorised(req, url)) { res.writeHead(401, { 'www-authenticate': 'Basic realm="ROSS", charset="UTF-8"', 'content-type': 'text/plain' }); return res.end('ROSS: enter the team password (any username).'); }
    if (handleReplica(req, res, url)) return;
    for (const [method, re, fn] of routes) {
      const m = url.pathname.match(re);
      if (m && req.method === method) return await fn(req, res, m, url);
    }
    if (req.method === 'GET') {
      if (!req.headers.cookie?.includes('cl_user=')) res.setHeader('set-cookie', `cl_user=${randomBytes(8).toString('hex')}; Path=/; Max-Age=31536000; SameSite=Lax`);
      // First page: connect Clio and pick the client. The case itself lives at /case.
      const p = url.pathname === '/' ? '/welcome.html' : url.pathname === '/case' ? '/index.html' : url.pathname;
      const file = path.join(PUBLIC, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
      return serveFile(res, file);
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    json(res, e.status || 500, { error: e.message });
  }
});

const HOST = process.env.HOST || (process.env.RAILWAY_ENVIRONMENT ? '0.0.0.0' : '127.0.0.1');
server.listen(PORT, HOST, () => console.log(`ROSS on ${process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://127.0.0.1:${PORT}`}${process.env.APP_PASSWORD ? ' (password on)' : ''}  (Clio: ${clioMode()}, AI: ${process.env.ANTHROPIC_API_KEY ? 'on' : 'off'})`));
