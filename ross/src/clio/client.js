// Read-only Clio Manage v4 client.
// Rule 3 of the hackathon ("read everything, write nothing") is enforced here, in code:
// the only verb this client can send is GET. There is no post/patch/delete method to call.
import { getToken, clioMode, CLIO_BASE } from './oauth.js';

const RETRYABLE = new Set([429, 502, 503, 504]);

export class ClioReadOnlyClient {
  constructor({ baseUrl, token }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
    this.requests = 0;
  }

  static async fromEnv() {
    if (clioMode() === 'live') {
      const token = await getToken();
      if (!token) throw Object.assign(new Error('Not connected to Clio. Visit /auth/clio to connect.'), { status: 401 });
      return new ClioReadOnlyClient({ baseUrl: process.env.CLIO_BASE_URL || `${CLIO_BASE}/api/v4`, token });
    }
    const port = process.env.PORT || 3000;
    return new ClioReadOnlyClient({ baseUrl: `http://127.0.0.1:${port}/replica/api/v4`, token: 'replica-token' });
  }

  async #fetch(url, { raw = false } = {}) {
    for (let attempt = 0; ; attempt++) {
      this.requests++;
      const res = await fetch(url, { method: 'GET', headers: { authorization: `Bearer ${this.token}`, accept: raw ? '*/*' : 'application/json' }, redirect: 'follow' });
      if (RETRYABLE.has(res.status) && attempt < 4) {
        const wait = Number(res.headers.get('retry-after') || 2 ** attempt) * 1000;
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) throw Object.assign(new Error(`Clio GET ${url} -> ${res.status} ${await res.text()}`), { status: res.status });
      return raw ? Buffer.from(await res.arrayBuffer()) : res.json();
    }
  }

  url(path, params = {}) {
    const u = new URL(`${this.baseUrl}/${path.replace(/^\//, '')}`);
    for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
    return u.toString();
  }

  async get(path, params) {
    return (await this.#fetch(this.url(path, params))).data;
  }

  /** Follows meta.paging.next until the collection is exhausted. */
  async all(path, params = {}) {
    let next = this.url(path, { limit: 200, ...params });
    const rows = [];
    while (next) {
      const body = await this.#fetch(next);
      rows.push(...body.data);
      next = body.meta?.paging?.next || null;
    }
    return rows;
  }

  download(documentId) {
    return this.#fetch(this.url(`documents/${documentId}/download`), { raw: true });
  }
}

// Field selections. Clio returns only id + etag unless fields are named explicitly.
export const FIELDS = {
  matter: 'id,etag,display_number,description,status,open_date,close_date,statute_of_limitations,created_at,updated_at,client{id,name},practice_area{id,name},matter_stage{id,name},responsible_attorney{id,name},custom_field_values{id,field_name,field_type,value,custom_field}',
  contact: 'id,etag,name,type,first_name,last_name,title,date_of_birth,company{name},email_addresses{address,default_email},phone_numbers{number,default_number},addresses{street,city,province,postal_code}',
  relationship: 'id,etag,description,contact{id,name}',
  note: 'id,etag,subject,detail,date,type,created_at,updated_at,author{id,name}',
  communication: 'id,etag,subject,body,date,type,created_at,updated_at,senders{id,name,type},receivers{id,name,type}',
  task: 'id,etag,name,description,due_at,status,priority,statute_of_limitations,completed_at,created_at,updated_at,assignee{id,name,type}',
  calendar_entry: 'id,etag,summary,description,start_at,end_at,all_day,location,created_at,updated_at',
  activity: 'id,etag,type,date,quantity,price,total,note,created_at,updated_at',
  document: 'id,etag,name,content_type,size,received_at,created_at,updated_at,parent{id,name,type},latest_document_version{uuid,size}',
  folder: 'id,etag,name,parent{id,type}',
};
