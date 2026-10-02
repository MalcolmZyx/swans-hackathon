// CaseLight, lawyer Case screen. One screen plus slide-up sheets: Source, Ask, Share, Full file.
// Every case fact on screen comes from the API; this file only holds layout words.
import { $, $$, esc, money, date, ago, icon, kicon, kindLabel, api, toast } from './common.js';
import { renderProviderView } from './provider-view.js';

const S = { data: null, shares: [], clio: null, docCache: {}, share: null, fileKinds: new Set() };
const byId = () => (S._byId ??= Object.fromEntries(S.data.timeline.map(i => [i.id, i])));
const today = () => S.data.facts.asOf;
const firstName = () => (S.data.facts.hero.client || '').split(' ')[0];
const initials = (n) => (n || '?').split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
const docRef = (docId, page) => `${docId}#${page || 1}`;
const tidyTask = (t) => String(t || '').replace(/^By [^:]+:\s*/, '').replace(/^[^-]+ - /, '');

// ---------- Boot ----------
async function boot() {
  showClioError();
  const [data, clio, shares] = await Promise.all([
    api('/api/case'),
    api('/api/clio/status').catch(() => null),
    api('/api/shares').catch(() => ({ shares: [] })),
  ]);
  S.data = data; S.clio = clio; S.shares = shares.shares || []; S.defaultPolicy = shares.defaultPolicy;
  renderTop(); render();
  const deep = new URLSearchParams(location.search);
  if (deep.get('open')) openSource([deep.get('open')]);
  if (deep.get('share')) openShare();
}

function markSeen() {
  if (S._seen) return; S._seen = true;
  try { fetch('/api/seen', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', keepalive: true }).catch(() => {}); } catch {}
}
addEventListener('pagehide', markSeen);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') markSeen(); });

function showClioError() {
  const p = new URLSearchParams(location.search), err = p.get('clio_error');
  if (!err) return;
  $('#banner').innerHTML = `<div class="c-banner" role="alert"><span>Clio connection failed: ${esc(err)}</span><button class="c-x" data-dismiss aria-label="Dismiss">${icon.x}</button></div>`;
  $('[data-dismiss]').onclick = () => {
    $('#banner').innerHTML = '';
    p.delete('clio_error'); history.replaceState(null, '', location.pathname + (p.toString() ? `?${p}` : ''));
  };
}

function renderTop() {
  const c = S.clio, live = c?.mode === 'live';
  const synced = c?.syncedAt || S.data.meta.syncedAt;
  $('#ro').innerHTML = `<i class="${live ? 'live' : ''}"></i>Read-only from Clio · ${live ? 'Live Clio' : 'Replica'}${synced ? `<span class="c-hide-sm"> · synced ${new Date(synced).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>` : ''}`;
  $('#ro').title = c?.source || S.data.meta.source || '';
  $('#connect').hidden = !(c && c.mode === 'replica' && c.credentials);
}

// ---------- Case screen ----------
function render() {
  const d = S.data, f = d.facts, h = f.hero;
  const last = f.client?.lastTalk || f.lastActivity;
  document.title = `${h.client} · ROSS`;
  $('#app').innerHTML = `
    <section class="c-who">
      <div class="c-av" aria-hidden="true">${esc(initials(h.client))}</div>
      <div>
        <h1>${esc(h.client)}</h1>
        <div class="c-sub">${[h.age != null && esc(h.age), h.doi && `Injured ${esc(date(h.doi))}`, `<b>${esc(h.stage)}</b>`, last && `<button class="c-link" data-src="${esc(last.id)}">Last contact ${esc(date(last.date))}</button>`].filter(Boolean).join(' · ')}</div>
      </div>
    </section>
    ${headline()}
    ${numbers()}
    ${bodyMap()}
    <div class="c-two c-story">
      ${journey()}
      ${oneMinute()}
    </div>
    <div class="c-two">
      ${newSince()}
      ${needsYou()}
    </div>
    <form class="c-ask" id="askform" autocomplete="off">
      <span class="c-spark">${icon.spark}</span>
      <input id="askq" name="q" placeholder="Ask anything about this case" aria-label="Ask anything about this case">
      <button type="submit" class="c-btn">Ask</button>
    </form>
    <div class="c-lines">
      ${injuryLine()}
      ${doctorLine()}
    </div>
    <div class="c-actions">
      <button class="c-btn c-pri" id="sharebtn">${icon.share}Share with a doctor</button>
      <button class="c-btn" id="docsbtn">Documents</button>
      <button class="c-btn" id="filebtn">Full file ›</button>
    </div>
    <footer class="c-foot">${esc(d.meta.source)} · ${esc(d.meta.clioRequests)} reads, 0 writes · ${esc(d.meta.items)} entries · ${esc(d.meta.documents.length)} documents</footer>`;
  wire();
}

function cite(n, refs) { return `<button class="c-cite" data-cites="${esc(JSON.stringify(refs))}" aria-label="Source ${n}">${n}</button>`; }
// Keep a citation on the same line as the word before it.
const glue = (html) => html.replace(/(\S+)(<button class="c-cite"[^>]*>\d+<\/button>)([.,]?)/g, '<span class="c-nw">$1$2$3</span>');

function headline() {
  const f = S.data.facts, k = f.kpis, parts = []; let n = 0;
  const v = k.caseValue?.value, c = k.coverage?.value;
  if (v != null && c != null && v > c) parts.push(`Worth ${money(v)}, but only <b>${money(c)}</b> of insurance stands behind it${cite(++n, [...(k.coverage.src || []), ...(k.caseValue.src || [])])}.`);
  else if (v != null) parts.push(`Worth ${money(v)}${c != null ? ` with ${money(c)} of insurance behind it` : ''}${cite(++n, k.caseValue.src || [])}.`);
  const od = f.work?.overdue?.[0];
  if (od) parts.push(`Still waiting on ${esc(tidyTask(od.title).replace(/^[A-Z](?![A-Z])/, c => c.toLowerCase()))}, <b class="c-red">${od.daysLate} days late</b>${cite(++n, [od.id])}.`);
  if (!parts.length && S.data.brief?.headline) parts.push(esc(S.data.brief.headline));
  return `<p class="c-head">${glue(parts.join(' '))}</p>`;
}

function numbers() {
  const f = S.data.facts, k = f.kpis, w = f.waterfall || {};
  const cov = k.coverage || {};
  const netSrc = [...new Set([...(cov.src || []), ...(k.caseValue?.src || [])])];
  const deduct = [w.fee && 'fee', w.costs && 'costs', w.lien && 'lien'].filter(Boolean).join(', ');
  return `<section class="c-nums">
    <button class="c-num" data-cites="${esc(JSON.stringify(k.caseValue?.src || []))}"><span>Worth</span><b>${money(k.caseValue?.value)}</b><em>${esc(k.caseValue?.label || '')}</em></button>
    <button class="c-num" data-cites="${esc(JSON.stringify(cov.src || []))}"><span>Insurance</span><b>${money(cov.value)}</b>${cov.confirmed ? `<em class="c-green">✓ confirmed ${esc(date(cov.confirmedOn, { year: false }))}</em>` : '<em class="c-amber">not confirmed</em>'}</button>
    <button class="c-num" data-cites="${esc(JSON.stringify(netSrc))}"><span>${esc(firstName())} nets ≈</span><b class="c-green">${money(w.net)}</b><em>${w.cap ? `of ${money(w.cap)} cap` : ''}${deduct ? ` after ${deduct}` : ''}</em></button>
  </section>`;
}

function newSinceItems() {
  const d = S.data, ch = d.changes || { items: [] };
  const rank = (a, b) => (b.importance - a.importance) || String(b.date).localeCompare(String(a.date));
  if (ch.basis?.type === 'first-visit' || !ch.basis) {
    const from = new Date(today()); from.setDate(from.getDate() - 30);
    const lo = from.toISOString().slice(0, 10);
    const items = d.timeline.filter(i => i.date && i.date >= lo && i.date <= today()).sort(rank).slice(0, 3);
    return { items, note: 'First visit — showing the 3 most important recent items', count: items.length };
  }
  const all = (ch.items || []).map(id => byId()[id]).filter(Boolean).sort(rank);
  const since = ch.basis.since || ch.basis.date || ch.basis.at;
  return { items: all.slice(0, 3), count: all.length, note: all.length ? (all.length > 3 ? `${all.length} changes, showing the 3 that matter most` : '') : `Nothing new${since ? ` since ${date(String(since).slice(0, 10))}` : ''}` };
}

function newSince() {
  const { items, note, count } = newSinceItems();
  return `<section class="c-list"><h2>New since you looked${count ? ` <span>${count}</span>` : ''}</h2>
    ${note ? `<div class="c-note">${esc(note)}</div>` : ''}
    ${items.map(i => `<button class="c-li" data-src="${esc(i.id)}"><i class="c-dot blue"></i><span class="c-t">${esc(i.title)}</span><span class="c-m">${esc(date(i.date, { year: i.date.slice(0, 4) !== today().slice(0, 4) }))}</span></button>`).join('')}
  </section>`;
}

function needsYou() {
  const w = S.data.facts.work || {};
  const od = (w.overdue || []).map(t => ({ ...t, late: true }));
  const up = (w.upcomingTasks || []).map(t => ({ ...t, late: false }));
  const all = [...od, ...up], items = all.slice(0, 3);
  return `<section class="c-list"><h2>Needs you${all.length ? ` <span>${all.length}</span>` : ''}</h2>
    ${items.map(t => `<button class="c-li" data-src="${esc(t.id)}"><i class="c-dot ${t.late ? 'red' : 'grey'}"></i><span class="c-t">${t.late ? `<b>${esc(cap(tidyTask(t.title)))}</b>` : esc(cap(tidyTask(t.title)))}</span><span class="c-m ${t.late ? 'c-red' : ''}">${t.late ? `${t.daysLate} days late` : esc(date(t.date, { year: false }))}</span></button>`).join('') || '<div class="c-note">Nothing on your plate.</div>'}
  </section>`;
}

function injuryRegions() {
  const inj = (S.data.injuries || []).slice().sort((a, b) => (b.pages?.length || 0) - (a.pages?.length || 0));
  const seen = new Set(), out = [];
  for (const r of inj) {
    const m = r.region.match(/^(left|right) (.+)$/);
    if (m) {
      const other = inj.find(x => x.region === `${m[1] === 'left' ? 'right' : 'left'} ${m[2]}`);
      const key = m[2];
      if (seen.has(key)) continue; seen.add(key);
      out.push({ label: other ? `both ${m[2]}s` : r.region, regions: [r, other].filter(Boolean) });
    } else { if (seen.has(r.region)) continue; seen.add(r.region); out.push({ label: r.region, regions: [r] }); }
  }
  return out;
}

// Body graph: each injured region lights up by how much of the record documents it; tap one to open its pages.
// Front view, so the patient's left is on the viewer's right.
const ZONES = {
  head: '<circle cx="60" cy="22" r="15"/>',
  cervical: '<rect x="53" y="38" width="14" height="12" rx="4"/>',
  'right shoulder': '<circle cx="36" cy="61" r="10"/>',
  'left shoulder': '<circle cx="84" cy="61" r="10"/>',
  thoracic: '<rect x="45" y="58" width="30" height="34" rx="8"/>',
  lumbar: '<rect x="46" y="95" width="28" height="22" rx="7"/>',
  'right knee': '<circle cx="49" cy="196" r="9"/>',
  'left knee': '<circle cx="71" cy="196" r="9"/>',
  'right hip': '<circle cx="48" cy="130" r="9"/>', 'left hip': '<circle cx="72" cy="130" r="9"/>',
  'right wrist': '<circle cx="22" cy="128" r="7"/>', 'left wrist': '<circle cx="98" cy="128" r="7"/>',
};
function bodyMap() {
  const inj = (S.data.injuries || []).filter(r => ZONES[r.region] && r.findings?.length);
  if (!inj.length) return '';
  const max = Math.max(...inj.map(r => r.pages?.length || 1));
  const shade = (r) => (0.35 + 0.65 * (r.pages?.length || 1) / max).toFixed(2);
  const sorted = inj.slice().sort((a, b) => (b.pages?.length || 0) - (a.pages?.length || 0));
  return `<section class="c-body-map">
    <svg viewBox="0 0 120 250" role="img" aria-label="Injured body regions">
      <g class="c-sil"><circle cx="60" cy="22" r="15"/><rect x="54" y="36" width="12" height="14" rx="4"/><rect x="34" y="50" width="52" height="84" rx="20"/>
        <rect x="18" y="56" width="16" height="78" rx="8"/><rect x="86" y="56" width="16" height="78" rx="8"/>
        <rect x="40" y="128" width="18" height="110" rx="9"/><rect x="62" y="128" width="18" height="110" rx="9"/></g>
      ${sorted.map(r => `<g class="c-zone" data-region="${esc(r.region)}" style="--a:${shade(r)}" tabindex="0" role="button" aria-label="${esc(r.region)}: ${r.pages?.length || 0} pages">${ZONES[r.region]}</g>`).join('')}
    </svg>
    <div class="c-inj">
      <h2>Injuries <span>${inj.length}</span></h2>
      ${sorted.map(r => `<button class="c-injrow" data-region="${esc(r.region)}"><i style="--a:${shade(r)}"></i><span class="c-t"><b>${esc(cap(r.region))}</b><em>${esc(String(r.findings[0].finding || '').replace(/\s+/g, ' ').slice(0, 110))}</em></span><span class="c-m">${r.pages?.length || r.findings.length} pages ›</span></button>`).join('')}
    </div>
  </section>`;
}
// Key moments: the milestones that matter from the crash to today, then what is still ahead.
function journey() {
  const t = today(), tl = S.data.timeline;
  const past = tl.filter(i => i.date && i.date <= t && (i.importance || 0) >= 4 && i.kind !== 'expense').sort((a, b) => a.date.localeCompare(b.date));
  const ahead = tl.filter(i => i.date && i.date > t && ['event', 'task'].includes(i.kind)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
  const row = (i, up) => `<li class="${up ? 'up' : ''} j-${i.kind}"><button class="c-jrow" data-src="${esc(i.id)}"><span class="c-jd">${esc(date(i.date))}${up ? ' · upcoming' : ''} <em>${esc(kindLabel[i.kind] || i.kind)}</em></span><b>${esc(i.title)}</b>${i.why && i.why !== i.title ? `<span class="c-jw">${esc(String(i.why).slice(0, 150))}</span>` : ''}</button></li>`;
  return `<section class="c-list"><h2>Key moments</h2>
    <div class="c-note">From the crash to today, then what is still ahead. <button class="c-link" id="jtoday">Jump to today</button></div>
    <ol class="c-journey">${past.map(i => row(i, false)).join('')}<li class="c-now" id="jnow"><span>Today · ${esc(date(t))}</span></li>${ahead.map(i => row(i, true)).join('')}</ol>
  </section>`;
}
// The case in one minute: the written brief, every sentence with its source.
function oneMinute() {
  const b = S.data.brief || {};
  const story = (b.story || []).slice(0, 7);
  if (!story.length) return '';
  return `<section class="c-list"><h2>The case in one minute</h2>
    <div class="c-note">${S.data.briefSource && /claude|openai/i.test(S.data.briefSource) ? 'Written by AI from the file' : 'Assembled from the file'} · every sentence opens its source</div>
    <div class="c-brief">${story.map(x => `<p>${glue(`${esc(x.text)}${(x.cites || []).length ? cite('↗', x.cites) : ''}`)}</p>`).join('')}</div>
  </section>`;
}
// Documents: every PDF in the matter, viewed in place.
function openDocs(startId) {
  const docs = S.data.meta.documents;
  const el = openSheet({ title: `Documents · ${docs.length}`, chip: 'PDF', wide: true, cls: 'docs', body: `<div class="c-docs"><div class="c-doclist">${docs.map(d => `<button class="c-docrow" data-doc="${esc(d.id)}"><b>${esc((d.name || '').split('__').pop().replace(/\.pdf$/i, '').replace(/[-_]+/g, ' '))}</b><span>${esc(d.folder || '')} · ${d.pageCount || '?'} pages</span></button>`).join('')}</div><div class="c-docview"><div class="c-muted" style="padding:40px;text-align:center">Pick a document</div></div></div>` });
  const show = (id) => {
    const d = docs.find(x => x.id === id); if (!d) return;
    $$('.c-docrow', el).forEach(b => b.classList.toggle('on', b.dataset.doc === id));
    $('.c-docview', el).innerHTML = `<iframe title="${esc(d.name)}" src="/media/doc/${esc(id.slice(4))}.pdf#view=FitH"></iframe><div class="c-row"><a class="c-btn sm" href="/media/doc/${esc(id.slice(4))}.pdf" target="_blank" rel="noopener">Open in new tab ↗</a>${d.clioUrl ? `<a class="c-btn sm" href="${esc(d.clioUrl)}" target="_blank" rel="noopener">Open in Clio ↗</a>` : ''}</div>`;
  };
  $$('.c-docrow', el).forEach(b => b.onclick = () => show(b.dataset.doc));
  show(startId || docs[0]?.id);
}

function openRegion(region) {
  const r = (S.data.injuries || []).find(x => x.region === region); if (!r) return;
  const refs = [], keys = {};
  for (const f of r.findings || []) { const ref = docRef(f.docId, f.page); if (!refs.includes(ref)) { refs.push(ref); keys[ref] = f.finding; } }
  openSource(refs, 0, { keys });
}

function injuryLine() {
  const regs = injuryRegions().slice(0, 5);
  if (!regs.length) return '';
  const refs = regs.flatMap(g => g.regions.flatMap(r => (r.findings || []).slice(0, 1).map(fd => docRef(fd.docId, fd.page))));
  return `<div class="c-line"><span class="c-lbl">Injuries</span><span>${regs.map(g => esc(cap(g.label))).join(' · ')}</span>${refs.length ? `<button class="c-link" data-cites="${esc(JSON.stringify(refs))}">${refs.length} pages ›</button>` : ''}</div>`;
}

function doctorLine() {
  const active = S.shares.filter(s => !s.revoked_at);
  if (!active.length) return `<div class="c-line"><span class="c-lbl">Doctors</span><span class="c-muted">No doctor links yet</span></div>`;
  const by = {};
  for (const s of active) { (by[s.provider_name] ??= []).push(s); }
  const bits = Object.entries(by).map(([name, list]) => {
    const views = list.flatMap(s => s.views || []).map(v => v.viewed_at).sort();
    const lastV = views.at(-1);
    const nm = esc(name.split(',')[0]);
    return lastV ? `${nm} <b class="c-green">opened your link ${esc(date(lastV.slice(0, 10), { year: false }))}</b>` : `${nm} <b class="c-amber">not opened</b>`;
  });
  return `<div class="c-line"><span class="c-lbl">Doctors</span><span>${bits.join(' · ')}</span></div>`;
}

function wire() {
  $$('#app [data-src]').forEach(el => el.onclick = () => openSource([el.dataset.src]));
  $$('#app [data-cites]').forEach(el => el.onclick = () => openSource(JSON.parse(el.dataset.cites)));
  $$('#app [data-region]').forEach(el => { el.onclick = () => openRegion(el.dataset.region); el.onkeydown = (e) => { if (e.key === 'Enter') openRegion(el.dataset.region); };
    el.onmouseenter = () => $$(`#app [data-region="${CSS.escape(el.dataset.region)}"]`).forEach(x => x.classList.add('hot'));
    el.onmouseleave = () => $$('#app [data-region].hot').forEach(x => x.classList.remove('hot')); });
  $('#sharebtn').onclick = () => openShare();
  $('#filebtn').onclick = () => openFile();
  $('#docsbtn').onclick = () => openDocs();
  const jt = $('#jtoday'); if (jt) jt.onclick = () => $('#jnow')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const jr = $('.c-journey'); const jn = $('#jnow'); if (jr && jn) jr.scrollTop = jn.offsetTop - jr.clientHeight / 2;
  $('#askform').onsubmit = (e) => { e.preventDefault(); const q = $('#askq').value.trim(); if (q) { $('#askq').value = ''; openAsk(q); } };
}

// ---------- Sheets ----------
const stack = [];
function openSheet({ title, chip, body, wide, cls = '' }) {
  const el = document.createElement('div');
  el.className = 'c-sheetwrap';
  el.innerHTML = `<div class="c-backdrop" data-sclose></div>
    <div class="c-sheet ${wide ? 'wide' : ''} ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1">
      <div class="c-sh"><span class="c-chip">${chip}</span><b class="c-st">${esc(title)}</b><span class="c-spacer"></span><button class="c-btn sm" data-sclose aria-label="Close">Esc</button></div>
      <div class="c-sb">${body}</div>
    </div>`;
  el._prev = document.activeElement;
  $('#sheets').append(el); stack.push(el);
  requestAnimationFrame(() => el.classList.add('on'));
  $$('[data-sclose]', el).forEach(b => b.onclick = closeSheet);
  setTimeout(() => $('.c-sheet', el).focus(), 30);
  return el;
}
function closeSheet() {
  const el = stack.pop(); if (!el) return;
  el.classList.remove('on');
  setTimeout(() => el.remove(), 220);
  el._prev?.focus?.();
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stack.length) { e.preventDefault(); closeSheet(); }
  const top = stack.at(-1);
  if (top?._keys && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) top._keys(e.key === 'ArrowLeft' ? -1 : 1);
});

// ---------- Source sheet ----------
function highlight(text, key) {
  const t = String(text || '');
  if (key) {
    // Whitespace-flexible match: the cited sentence may wrap across lines in the page text.
    const words = String(key).trim().split(/\s+/).filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const m = words.length ? new RegExp(words.join('\\s+'), 'i').exec(t) : null;
    if (m) return `${esc(t.slice(0, m.index))}<mark>${esc(m[0])}</mark>${esc(t.slice(m.index + m[0].length))}`;
  }
  return esc(t);
}
async function getDoc(docId) { return (S.docCache[docId] ??= api(`/api/doc/${encodeURIComponent(docId)}/pages`)); }

function openSource(refs, start = 0, { keys = {} } = {}) {
  refs = (refs || []).filter(Boolean);
  if (!refs.length) return toast('No source recorded for this');
  const el = openSheet({ title: 'Source', chip: 'Source', body: '<div class="c-src"></div>' });
  let i = start;
  const show = async () => {
    const ref = refs[i], box = $('.c-src', el);
    const nav = refs.length > 1 ? `<div class="c-nav"><button class="c-btn sm" data-pv ${i <= 0 ? 'disabled' : ''}>‹ Prev</button><span class="c-muted">${i + 1} of ${refs.length}</span><button class="c-btn sm" data-nx ${i >= refs.length - 1 ? 'disabled' : ''}>Next ›</button></div>` : '';
    const [id, pg] = ref.split('#');
    const item = byId()[id];
    if (id.startsWith('doc:') && (pg || !item)) {
      const meta = S.data.meta.documents.find(x => x.id === id);
      const page = Number(pg || 1);
      $('.c-st', el).textContent = item?.title || (meta?.name || id).split('__').pop().replace(/\.pdf$/, '').replace(/-/g, ' ');
      const clioId = id.slice(4), total = meta?.pageCount || 0;
      const pager = `<div class="c-pager"><button class="c-btn sm" data-pp ${page <= 1 ? 'disabled' : ''}>‹ p.${page - 1}</button><label>Page <input class="c-pgin" type="number" min="1" ${total ? `max="${total}"` : ''} value="${page}"> ${total ? `of ${total}` : ''}</label><button class="c-btn sm" data-pn ${total && page >= total ? 'disabled' : ''}>p.${page + 1} ›</button></div>`;
      box.innerHTML = `<div class="c-card"><div class="c-meta">Document · ${esc(meta?.folder || '')} · page ${page}${total ? ` of ${total}` : ''}</div>
        <div class="c-pagewrap"><div class="c-pagebox"><img class="c-page-img" alt="Page ${page}" src="/media/page/${esc(clioId)}/${page}.png"><div class="c-hl-layer"></div></div></div>
        <div class="c-hlnote c-muted"></div>${pager}<div class="c-pagetext"><div class="spinner"></div></div></div>
        <div class="c-row"><button class="c-btn" data-inpdf>View PDF here</button><a class="c-btn" href="/media/doc/${esc(clioId)}.pdf#page=${page}" target="_blank" rel="noopener">Open PDF at p.${page} ↗</a>${meta?.clioUrl ? `<a class="c-btn" href="${esc(meta.clioUrl)}" target="_blank" rel="noopener">Open in Clio ↗</a>` : ''}${nav}</div>`;
      wireNav();
      $('[data-inpdf]', el).onclick = () => { $('.c-pagewrap', el).innerHTML = `<iframe class="c-inpdf" title="PDF" src="/media/doc/${esc(clioId)}.pdf#page=${page}"></iframe>`; };
      const stepTo = (n) => { if (n >= 1 && (!total || n <= total)) { refs[i] = docRef(id, n); show(); } };
      $('[data-pp]', el).onclick = () => stepTo(page - 1); $('[data-pn]', el).onclick = () => stepTo(page + 1);
      $('.c-pgin', el).onchange = (e) => stepTo(Number(e.target.value));
      const passage = keys[ref];
      // Draw the highlight where the cited passage sits on the page image.
      if (passage) fetch(`/api/doc/${encodeURIComponent(clioId)}/page/${page}/locate?q=${encodeURIComponent(passage.slice(0, 300))}`).then(r => r.json()).then(loc => {
        if (refs[i] !== ref) return;
        const layer = $('.c-hl-layer', el); if (!layer) return;
        if (!loc.found) { $('.c-hlnote', el).textContent = 'Passage is in the page text below.'; return; }
        layer.innerHTML = loc.rects.map(r => `<i style="left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%"></i>`).join('');
        $('.c-hlnote', el).textContent = 'Highlighted: the passage this answer is based on.';
        layer.firstElementChild?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }).catch(() => {});
      try {
        const doc = await getDoc(id);
        if (refs[i] !== ref) return;
        const p = doc.pages?.find(x => x.page === page) || doc.pages?.[page - 1];
        $('.c-pagetext', el).innerHTML = p?.text ? `<div class="c-lbl">Page text${p.method === 'ocr' ? ' (OCR)' : ''}</div><div class="c-ocr">${highlight(p.text, passage)}</div>` : '<div class="c-muted">No text on this page.</div>';
        const mk = $('.c-ocr mark', el); if (mk) mk.scrollIntoView({ block: 'nearest' });
      } catch { const t = $('.c-pagetext', el); if (t) t.innerHTML = '<div class="c-muted">Page text unavailable.</div>'; }
      return;
    }
    if (!item) {
      $('.c-st', el).textContent = 'Source';
      box.innerHTML = `<div class="c-card"><div class="c-muted">This entry (${esc(ref)}) is not in the synced file.</div></div><div class="c-row">${nav}</div>`;
      return wireNav();
    }
    $('.c-st', el).textContent = item.title;
    const who = [item.author, item.from?.join(', ')].filter(Boolean)[0];
    box.innerHTML = `<div class="c-card">
        <div class="c-meta">${kicon(item.kind)}<b>${esc(kindLabel[item.kind] || item.kind)}</b><span>${esc(date(item.date))}</span>${who ? `<span>${esc(who)}</span>` : ''}${item.amount != null ? `<span>${money(item.amount)}</span>` : ''}</div>
        <div class="c-body">${highlight(item.body || item.title, keys[ref] || item.why)}</div>
        ${item.why && !(item.body || '').includes(item.why) ? `<div class="c-why"><span class="c-lbl">Why it matters</span>${esc(item.why)}</div>` : ''}
      </div>
      <div class="c-row">${item.clioUrl ? `<a class="c-btn" href="${esc(item.clioUrl)}" target="_blank" rel="noopener">Open in Clio ↗</a>` : ''}${item.kind === 'document' ? `<button class="c-btn" data-pages="${esc(item.id)}">View pages</button>` : ''}${nav}</div>`;
    wireNav();
    const pb = $('[data-pages]', el); if (pb) pb.onclick = () => openSource([docRef(item.id, 1)]);
  };
  const go = (dlt) => { const n = i + dlt; if (n >= 0 && n < refs.length) { i = n; show(); } };
  function wireNav() { const p = $('[data-pv]', el), n = $('[data-nx]', el); if (p) p.onclick = () => go(-1); if (n) n.onclick = () => go(1); }
  el._keys = go;
  show();
}

// ---------- Ask sheet ----------
let askEl = null;
function openAsk(q) {
  if (!askEl || !askEl.isConnected) {
    askEl = openSheet({ title: `About ${firstName()}'s case only`, chip: '✦ Ask', body: `<div class="c-thread"></div><form class="c-ask in" autocomplete="off"><input placeholder="Ask a follow-up" aria-label="Ask a follow-up"><button class="c-btn" type="submit">Ask</button></form>` });
    $('form', askEl).onsubmit = (e) => { e.preventDefault(); const inp = $('input', askEl); const v = inp.value.trim(); if (v) { inp.value = ''; ask(v); } };
  }
  ask(q);
}
async function ask(q) {
  const th = $('.c-thread', askEl);
  th.insertAdjacentHTML('beforeend', `<div class="c-q">${esc(q)}</div><div class="c-a pending"><div class="spinner"></div><span class="c-muted">Reading the file…</span></div>`);
  const box = th.lastElementChild; box.scrollIntoView({ block: 'end' });
  let r;
  try {
    const res = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q }) });
    r = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(res.status === 404 ? 'Ask is not available on this server yet.' : (r.error || `Ask failed (${res.status})`));
  } catch (e) {
    box.className = 'c-a warn'; box.innerHTML = `<b>Couldn't answer right now.</b> ${esc(e.message)}`; return;
  }
  const cites = r.cites || [];
  const refs = cites.map(c => c.docId && c.page ? docRef(c.docId, c.page) : c.id);
  const keys = {}; cites.forEach((c, j) => { if (c.snippet) keys[refs[j]] = c.snippet; });
  const citeBtn = (n) => { const j = cites.findIndex(c => Number(c.n) === n); const k = j >= 0 ? j : n - 1; return k >= 0 && k < cites.length ? `<button class="c-cite" data-ai="${k}">${n}</button>` : ''; };
  const answerHtml = esc(r.answer || '').replace(/\[(\d+)\]/g, (_, n) => citeBtn(Number(n))).replace(/\n/g, '<br>');
  const list = cites.length ? `<div class="c-srcs">${cites.map((c, j) => `<button class="c-srcrow" data-ai="${j}"><span class="c-n">${esc(c.n ?? j + 1)}</span><span><b>${esc(c.title || c.id || c.docId)}</b>${c.page ? ` · p.${esc(c.page)}` : ''}${c.date ? ` · ${esc(date(c.date))}` : ''}${c.snippet ? `<em>${esc(c.snippet.slice(0, 160))}${c.snippet.length > 160 ? '…' : ''}</em>` : ''}</span></button>`).join('')}</div>` : '';
  if (r.notFound) {
    box.className = 'c-a warn';
    box.innerHTML = `<b>Not in the file.</b> ${r.answer && !/^not in the file\.?$/i.test(r.answer.trim()) ? answerHtml : ''}${cites.length ? `<div class="c-lbl" style="margin-top:10px">Nearest passages</div>${list}` : ''}`;
  } else {
    box.className = 'c-a';
    box.innerHTML = `<div>${answerHtml || '<span class="c-muted">No answer returned.</span>'}</div>${list}`;
  }
  $$('[data-ai]', box).forEach(b => b.onclick = () => openSource(refs, Number(b.dataset.ai), { keys }));
}

// ---------- Full file sheet ----------
function openFile() {
  const kinds = [...new Set(S.data.timeline.map(i => i.kind))];
  const el = openSheet({ title: `Full file · ${S.data.timeline.length} entries`, chip: 'File', wide: true, body: `<div class="c-chips">${kinds.map(k => `<button class="c-fchip" data-k="${k}"><i style="background:var(--k-${k})"></i>${esc(kindLabel[k] || k)}</button>`).join('')}</div><div class="c-filelist"></div>` });
  const draw = () => {
    const rows = S.data.timeline.filter(i => !S.fileKinds.size || S.fileKinds.has(i.kind)).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const groups = {};
    for (const r of rows) { const m = r.date ? r.date.slice(0, 7) : 'Undated'; (groups[m] ??= []).push(r); }
    $('.c-filelist', el).innerHTML = Object.entries(groups).map(([m, list]) => `<div class="c-month">${m === 'Undated' ? m : esc(new Date(m + '-15').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }))}</div>${list.map(r => `<button class="c-frow" data-id="${esc(r.id)}">${kicon(r.kind)}<span class="c-t"><b>${esc(r.title)}</b>${r.why ? `<em>${esc(r.why.slice(0, 140))}</em>` : ''}</span><span class="c-m">${esc(date(r.date, { year: false }))}</span></button>`).join('')}`).join('') || '<div class="c-note">Nothing matches.</div>';
    const ids = rows.map(r => r.id);
    $$('[data-id]', el).forEach(b => b.onclick = () => openSource(ids, ids.indexOf(b.dataset.id)));
    $$('[data-k]', el).forEach(b => b.classList.toggle('on', S.fileKinds.has(b.dataset.k)));
  };
  $$('[data-k]', el).forEach(b => b.onclick = () => { const k = b.dataset.k; S.fileKinds.has(k) ? S.fileKinds.delete(k) : S.fileKinds.add(k); draw(); });
  draw();
}

// ---------- Share sheet ----------
const policyFor = (sw, note) => ({ ...(S.defaultPolicy || {}), status: sw.status, asks: sw.status, records: sw.status, milestones: sw.status, treatment: sw.treatment, coverage: sw.coverage, lien: false, hiddenItems: [], note });

function openShare() {
  const f = S.data.facts, provs = f.providers || [];
  if (!provs.length) return toast('No providers on this matter');
  S.share = { providerId: (provs.find(p => p.asks?.length) || provs[0]).id, sw: { status: true, treatment: true, coverage: false }, note: '', sent: null };
  const covLimit = f.kpis.coverage?.value;
  const sw = (k, t, s, extra = '') => `<label class="c-sw" data-sw="${k}"><span class="c-swt"><b>${t}</b><span>${s}</span>${extra}</span><input type="checkbox" ${S.share.sw[k] ? 'checked' : ''}><i></i></label>`;
  const el = openSheet({ title: 'Share with a doctor', chip: 'Share', wide: true, cls: 'share', body: `<div class="c-share">
    <div class="c-compose">
      <label class="c-field"><span class="c-lbl">To</span><select id="shto">${provs.map(p => `<option value="${p.id}">${esc(p.short || p.name)}${p.asks?.length ? ` · ${p.asks.length} open ask${p.asks.length > 1 ? 's' : ''}` : ''}</option>`).join('')}</select></label>
      <div class="c-sws">
        ${sw('status', 'Case status and what we need', 'Stage, last movement, open asks')}
        ${sw('treatment', 'Injuries and treatment', 'Treatment status and upcoming visits, no documents')}
        ${sw('coverage', 'Insurance', 'Sensitive · off by default', `<span class="c-warn">Shares the ${money(covLimit)} limit</span>`)}
      </div>
      <div class="c-never">${icon.lock}Never shared: internal notes, case value, settlement talk, liens.</div>
      <label class="c-field"><span class="c-lbl">Personal note</span><textarea id="shnote" rows="3" placeholder="Optional note to the office"></textarea></label>
      <button class="c-btn c-pri wide" id="shsend">Send secure link</button>
      <div class="c-small">Expires in 30 days · you can revoke it</div>
      <div id="shout"></div>
    </div>
    <div class="c-pvcol"><div class="c-lbl" id="pvlbl">Live preview</div><div class="c-phone"><div class="c-notch"></div><div class="c-scr" id="pv"><div class="spinner"></div></div></div></div>
  </div>` });
  $('#shto', el).value = String(S.share.providerId);
  $('#shto', el).onchange = (e) => { S.share.providerId = Number(e.target.value); S.share.sent = null; drawOut(); refresh(); };
  $$('[data-sw] input', el).forEach(inp => inp.onchange = () => { S.share.sw[inp.closest('[data-sw]').dataset.sw] = inp.checked; paint(); refresh(); });
  $('#shnote', el).oninput = (e) => { S.share.note = e.target.value; refresh(); };
  $('#shsend', el).onclick = send;
  const paint = () => $$('[data-sw]', el).forEach(r => r.classList.toggle('amber', r.dataset.sw === 'coverage' && S.share.sw.coverage));
  let t;
  const refresh = () => { clearTimeout(t); t = setTimeout(loadPreview, 150); };
  async function loadPreview() {
    const p = provs.find(x => x.id === S.share.providerId);
    $('#pvlbl', el).textContent = `Live preview · exactly what ${p?.short || 'the office'} will see`;
    try {
      const v = await api('/api/shares/preview', { method: 'POST', body: { providerId: S.share.providerId, policy: policyFor(S.share.sw, S.share.note) } });
      // The preview is the doctor's real page, rendered by the same code the secure link uses.
      $('#pv', el).innerHTML = renderProviderView(v, { preview: true });
    } catch (e) { $('#pv', el).innerHTML = `<div class="c-muted" style="padding:20px">Preview unavailable: ${esc(e.message)}</div>`; }
  }
  async function send() {
    const b = $('#shsend', el); b.disabled = true; b.textContent = 'Sending…';
    try {
      const r = await api('/api/shares', { method: 'POST', body: { providerId: S.share.providerId, policy: policyFor(S.share.sw, S.share.note), note: S.share.note } });
      S.share.sent = r; toast('Secure link created');
      S.shares = (await api('/api/shares').catch(() => ({ shares: S.shares }))).shares; render();
    } catch (e) { toast(`Could not create link: ${e.message}`); }
    b.disabled = false; b.textContent = 'Send secure link'; drawOut();
  }
  function drawOut() {
    const out = $('#shout', el), r = S.share.sent;
    const links = S.shares.filter(s => s.provider_id === S.share.providerId && !s.revoked_at && s.token !== r?.token).slice(-3).reverse();
    const full = (u) => new URL(u, location.origin).href;
    out.innerHTML = `${r ? `<div class="c-sent"><div class="c-lbl">Secure link</div><div class="c-url"><input readonly value="${esc(full(r.url || `/p/${r.token}`))}"><button class="c-btn sm" data-copy="${esc(full(r.url || `/p/${r.token}`))}">${icon.copy}Copy</button></div><div class="c-small left">Expires in 30 days · you can revoke it <button class="c-link red" data-revoke="${esc(r.token)}">Revoke</button></div></div>` : ''}
      ${links.length ? `<div class="c-lbl" style="margin-top:14px">Earlier links to this office</div>${links.map(s => `<div class="c-old"><span>Sent ${esc(date(s.created_at.slice(0, 10), { year: false }))} · ${s.views?.length ? `<b class="c-green">opened ${s.views.length}×</b>` : '<b class="c-amber">not opened</b>'}</span><button class="c-link red" data-revoke="${esc(s.token)}">Revoke</button></div>`).join('')}` : ''}`;
    $$('[data-copy]', out).forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Link copied'); } catch { $('input', out)?.select(); toast('Press Cmd+C to copy'); } });
    $$('[data-revoke]', out).forEach(b => b.onclick = async () => {
      try { await api(`/api/shares/${encodeURIComponent(b.dataset.revoke)}/revoke`, { method: 'POST' }); toast('Link revoked'); } catch (e) { return toast(`Revoke failed: ${e.message}`); }
      if (S.share.sent?.token === b.dataset.revoke) S.share.sent = null;
      S.shares = (await api('/api/shares').catch(() => ({ shares: S.shares }))).shares; render(); drawOut();
    });
  }
  paint(); drawOut(); loadPreview();
}

function phone(v) {
  const st = v.status, stages = st?.stages || [], at = stages.indexOf(st?.stage);
  const tr = v.treatment, cov = v.coverage;
  const pn = v.patient?.name || '', pf = pn.split(' ')[0];
  return `<div class="c-pvh"><div class="c-muted">From ${esc(v.firm?.name || v.firm?.attorney || 'the firm')}</div><div class="c-pvname">${esc(pn)}</div>${v.patient?.dob ? `<div class="c-muted">DOB ${esc(date(v.patient.dob))}</div>` : ''}</div>
    ${st ? `<div class="c-pc ${st.open ? 'g' : ''}"><b>${st.open ? '● The case is active' : 'The case is closed'}</b><div>In ${esc(String(st.stage).toLowerCase())}${st.lastMovement ? ` · moved ${esc(ago(st.lastMovement, v.asOf))}` : ''}</div>
      ${stages.length ? `<div class="c-prog">${stages.map((s, j) => `<i class="${j <= at ? 'on' : ''}" title="${esc(s)}"></i>`).join('')}</div><div class="c-progl"><span>${esc(stages[0])}</span><span>${esc(stages.at(-1))}</span></div>` : ''}</div>` : ''}
    ${v.note ? `<div class="c-pc"><div class="c-lbl">Note from the firm</div><div>${esc(v.note)}</div></div>` : ''}
    ${v.asks?.length ? `<div class="c-pc"><div class="c-lbl">We need from you</div>${v.asks.map(a => `<div class="c-pask"><b>${esc(a.title)}</b>${a.overdue ? '<span class="c-red">overdue</span>' : a.due ? `<span class="c-muted">by ${esc(date(a.due, { year: false }))}</span>` : ''}</div>`).join('')}<div class="c-btn c-blue wide">Reply to the firm</div></div>` : ''}
    ${tr ? `<div class="c-pc"><div class="c-lbl">Is ${esc(pf)} still treating?</div><b class="${tr.ongoing ? 'c-green' : ''}">${tr.ongoing ? 'Yes, treatment is ongoing' : 'No ongoing treatment recorded'}</b>${(tr.upcoming || []).slice(0, 3).map(u => `<div class="c-muted">${esc(date(u.date, { year: false }))} · ${esc(u.title)}</div>`).join('')}</div>` : ''}
    ${cov ? `<div class="c-pc amber"><div class="c-lbl">Insurance behind the case</div><b>${money(cov.liabilityLimit)}</b>${cov.confirmed ? `<div class="c-muted">Confirmed ${esc(date(cov.confirmedOn))}</div>` : ''}</div>` : ''}`;
}

boot().catch(e => {
  $('#app').innerHTML = `<div class="c-loading"><b>Could not load the matter</b><div class="c-muted">${esc(e.message)}</div><a class="c-btn" href="/auth/clio">Connect Clio</a></div>`;
});
