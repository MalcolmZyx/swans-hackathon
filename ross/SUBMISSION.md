# CaseLight: submission answers

**Project:** CaseLight. A 90-second case brief for the attorney, and a curated, view-tracked window for the providers treating on lien. Reads Clio Manage, writes nothing.

**Tech stack.** Built with Node.js 22 (node:http, node:sqlite, no framework), vanilla ES modules with hand-written CSS and SVG, `@anthropic-ai/sdk`, poppler and tesseract for page text and OCR. Runs as one Node process. Data outside Clio lives in one SQLite file (snapshots, per-user last-seen markers, AI cache, share links, view log) plus an OCR text cache.

**AI models and cost per case.** Claude Haiku 4.5 triages every entry, reads flagged pages of the medical records and writes provider updates. Claude Opus 5.5 writes the cited brief with a JSON schema. All numbers on the dashboard are computed from Clio fields, not generated. Every call is cached by a hash of its input, so a case is never digested twice. About $0.40 for the first full digest of Sapini, $0 to reopen, about $0.15 for a sync with a few new entries. OCR runs locally for free. The table is in README.md.

**Notes for judges.**
- Read-only by construction: `src/clio/client.js` can only send GET. The header shows reads and "0 writes".
- Nothing is hardcoded to Sapini. `src/digest/facts.js` derives every figure from Clio fields and entries, each with source ids, and every number on screen opens the entry or page it came from.
- The provider view is built server-side from an allow-list. Case value, strategy notes and other providers' records are never sent to a provider. Every open of a link is logged and shown to the attorney.
- 522 of 662 document pages are scans; they are OCR'd once and cited by page.
- Demo runs against a local Clio v4 replica of Swans' `sapini-clio-data.json` (same endpoints, envelopes and pagination). Set `CLIO_MODE=live` with an OAuth token to read the real account.
- Without `ANTHROPIC_API_KEY` the app falls back to an offline engine and says "Offline digest".

**Not finished.** "Reply to the firm" on the provider page is a placeholder. The 33.3% fee in the waterfall is an assumption and is labelled as one.

**Design.** `docs/CaseLight-UI-Spec.pdf` is the annotated UI spec: every screen, the reasoning behind it, and the 90-second demo script (slide 18).
