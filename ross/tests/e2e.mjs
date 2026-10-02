// End-to-end walkthrough of every flow in the design deck, driven in real Chrome.
// Run with the server up:  node tests/e2e.mjs   (BASE=http://127.0.0.1:3000 by default)
// Lawyer journey (deck p.8 left) then doctor journey (p.8 right), then the loop closing back on the Case screen.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const SHOTS = new URL('../test-results/', import.meta.url).pathname;
await fs.mkdir(SHOTS, { recursive: true });

const results = [];
const t0 = Date.now();
async function step(name, fn) {
  const s = Date.now();
  try { const note = await fn(); results.push({ name, ok: true, ms: Date.now() - s, note }); console.log(`PASS  ${name}${note ? ` (${note})` : ''}  ${Date.now() - s}ms`); }
  catch (e) { results.push({ name, ok: false, ms: Date.now() - s, err: e.message }); console.log(`FAIL  ${name}: ${e.message.split('\n')[0]}`); }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

const browser = await chromium.launch({ channel: 'chrome', headless: process.env.HEADED ? false : true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
const shot = (n, p = page) => p.screenshot({ path: `${SHOTS}${n}.png` });
const closeSheets = async () => { while (await page.locator('.c-sheetwrap').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(260); } };

// ---------- 1. Data from Clio populates the Case screen ----------
await step('Clio: status is live and read-only', async () => {
  const s = await (await fetch(`${BASE}/api/clio/status`)).json();
  expect(s.mode === 'live', `mode is ${s.mode}, expected live`);
  return `matter ${s.matter}, connected as ${s.connectedAs || '?'}`;
});
await step('Clio: case API returns matter, timeline and documents', async () => {
  const d = await (await fetch(`${BASE}/api/case`)).json();
  expect(d.facts?.hero?.client, 'no client name');
  expect(d.timeline?.length > 20, `only ${d.timeline?.length} timeline entries`);
  expect(d.meta?.documents?.length > 5, `only ${d.meta?.documents?.length} documents`);
  expect(/0 writes|Clio Manage/.test(JSON.stringify(d.meta)), 'meta missing source');
  return `${d.timeline.length} entries, ${d.meta.documents.length} documents, ${d.meta.clioRequests} Clio reads`;
});
await step('Case screen loads in under 10s', async () => {
  const s = Date.now();
  await page.goto(`${BASE}/case`);
  await page.locator('.c-who h1').waitFor({ timeout: 60000 });
  const ms = Date.now() - s; expect(ms < 10000, `took ${ms}ms`);
  await shot('01-case-screen');
  return `${ms}ms`;
});
await step('Case screen: person, one sentence, three numbers', async () => {
  const name = await page.locator('.c-who h1').innerText();
  expect(/Sapini/i.test(name), `name is "${name}"`);
  const head = await page.locator('.c-head').innerText();
  expect(head.length > 30, 'headline missing');
  expect(await page.locator('.c-head .c-cite').count() >= 1, 'headline has no citation');
  const nums = await page.locator('.c-num b').allInnerTexts();
  expect(nums.length === 3 && nums.every(n => /\$/.test(n)), `numbers: ${nums}`);
  return `${name} · ${nums.join(' / ')}`;
});
await step('Case screen: New since you looked + Needs you (max 3 each)', async () => {
  const lists = page.locator('.c-list');
  expect(await lists.count() === 2, 'expected two lists');
  for (let i = 0; i < 2; i++) expect(await lists.nth(i).locator('.c-li').count() <= 3, 'list longer than 3');
  expect(await lists.nth(1).locator('.c-li').count() >= 1, 'Needs you is empty');
});
await step('Read-only badge visible', async () => {
  const ro = await page.locator('#ro').innerText();
  expect(/Read-only/i.test(ro), `badge: ${ro}`);
});
await step('Brand: ROSS in black letters', async () => {
  const b = page.locator('.c-brand');
  const txt = (await b.innerText()).trim();
  expect(txt === 'ROSS', `brand text is "${txt}"`);
  const color = await b.evaluate(el => getComputedStyle(el).color);
  expect(/rgb\(0, 0, 0\)|rgb\(29, 29, 31\)/.test(color), `brand colour ${color}`);
  expect(/ROSS/.test(await page.title()), `title "${await page.title()}"`);
});

// ---------- 2. Tap a number: source sheet with the exact line ----------
await step('Tap Insurance → source sheet with highlighted line', async () => {
  await page.locator('.c-num').nth(1).click();
  const sheet = page.locator('.c-sheet').last();
  await sheet.waitFor();
  await page.waitForTimeout(600);
  const txt = await sheet.innerText();
  expect(/\$|limit|coverage|policy/i.test(txt), 'source does not mention coverage');
  await shot('02-source-insurance');
  await closeSheets();
});

// ---------- 3. Ask (RAG) with references that open the document ----------
async function ask(q) {
  await closeSheets();
  await page.fill('#askq', q);
  await page.press('#askq', 'Enter');
  const a = page.locator('.c-a').last();
  await page.waitForFunction(() => { const x = [...document.querySelectorAll('.c-a')].at(-1); return x && !x.classList.contains('pending'); }, null, { timeout: 60000 });
  return a;
}
for (const [q, want] of [
  ['Has he had the shoulder surgery?', /left|right|surgery|arthroscop|repair/i],
  ['What are the policy limits?', /\$\s?\d/],
  ['What did the MRI of the right shoulder show?', /tear|MRI|labrum|infraspinatus/i],
  ['Who is the treating orthopedic surgeon?', /Dr|McCulloch|Capiola|ortho/i],
]) {
  await step(`Ask: "${q}" → cited answer`, async () => {
    const a = await ask(q);
    const txt = await a.innerText();
    expect(!/Not in the file/i.test(txt), 'answered "Not in the file"');
    expect(want.test(txt), `answer does not match ${want}: ${txt.slice(0, 160)}`);
    const n = await a.locator('.c-srcrow').count();
    expect(n >= 1, 'no sources listed');
    return `${n} sources: ${txt.split('\n')[0].slice(0, 90)}`;
  });
}
await step('Click a document reference → PDF page opens with passage highlighted', async () => {
  const a = await ask('What did the MRI of the right shoulder show?');
  const docRow = a.locator('.c-srcrow', { hasText: /p\.\d+/ }).first();
  expect(await docRow.count(), 'no document (page) source in answer');
  await docRow.click();
  const sheet = page.locator('.c-sheet').last();
  const img = sheet.locator('.c-page-img');
  await img.waitFor();
  await page.waitForFunction(() => { const i = [...document.querySelectorAll('.c-page-img')].at(-1); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('.c-hl-layer i'), null, { timeout: 30000 }).catch(() => {});
  const boxes = await sheet.locator('.c-hl-layer i').count(), marks = await sheet.locator('.c-ocr mark').count();
  expect(boxes > 0, `no highlight box on the page image (${marks} marks in text)`);
  const pdfHref = await sheet.locator('a', { hasText: 'Open PDF' }).getAttribute('href');
  expect(/#page=\d+/.test(pdfHref), `PDF link ${pdfHref}`);
  const r = await fetch(new URL(pdfHref, BASE)); expect(r.ok && /pdf/.test(r.headers.get('content-type')), 'PDF link not served');
  await page.waitForTimeout(800);
  await shot('03-source-pdf-highlight');
  return `${boxes} highlight boxes on page image, ${marks} marks in text, ${pdfHref}`;
});
await step('Ask: "When is the trial date?" → Not in the file', async () => {
  const a = await ask('When is the trial date?');
  const txt = await a.innerText();
  expect(/Not in the file/i.test(txt), `answer: ${txt.slice(0, 160)}`);
  await shot('04-not-in-file');
});
await step('Ask is fast (< 3s)', async () => {
  const s = Date.now(); await ask('What injuries does he have?'); const ms = Date.now() - s;
  expect(ms < 3000, `${ms}ms`); return `${ms}ms`;
});

// ---------- 4. Full file ----------
await step('Full file sheet lists entries and opens one', async () => {
  await closeSheets();
  await page.click('#filebtn');
  const sheet = page.locator('.c-sheet').last();
  await sheet.locator('.c-frow').first().waitFor();
  const n = await sheet.locator('.c-frow').count();
  expect(n > 20, `only ${n} rows`);
  await sheet.locator('.c-frow').first().click();
  await page.locator('.c-sheet').nth(1).waitFor();
  await closeSheets();
  return `${n} entries`;
});

// ---------- 5. Share with a doctor ----------
let link;
await step('Share: 3 switches, insurance off by default, live preview', async () => {
  await closeSheets();
  await page.click('#sharebtn');
  const sheet = page.locator('.c-sheet').last();
  await sheet.locator('#pv').waitFor();
  const sws = sheet.locator('[data-sw] input');
  expect(await sws.count() === 3, 'expected 3 switches');
  expect(!(await sws.nth(2).isChecked()), 'insurance on by default');
  await page.waitForFunction(() => !document.querySelector('#pv .spinner'), null, { timeout: 15000 });
  const before = await sheet.locator('#pv').innerText();
  expect(!/Insurance behind/i.test(before), 'preview shows insurance while off');
  await sheet.locator('[data-sw="coverage"]').click();
  await page.waitForFunction(() => /Insurance behind/i.test(document.querySelector('#pv').innerText), null, { timeout: 10000 });
  expect(await sheet.locator('[data-sw="coverage"].amber').count() === 1, 'insurance switch not amber');
  await shot('05-share-insurance-on');
  await sheet.locator('[data-sw="coverage"]').click();
  await page.waitForFunction(() => !/Insurance behind/i.test(document.querySelector('#pv').innerText), null, { timeout: 10000 });
  const pv = await sheet.locator('#pv').innerText();
  expect(/active/i.test(pv) && /need/i.test(pv), 'preview missing status or asks');
});
await step('Share: send secure link → link shown, doctor row says not opened', async () => {
  const sheet = page.locator('.c-sheet').last();
  await sheet.locator('#shsend').click();
  await sheet.locator('.c-url input').waitFor({ timeout: 10000 });
  link = await sheet.locator('.c-url input').inputValue();
  expect(/\/p\/[\w-]+$/.test(link), `link ${link}`);
  await shot('06-share-sent');
  await closeSheets();
  const docs = await page.locator('.c-line', { hasText: 'Doctors' }).innerText();
  expect(/not opened/i.test(docs), `doctor line: ${docs}`);
  return link;
});

// ---------- 6. Doctor: patient screen on a phone, no login ----------
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const dp = await phone.newPage();
dp.on('pageerror', e => errors.push(`doctor: ${e.message}`));
await step('Doctor: link opens with no login, four answers on one screen', async () => {
  const s = Date.now();
  await dp.goto(link);
  await dp.locator('.pv-card').first().waitFor({ timeout: 15000 });
  const txt = await dp.locator('#pv').innerText();
  expect(/Sapini/i.test(txt), 'no patient name');
  expect(/case is active/i.test(txt), 'no "case is active"');
  expect(/We need from you/i.test(txt), 'no asks');
  expect(/still treating/i.test(txt), 'no treating answer');
  expect(!/Insurance behind|\$100,000|liability (limit|policy)/i.test(txt), 'insurance shown though not shared');
  expect(!/\$375|case value|settlement/i.test(txt), 'leaks case value');
  await dp.screenshot({ path: `${SHOTS}07-doctor-phone.png`, fullPage: true });
  return `${Date.now() - s}ms`;
});
await step('Doctor: Reply opens an email to the firm', async () => {
  const href = await dp.locator('a.pv-btn').first().getAttribute('href');
  expect(/^mailto:/.test(href), `reply href ${href}`);
});
await step('Doctor: "Tell me when the case moves" switch saves', async () => {
  const tog = dp.locator('.pv-tog');
  const was = await tog.isChecked();
  await dp.locator('.pv-follow').click();
  await dp.waitForTimeout(800);
  const s = await (await fetch(`${BASE}/api/p/${link.split('/').pop()}`, { headers: { 'x-preview': '1' } })).json();
  expect(s.following === !was, `following=${s.following}`);
});

// ---------- 7. Loop closes: lawyer sees the doctor opened it ----------
await step('Lawyer: doctor row now shows opened', async () => {
  await page.reload();
  await page.locator('.c-who h1').waitFor();
  const docs = await page.locator('.c-line', { hasText: 'Doctors' }).innerText();
  expect(/opened/i.test(docs) && !/^.*not opened.*$/i.test(docs.split('·').pop()), `doctor line: ${docs}`);
  await shot('08-loop-closed');
  return docs.replace(/\s+/g, ' ');
});
await step('Revoke link → doctor sees it is no longer active', async () => {
  const token = link.split('/').pop();
  await fetch(`${BASE}/api/shares/${token}/revoke`, { method: 'POST' });
  await dp.reload();
  const txt = await dp.locator('#pv').innerText();
  expect(/no longer active|isn't available/i.test(txt), txt.slice(0, 120));
});

// ---------- 8. Mobile lawyer view + no JS errors ----------
await step('Case screen works at phone width (no horizontal scroll)', async () => {
  const mp = await phone.newPage();
  await mp.goto(`${BASE}/case`); await mp.locator('.c-who h1').waitFor();
  const over = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  await mp.screenshot({ path: `${SHOTS}09-lawyer-phone.png`, fullPage: true });
  expect(over <= 1, `overflows by ${over}px`);
});
await step('No JavaScript errors', async () => { expect(!errors.length, errors.slice(0, 3).join(' | ')); });

await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await fs.writeFile(`${SHOTS}results.json`, JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
