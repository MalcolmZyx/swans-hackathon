// Doctor-facing "Patient screen": four answers on one screen, phone first.
// Used by the portal (/p/<token>) and by the attorney's live preview (preview: true),
// so the attorney sees exactly what the doctor will. Every string comes from the API.
import { esc, money, date, ago } from './common.js';

const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const joinAnd = (xs) => xs.length <= 1 ? (xs[0] || '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
const ACRONYM = /^[A-Z]{2,}$/;

// "Physical therapy, SportsCare" + "Chiropractic adjustment, Advanced Rockland" -> "physical therapy and chiropractic adjustment"
function summariseVisits(upcoming = []) {
  const seen = new Set(); const out = [];
  for (const u of upcoming) {
    let t = String(u?.title || '').replace(/,\s*[^,]+$/, '').replace(/\s+[-–·:]\s+.*$/, '').trim();
    if (!t) continue;
    t = t.split(' ').map(w => ACRONYM.test(w) ? w : w.toLowerCase()).join(' ');
    if (!seen.has(t)) { seen.add(t); out.push(t); }
  }
  return joinAnd(out.slice(0, 3));
}

const until = (d, today) => {
  if (!d) return '';
  const n = Math.round((new Date(d) - new Date(today || Date.now())) / 86400000);
  return n > 0 && n < 60 ? `in ${n} day${n === 1 ? '' : 's'}` : '';
};

export function requestMailto(v, type, msg) {
  const to = v.firm?.email || '';
  const subject = `${type} · ${v.patient?.name || 'our patient'}`;
  const body = [`Regarding ${v.patient?.name || 'our patient'}${v.patient?.dob ? ` (DOB ${date(v.patient.dob)})` : ''}:`, '', msg || type, '', v.provider?.name || ''].join('\n');
  return `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
export function mailtoFor(v) {
  const to = v.firm?.email || '';
  const subject = `Re: ${v.patient?.name || 'our patient'} records`;
  const asks = (v.asks?.length ? v.asks.map(a => a.title) : (v.update?.asks || [])).filter(Boolean);
  const body = [
    `Hi ${firstName(v.firm?.attorney) || 'there'},`, '',
    `Regarding ${v.patient?.name || 'our patient'}${v.patient?.dob ? ` (DOB ${date(v.patient.dob)})` : ''}:`, '',
    ...asks.map(a => `- ${a}: `), '',
    v.provider?.name || '',
  ].join('\n');
  return `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

const followText = (on) => on ? 'On · we\'ll let you know' : 'Only when the stage changes or the firm needs something';

export function renderProviderView(v, { preview = false } = {}) {
  if (!v || v.error) {
    return `<div class="pv-wrap"><div class="pv-empty"><div class="pv-empty-i">&#9675;</div><b>This link isn't available</b><p>${esc(v?.error || 'Something went wrong loading this page.')}</p></div></div>`;
  }
  const p = v.patient || {}, firm = v.firm || {}, st = v.status;
  const first = firstName(p.name);
  const firmLabel = firm.name || firm.attorney || 'the firm';

  // 1 · Who is this about
  const top = `<header class="pv-head">
      <div class="pv-from"><span class="pv-mark"></span>From ${esc(firm.name || firm.attorney || 'your patient\'s attorney')}${firm.name && firm.attorney && !firm.name.includes(firm.attorney) ? ` · ${esc(firm.attorney)}` : ''} · secure link</div>
      <div class="pv-about">About your patient</div>
      <h1>${esc(p.name || '')}</h1>
      <div class="pv-sub">${[p.dob && `DOB ${date(p.dob)}`, p.doi && `injured ${date(p.doi)}`].filter(Boolean).join(' · ')}</div>
    </header>`;

  const note = v.note ? `<section class="pv-note"><p>${esc(v.note)}</p><cite>${esc(firm.attorney || firmLabel)}</cite></section>` : '';

  // 2 · Is the case alive?
  let alive = '';
  if (st || v.update?.summary) {
    const stages = st?.stages || [];
    const idx = st ? stages.indexOf(st.stage) : -1;
    const open = st ? st.open !== false : true;
    const moved = st?.lastMovement ? `Last moved ${date(st.lastMovement)}${v.asOf ? ` · ${ago(st.lastMovement, v.asOf)}` : ''}` : '';
    alive = `<section class="pv-card pv-alive ${open ? '' : 'closed'}">
        ${st ? `<b class="pv-alive-h"><span class="pv-dot"></span>${open ? 'The case is active' : 'The case is closed'}</b>
        ${moved ? `<div class="pv-alive-s">${esc(moved)}</div>` : ''}
        ${stages.length ? `<div class="pv-bar" role="img" aria-label="Step ${idx + 1} of ${stages.length}">${stages.map((s, i) => `<i class="${i < idx ? 'done' : i === idx ? 'now' : ''}" title="${esc(s)}"></i>`).join('')}</div>` : ''}` : ''}
        ${v.update?.summary ? `<p class="pv-summary">${esc(v.update.summary)}</p>` : ''}
      </section>`;
  }

  // 3 · What do they need from my office?
  const asks = v.asks || [];
  const reply = preview
    ? `<span class="pv-btn" aria-disabled="true">Reply to ${esc(firmLabel)}</span>`
    : `<a class="pv-btn" href="${esc(mailtoFor(v))}">Reply to ${esc(firmLabel)}</a>`;
  const need = `<section class="pv-card">
      <div class="pv-lbl">We need from you</div>
      ${asks.length ? asks.map(a => `<div class="pv-ask ${a.overdue ? 'over' : ''}">
          <b>${esc(a.title)}</b>
          ${a.detail ? `<p>${esc(a.detail)}</p>` : ''}
          ${a.due ? `<span class="pv-due">${a.overdue ? `Past due · was needed by ${date(a.due, { year: false })}` : `Needed by ${date(a.due, { year: false })}${until(a.due, v.asOf) ? ` · ${until(a.due, v.asOf)}` : ''}`}</span>` : ''}
        </div>`).join('') : `<p class="pv-none">Nothing right now. Thank you.</p>`}
      ${reply}
    </section>`;

  // 4 · Is there coverage? (only if the lawyer shared it)
  const cov = v.coverage;
  const coverage = cov && cov.liabilityLimit != null ? `<section class="pv-card pv-cov">
      <div class="pv-lbl">Insurance behind the case</div>
      <div class="pv-big">${cov.confirmed ? 'Insurance confirmed' : 'Insurance reported'}</div>
      <div class="pv-amt">${esc(money(cov.liabilityLimit))} <span>liability limit</span></div>
      <div class="pv-mute">${cov.confirmed ? `Confirmed in writing${cov.confirmedOn ? ` ${date(cov.confirmedOn)}` : ''}` : 'Not yet confirmed in writing'}</div>
    </section>` : '';

  // 5 · Is my patient still treating?
  const tr = v.treatment;
  let treating = '';
  if (tr) {
    const up = tr.upcoming || [];
    const what = summariseVisits(up);
    const next = up.map(u => u.date).filter(Boolean).sort()[0];
    const ongoing = tr.ongoing ?? st?.treatmentOngoing;
    const yes = ongoing || up.length > 0;
    const head = yes ? `Yes${what ? ` · ${esc(what)}` : ''}` : 'No · treatment complete';
    const sub = up.length ? `Next visit ${date(next)}${until(next, v.asOf) ? ` · ${until(next, v.asOf)}` : ''}` : 'No visits scheduled';
    treating = `<section class="pv-card">
        <div class="pv-lbl">Is ${esc(first || 'your patient')} still treating?</div>
        <b class="pv-treat ${yes ? 'yes' : ''}">${head}</b>
        <div class="pv-mute">${esc(cap(sub))}</div>
      </section>`;
  }

  // 6 · Tell me when the case moves
  const on = !!v.following;
  const follow = `<label class="pv-follow">
      <span><b>Tell me when the case moves</b><em class="pv-follow-s">${followText(on)}</em></span>
      <input type="checkbox" class="pv-tog" role="switch" ${on ? 'checked' : ''} ${preview ? 'disabled' : ''} aria-label="Tell me when the case moves">
    </label>`;

  // 7 · Footer
  const foot = `<footer class="pv-foot">Shared by ${esc(firm.attorney || firmLabel)} · read-only${v.expiresAt ? ` · this link expires ${date(v.expiresAt)}` : ''}</footer>`;

  // 8 · Case summary in plain words: what happened and what is being treated.
  const summary = (v.update?.summary || v.injuries?.length) ? `<section class="pv-card">
      <div class="pv-lbl">Case summary</div>
      ${v.update?.summary ? `<p class="pv-sumtext">${esc(v.update.summary)}</p>` : ''}
      ${v.injuries?.length ? `<div class="pv-chips">${v.injuries.map(r => `<span>${esc(cap(r))}</span>`).join('')}</div>` : ''}
    </section>` : '';

  // 9 · Billing: what this office has billed on the matter, and how it gets paid.
  const b = v.billing;
  const billing = b ? `<section class="pv-card">
      <div class="pv-lbl">Your billing on this case</div>
      <div class="pv-amt">${esc(money(b.total))} <span>${b.count} statement${b.count > 1 ? 's' : ''}</span></div>
      <div class="pv-mute">${b.from ? `Services ${date(b.from)}${b.to && b.to !== b.from ? ` – ${date(b.to)}` : ''}` : ''}</div>
      <div class="pv-pill">${esc(b.status)}</div>
      <div class="pv-mute">Included in the firm's medical specials for the claim.</div>
    </section>` : '';

  // 10 · Timeline of this office's visits on the firm's calendar.
  const visits = v.visits?.length ? `<section class="pv-card">
      <div class="pv-lbl">Visits on file</div>
      <ol class="pv-tl">${v.visits.map(x => `<li class="${x.upcoming ? 'up' : ''}"><b>${esc(date(x.date))}</b><span>${esc(x.title)}${x.upcoming ? ' · upcoming' : ''}</span></li>`).join('')}</ol>
    </section>` : '';

  // 11 · Send a request to the firm (opens an email; nothing is written to Clio).
  const reqTypes = ['Send the surgery date', 'Ask about payment / lien status', 'Ask for a records authorization', 'Something else'];
  const request = preview ? '' : `<section class="pv-card">
      <div class="pv-lbl">Send a request to the firm</div>
      <select class="pv-in" id="pvreqt">${reqTypes.map(t => `<option>${esc(t)}</option>`).join('')}</select>
      <textarea class="pv-in" id="pvreqm" rows="3" placeholder="Add details (optional)"></textarea>
      <a class="pv-btn pv-btn2" id="pvreqs" href="#">Send request</a>
    </section>`;

  return `<div class="pv-wrap ${preview ? '' : 'pv-wide'}"><div class="pv-col">${top}${note}${alive}${need}${coverage}${treating}</div><div class="pv-col">${summary}${billing}${visits}${request}${follow}</div>${foot}</div>`;
}

// Wires the follow switch on the live portal (not used by the attorney preview). Optimistic, reverts on error.
export function attachProviderView(root, token) {
  const box = root.querySelector('.pv-tog');
  const sub = root.querySelector('.pv-follow-s');
  if (!box) return;
  const label = (on) => { if (sub) sub.textContent = followText(on); };
  box.addEventListener('change', async () => {
    const want = box.checked;
    label(want); box.disabled = true;
    try {
      const res = await fetch(`/api/p/${encodeURIComponent(token)}/follow`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ follow: want }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.ok === false) throw new Error(j.error || 'failed');
      const now = typeof j.following === 'boolean' ? j.following : want;
      box.checked = now; label(now);
    } catch {
      box.checked = !want;
      if (sub) sub.textContent = 'Couldn\'t save that. Please try again.';
    } finally { box.disabled = false; }
  });
}
