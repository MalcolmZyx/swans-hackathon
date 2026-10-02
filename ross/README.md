# CaseLight

**The 90-second case brief for personal-injury firms, and a curated window for the providers treating on lien.**
Built for the Swans Applied AI Hackathon (Law-Di-Gras, San Diego, 2 Oct 2026) on the Sapini matter.

CaseLight reads one matter out of Clio Manage (GET only, never a write), digests every note, email, call, task, calendar entry, expense and document page, and renders two things:

1. **The attorney brief.** Client photo pulled from the ID in the file. Stage rail. Case value against the coverage that actually sits behind it, and what the client nets after fee, costs and the Medicaid lien. What is overdue, what is coming, what is waiting on someone else. What changed since you last opened the matter. The ten entries out of 162 that matter. How the case got here. Injuries pulled out of 522 scanned pages, with page cites. Every number, date and sentence opens the note, email, task or page it came from.
2. **The provider portal.** The attorney picks a provider, switches sections on or off, unticks any milestone, adds a note, and sees a live preview of exactly what the provider will see. One click creates a secure link; CaseLight logs every time it is opened, so the firm knows whether anyone at the provider's office actually read it.

## Run it

```bash
npm install --no-bin-links     # one dependency: @anthropic-ai/sdk
cp .env.example .env           # then fill in your Clio app key and secret
npm start                      # http://127.0.0.1:3000
```

Open http://127.0.0.1:3000. It starts on the bundled Clio replica of the Sapini file. Click **Connect Clio**, approve in Clio, and Clio sends you back to `http://127.0.0.1:3000/callback`; CaseLight then re-reads the matter from your real Clio account (GET only). The server listens on the port of `CLIO_REDIRECT_URI`, so it must match the redirect URI registered on your Clio app exactly.

Put the `Sapini documents` folder from the Swans case-materials zip into `fixtures/` (the replica serves those PDFs as Clio downloads; live mode downloads them from Clio instead).

Requires Node 22.5+ (for `node:sqlite`) and `poppler-utils` + `tesseract-ocr` on the PATH (`apt install poppler-utils tesseract-ocr`, `brew install poppler tesseract`).

| Variable | What it does |
| --- | --- |
| `CLIO_CLIENT_ID`, `CLIO_CLIENT_SECRET` | Your Clio app's key and secret (developers.clio.com). Keep them in `.env`, which git ignores. |
| `CLIO_REDIRECT_URI` | Must match the Clio app exactly. Default `http://127.0.0.1:3000/callback`. |
| `CLIO_BASE` | Region host: `https://app.clio.com` (default), `eu.app.clio.com`, `ca.app.clio.com`, `au.app.clio.com`. |
| `CLIO_MODE` | `auto` (default: replica until you connect, then live), `live`, or `replica`. `CLIO_ACCESS_TOKEN` skips OAuth. |
| `CLIO_MATTER_ID` / `CLIO_MATTER_QUERY` | Which matter to read (default: search for "Sapini"). |
| `ANTHROPIC_API_KEY` | Switches digestion and Ask from the offline engine to Claude. |
| `FIRM_NAME`, `FIRM_EMAIL` | Shown to doctors on their page and used by their Reply button (default: the responsible attorney and their Clio email). |
| `AS_OF` | Pin "today" (the Sapini data is resolved for 2026-10-02). |
| `CONTINGENCY_FEE` | Fee used in the net-to-client waterfall (default 0.3333, labelled as an assumption in the UI). |

### Live Clio vs the replica

The build reads Clio through `src/clio/client.js`, a client that can only send GET. Once connected it talks to `${CLIO_BASE}/api/v4` with your OAuth token (refreshed automatically). Before that, it talks to `src/clio/replica.js`: a local Clio v4 server that replays Swans' own `sapini-clio-data.json` into memory and answers the same GET endpoints with Clio's response envelope, ids and pagination. Same sync code, same field selections. A replica snapshot is never shown once you are connected to real Clio.

### Deploy to Railway

```bash
railway init                       # new project
railway up --no-gitignore          # ships the Sapini PDFs and OCR cache; .railwayignore keeps .env, node_modules and local DBs out
railway domain                     # gives https://<name>.up.railway.app
```

Set these service variables in Railway: `CLIO_CLIENT_ID`, `CLIO_CLIENT_SECRET`, `APP_PASSWORD` (the attorney side asks for it; doctor links stay open), and optionally `ANTHROPIC_API_KEY`. Leave `CLIO_REDIRECT_URI` unset: on Railway it defaults to `https://$RAILWAY_PUBLIC_DOMAIN/callback`. Add that exact URL to the Clio app's redirect URIs in the Clio developer portal, or Clio rejects the login. The Dockerfile installs poppler and tesseract. SQLite lives in the container, so a redeploy forgets the Clio connection and share links; mount a volume and set `DB_FILE=/data/caselight.db` to keep them.

### Ask

`POST /api/ask {q}` searches every note, email, call, task, calendar entry and OCR'd document page (BM25), then answers only from the top passages with numbered cites. With `ANTHROPIC_API_KEY` Claude writes the answer and every cite is checked against the passages it was given; without it the best matching sentences are quoted verbatim. If nothing in the file answers the question, the answer is "Not in the file."

## How it works

```
Clio v4 (GET only) ─▶ sync.js ──▶ CaseFile (every item has a stable id + Clio link)
                          │
                          ├─ documents ─▶ extract.js: pdftotext per page; empty pages are scans ─▶ pdftoppm + tesseract
                          │              cached by sha256, so a document is read once, ever
                          ▼
                      digest/
                        facts.js      exact numbers, dates and buckets computed from Clio fields (no model)
                        heuristic.js  offline scoring, top-10, injury extraction (also the pre-filter for Claude)
                        llm.js        Claude: item triage, injury extraction, the brief, provider updates
                          ▼
                      server.js ─▶ public/ (attorney app)  ·  /p/:token (provider portal)
                          │
                      SQLite (node:sqlite): snapshots, per-user "last seen", AI cache, share links, view log
```

**Facts are computed, not generated.** Case value, coverage, specials, liens, firm spend, the waterfall, overdue and waiting buckets, last client contact, provider record status and unanswered chasers all come from Clio fields and entries in `facts.js`. Claude is used where judgement is needed: what matters, why, how the story reads, and what a scanned page says.

**Never digest the whole case twice.** Every Claude call is cached in SQLite by a hash of its exact input. Item triage is cached per item, so a sync that brings in three new emails only pays for three emails. The brief re-runs only when the file actually changed. OCR is cached per file hash.

**Providers can't see what wasn't shared.** The provider view is assembled server-side from an allow-list policy. Case value, strategy notes, liability analysis and other providers' records are never serialised for a provider, and the provider-facing update is written by a model that is only ever given the allowed fields.

## AI models and cost per case

| Job | Model | Approx. tokens (Sapini) | Cost |
| --- | --- | --- | --- |
| Triage 162 entries (importance, why it matters, provider-relevant) | Claude Haiku 4.5 | 12k in / 7k out | ~$0.05 |
| Read ~155 flagged pages of medical records for diagnoses | Claude Haiku 4.5 | 100k in / 15k out | ~$0.18 |
| Write the brief (headline, story, top 10, risks, next moves, all cited) | Claude Opus 5.5 | 16k in / 6k out | ~$0.18 |
| Provider update per share | Claude Haiku 4.5 | 1k in / 0.2k out | <$0.01 |
| OCR of 522 scanned pages | tesseract, local | — | $0 |

**About $0.40 for the first full digest of a case; reopening is free (cached); a sync with a few new entries is about $0.15.** The footer of the app shows the running spend from the cache table.

Without an API key everything still runs on the offline engine (`heuristic.js`), and the UI says so ("Offline digest").

## Tech stack

- **Built with:** Node.js 22 (no web framework), vanilla ES modules and hand-written CSS/SVG on the front end, `@anthropic-ai/sdk`, poppler, tesseract.
- **Running on:** a single Node process (`npm start`), localhost.
- **Data outside Clio:** SQLite file at `data/caselight.db` (snapshots, last-seen markers, AI cache, share links, view log); OCR text cache in `data/text-cache/`; rendered page images in `data/pages/`.

## Where to look first

- `src/clio/client.js`: the GET-only Clio client.
- `src/digest/facts.js`: every number on the dashboard and where it comes from.
- `src/digest/llm.js`: the four Claude jobs and their caching.
- `src/share/provider.js`: the allow-list that decides what a provider sees.
- `public/app.js`: the attorney app. `public/provider-view.js`: the provider page (also used for the live preview).

## Honest notes

- The demo in this repo runs against the Clio replica because the build environment has no Clio account; switch `CLIO_MODE=live` to read the team's Clio. Clio web links (`Open in Clio`) point at `app.clio.com/nc/#/matters/<id>/...`.
- The waterfall's contingency fee (33.3%) is an assumption and is labelled as one.
- "Reply to the firm" on the provider page is a placeholder button; replies go by email today.
- Offline injury extraction is keyword-based and noisier than the Claude path; findings always link to the page so the reader can check.
