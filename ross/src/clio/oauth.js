// Clio OAuth 2.0 authorization-code flow. Scopes requested are read-only in practice:
// CaseLight's client can only issue GET requests (see client.js).
import { kv } from '../db.js';

// CLIO_BASE picks the region host (app / eu.app / ca.app / au.app .clio.com).
export const CLIO_BASE = (process.env.CLIO_BASE || process.env.CLIO_AUTH_BASE || 'https://app.clio.com').replace(/\/+$/, '');
const AUTH_BASE = CLIO_BASE;
// Local: the 127.0.0.1:3000/callback registered on the Clio app. On Railway: the service's public domain.
export const redirectUri = () => process.env.CLIO_REDIRECT_URI
  || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/callback` : `http://127.0.0.1:${process.env.PORT || 3000}/callback`);
export const hasCredentials = () => !!(process.env.CLIO_CLIENT_ID && process.env.CLIO_CLIENT_SECRET);
export const hasToken = () => !!(process.env.CLIO_ACCESS_TOKEN || kv.get('clio_token'));
export const disconnect = () => kv.set('clio_token', null);
/** 'live' when told to, or in 'auto' once a Clio token exists; otherwise the local replica. */
export const clioMode = () => {
  const m = process.env.CLIO_MODE || 'auto';
  return m === 'live' || (m === 'auto' && hasToken()) ? 'live' : 'replica';
};

export function authorizeUrl(state) {
  const u = new URL(`${AUTH_BASE}/oauth/authorize`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', process.env.CLIO_CLIENT_ID || '');
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('state', state);
  return u.toString();
}

async function tokenRequest(params, keepRefresh) {
  const res = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: 'POST', // OAuth token endpoint, not the Clio data API: no case data is written.
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.CLIO_CLIENT_ID, client_secret: process.env.CLIO_CLIENT_SECRET, ...params }),
  });
  if (!res.ok) throw new Error(`Clio token exchange failed: ${res.status} ${await res.text()}`);
  const t = await res.json();
  const saved = { refresh_token: keepRefresh, ...t, expires_at: Date.now() + (t.expires_in || 3600) * 1000 };
  kv.set('clio_token', saved);
  return saved;
}

export const exchangeCode = (code) => tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() });

export async function getToken() {
  if (process.env.CLIO_ACCESS_TOKEN) return process.env.CLIO_ACCESS_TOKEN;
  let t = kv.get('clio_token');
  if (!t) return null;
  if (t.expires_at - Date.now() < 60_000 && t.refresh_token) t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token }, t.refresh_token);
  return t.access_token;
}
