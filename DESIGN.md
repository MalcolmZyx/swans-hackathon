# ROSS: complete design and build spec

**ROSS is a 90-second case brief for personal-injury attorneys, and a curated, view-tracked page for the doctors treating their client on a lien. It sits on top of Clio Manage, reads it, and never writes to it.**

This file is the single source of truth. Hand it to an engineer or to Claude with the Sapini case materials and it is enough to rebuild the product: the problem, the users, every screen and string that matters, the design system, the architecture, the algorithms, the AI prompts, the API, the data model, deployment and the test plan.

The product was first built under the working name *CaseLight*; it is now **ROSS**. Wherever older files, PDFs or code say CaseLight, read ROSS.

**Where the latest code lives (Oct 2, 2026, 21:30 UTC).** The ROSS rename, the Apple-style redesign, the 25 browser tests and the fixes in §14, §22 and §26 were made on the copy running on Bijin's Mac (the one that is demoed and deployed to Railway). The copy in this project folder predates them. This document describes the product as it should be, ROSS included; where the two copies differ, the Mac copy and this document win.

---

## Contents

1. [The brief we are answering](#1-the-brief-we-are-answering)
2. [Users and what they asked for](#2-users-and-what-they-asked-for)
3. [Design principles](#3-design-principles)
4. [How ROSS is different](#4-how-ross-is-different)
5. [Information architecture](#5-information-architecture)
6. [Screen specs](#6-screen-specs)
7. [Visual design system](#7-visual-design-system)
8. [Voice and copy rules](#8-voice-and-copy-rules)
9. [User journeys](#9-user-journeys)
10. [Architecture](#10-architecture)
11. [Clio integration](#11-clio-integration)
12. [The CaseFile model](#12-the-casefile-model)
13. [Ingest: documents, OCR, photo](#13-ingest-documents-ocr-photo)
14. [Digest: facts computed, not generated](#14-digest-facts-computed-not-generated)
15. [AI features, prompts and cost](#15-ai-features-prompts-and-cost)
16. [Ask: retrieval, answers, cited highlights](#16-ask-retrieval-answers-cited-highlights)
17. [Sharing with a doctor](#17-sharing-with-a-doctor)
18. [HTTP API](#18-http-api)
19. [Database](#19-database)
20. [Configuration](#20-configuration)
21. [Security and privacy](#21-security-and-privacy)
22. [Running and deploying](#22-running-and-deploying)
23. [Testing](#23-testing)
24. [The 90-second demo](#24-the-90-second-demo)
25. [Sapini golden values](#25-sapini-golden-values)
26. [Known gaps](#26-known-gaps)
27. [Build order](#27-build-order)

---

## 1. The brief we are answering

**Event.** Swans Applied AI Hackathon, Law-Di-Gras, San Diego, October 2, 2026. One day. Judges are trial attorneys and AI builders (the real buyers). Prizes $2,500 / $1,500 / $1,000. Top 7 pitch for 4 minutes; top 3 shown on the main stage.

**The problem, in Swans' words.** The case management system already *captures* everything (notes, emails, tasks, documents). Nobody has solved *digesting* it: turning a live case file into something a human absorbs in ninety seconds. And there are two sides with zero visibility: the firm reconstructs every case by hand, and the medical providers treating the client on a lien can't see where the case is or whether there is coverage behind it. Both fall back to email.

**The challenge.** Build a dashboard that (1) gets the firm's internal team up to speed on a case and (2) improves communication and visibility for the medical providers involved in the client's treatment. Both halves. Not "an AI chat you ask questions of": a *visual* digestion, so people get up to speed without knowing what to ask.

**Personal-injury law in one breath.** Someone gets hurt (a car crash). The attorney is paid only if the client wins. Doctors treat now and get paid from the settlement later: that's a **lien**. Liens are usually negotiated down at the end so the client nets more. The case takes years and the file grows to thousands of pages.

**Sharing rule from the brief.** A provider isn't part of the firm. Share status changes, bills and records. Don't share case strategy or anything confidential that isn't relevant to the provider. Not every attorney will share the same things, so the attorney chooses.

**The three rules that matter.**
1. Everyone builds on one matter, **Sapini**, read **live from Clio Manage**. The demo and the judging run on it.
2. Judges read the repository. Hardcoded features are spotted quickly. **Nothing may be Sapini-specific in code.**
3. **Clio is input only. Read everything, write nothing.** API calls that read are fine; anything that writes or updates case data is not. Bring your own database outside Clio.

**Submission.** A GitHub repo, a 90-second clip on Sapini, the tech stack (built with, running on, where data lives outside Clio), which AI models do the digestion and approximate cost per case, notes for judges, optional live link. Hard deadline 4:00 PM PT. Submission order is presentation order.

**Input data.** The Sapini matter is loaded into each team's Clio trial by Swans' setup app. Swans also ship it as Clio v4 request bodies: `fixtures/sapini-clio-data.json` (sections: `about`, `matter_stages`, `custom_fields` 16, `contacts` 10, `matter`, `relationships` 9, `folders` 9, `documents` 15, `notes` 42, `communications` 69, `tasks` 14, `calendar_entries` 17, `expenses` 5) plus a `Sapini documents/` folder of 15 PDFs (662 pages, 522 of them scans with no text layer). Matter stages must be created by hand in Clio (the API refuses writes to stages): Intake, Treatment, Demand, Negotiation, Litigation, Trial, Disbursement, Closed. Sapini sits in Litigation.

---

## 2. Users and what they asked for

### The lawyer (attorney, associate, paralegal)
An associate inheriting Sapini on Monday morning. Has two minutes, sometimes wants to dig into everything. Their own words from the brief, and the ROSS answer:

| They said | ROSS answer |
|---|---|
| "Get me up to speed on a case and show me what's happened recently, without me having to ask anyone." | Case screen: one sentence, three numbers, what's new, what needs you |
| "What changed since I last opened this matter?" | **New since you looked**, per person, by Clio etag, zero AI cost |
| "Out of three hundred entries, show me the ten that matter." | AI importance ranking drives every short list; Full file has all of it |
| "Sometimes I need to be up to speed in two minutes. Sometimes I need to dig into everything." | One screen, then sheets: Source, Ask, Full file (progressive disclosure) |
| "If a date is on screen, I need to see where it came from." / "I'd like to click on anything and open the note, document or email it came from." | Every number, date and sentence opens the **Source** sheet; document cites open the page image with the passage highlighted |
| "I want to see the client's picture as soon as I open their matter." | Face (from the ID scan when extractable, else initials) is the first thing on screen |
| "Somewhere in a 200-page scan are my client's primary injuries." | OCR every scan once; injuries line with page cites |
| "When did anyone last actually talk to the client?" | "Last contact <date>" under the name, opens that call or email |
| "Don't digest the whole case with AI again every time someone on my team opens it." | Every AI call cached by input hash; reopening costs $0 |
| "What's overdue, what's coming, and what's waiting on someone else?" | **Needs you**, max 3, red if late |
| "The two KPIs I care about most: what is the case worth, and what coverage sits behind it." | Worth · Insurance · Client nets |
| "How much has the firm already spent on this case?" | Firm spend is a deduction in "nets"; visible in the source |
| "What did we share with this provider, and has anyone in their office opened it?" | Doctors line: "opened your link Sep 30" / "not opened" |
| "I want the treating doctors to see where the case is without handing over my whole file." / "Let me adjust what the provider sees before I send it." / "I want a secure way of sharing part of my case." | **Share with a doctor**: 3 switches, live preview, secure expiring revocable link |

### The doctor (treating provider, usually their records coordinator)
Reads between patients, on a phone, never logs in, knows no legal terms.

| They said | ROSS answer |
|---|---|
| "I'm treating this patient on a lien. Is there coverage behind the case?" | Insurance card, **only if the firm switched it on** |
| "Is this case even still alive? I've chased money on cases that settled a year ago." | First answer, in green: **The case is active**, last moved N days ago, progress bar |
| "Tell me when the case moves. I shouldn't have to email for that." | One switch: *Tell me when the case moves* |
| "I only ever see the records I sent. I'm treating this patient with one eye closed." | Injuries/treatment summary across all doctors (no documents, no other providers' names) |
| "What does the firm need from my office right now?" | **We need from you** + one button, *Reply to <firm>* |
| "Is my patient still showing up to treatment?" | *Is Justin still treating?* Yes · physical therapy and chiropractic, next visit date |

The brief says "this is a menu, not a spec. Build the ones you believe in, and build them well." ROSS deliberately cut most of the menu into five things it does very well (see §3, Focus).

---

## 3. Design principles

Bijin set the design bar with two references. Every screen decision is traced to one of them.

### Apple Marketing Philosophy (Mike Markkula, Jan 3, 1977)
- **Empathy.** Understand their needs better than anyone. → The lawyer's screen starts with the *person* (face, name, last real conversation). The doctor's screen answers their four real questions in their words, with no legal stage names.
- **Focus.** Eliminate all of the unimportant opportunities. → v2 had 14 screens; v3 (ROSS) has 2 screens and 4 sheets. No list longer than three.
- **Impute.** People judge a book by its cover. → Real data, real page images, Apple-grade type and spacing, no lorem ipsum, no wireframe look. The product must *look* as trustworthy as it is.

### Apple WWDC17 Essential Design Principles (Mike Stern)
| Principle | Where it shows up |
|---|---|
| Predictability and stability | One screen per person. Everything else slides over as a sheet and closes with Esc; you never navigate away and get lost. "Read-only from Clio" pill always visible. |
| Clear, helpful information | Three numbers, plain labels: *Worth*, *Insurance*, *Justin nets ≈*. Numbers are computed, never AI. |
| Streamlined, simple workflows | Share in three taps: pick doctor, flip switches, Send. |
| A delightful experience | Sheets spring up; the cited passage pulses yellow on the scanned page; the doctor's "case is active" dot breathes. |
| Feedback: clear, immediate, understandable | Live preview updates as each switch flips; toasts ("Secure link created", "Link copied", "Link revoked"); loading says what it's doing ("Reading scanned pages (first time only) · page 212 of 250…"). |
| Consistency | One Source sheet for every cite everywhere. One cite chip style. One primary button per screen. |
| Help people avoid errors | Insurance is **off** by default and turns amber when switched on. Case value, notes, settlement talk and liens have **no switch** at all. Only doctors on this matter appear. Ask says "Not in the file" rather than guess. |
| Visibility (but has limits) | Doctors line shows who opened; Needs you shows lateness in red. Everything else is one tap away, not on screen. |
| Affordance | The only dark button on the lawyer screen is *Share with a doctor*; the only filled button on the doctor screen is *Reply*. Cite chips look tappable (tinted, superscript). |
| Progressive disclosure | Simple → complex: sentence → numbers → lists → Ask → Full file (162 entries, 662 pages). |
| Symmetry | Three equal number tiles; two equal columns (New / Needs you); centred 960px column. |

### The five simplicity rules every screen must pass
1. **One screen per person.** Anything else is a sheet over it.
2. **No list longer than three** on the main screens (New, Needs you, the doctor's asks). More lives behind Full file.
3. **One primary button.** Lawyer: *Share with a doctor*. Doctor: *Reply*.
4. **Zero legal words for doctors.** "The case is active", not a stage name in a sentence.
5. **The five-second test.** Show the screen for five seconds and ask: is the case alive, and what's wrong with it? Both users get it right.

---

## 4. How ROSS is different

*Others manage the case or write the demand. ROSS explains it, to the lawyer and to the doctor.*

| Product | What it is | Shows what changed since you looked | Doctor sees the case | Firm picks what doctor sees, and who opened it | Every fact opens its source | Stays in Clio, no migration |
|---|---|---|---|---|---|---|
| **ROSS** | A case explainer on top of Clio | ✓ | ✓ | ✓ | ✓ | ✓ |
| Filevine · LOIS | PI case management with AI chronologies and demands | on request | client portal only | — | partial | replaces it |
| Litify · ACE | Salesforce-based PI platform with AI agents | timeline only | — | damages only | — | replaces it |
| EvenUp · Piai | Demand letters and medical chronologies | — | — | — | ✓ | add-on |
| SmartAdvocate · CloudLex · CASEpeer | PI case management, chronology tools | — | client side | — | partial | replaces it |
| Quilia · GAIN | Provider portals and lien servicing | — | ✓ | vendor's system | — | sync |
| Clio Manage · Clio AI | General practice management with general AI | — | — | — | — | it is Clio |

(From the team's competitor research, vendor sites, Oct 2026. Check before quoting on stage.)

**Three differentiators, in one breath each:**
1. **The change, not the state.** Everyone shows where a case is. ROSS shows what changed since *you* last opened it, per person, at zero AI cost.
2. **The doctor is a real user.** Six provider quotes in the brief and no incumbent product built for them. The firm picks what the doctor sees and knows when it was opened.
3. **Trust with nothing to switch.** Read-only on Clio. Every sentence has a cite or isn't shown. A case is read once, so reopening it costs $0.

---

## 5. Information architecture

```
LAWYER  (desktop first, works on phone)            DOCTOR  (phone first, no login)
┌──────────────────────────────────────┐            ┌─────────────────────────┐
│ Case screen  /                        │            │ Patient screen /p/:token │
│  ├─ Source sheet   (any cite / row)   │            │  one scroll, 4 answers  │
│  ├─ Ask sheet      (Ask box)          │  share ──▶ │  + Reply + follow switch │
│  │    └─ Source sheet (per cite)      │  link      └─────────────────────────┘
│  ├─ Full file sheet (Full file ›)     │
│  │    └─ Source sheet (per row)       │
│  └─ Share sheet  (Share with a doctor)│
│       └─ live preview = Patient screen│
└──────────────────────────────────────┘
```

- Sheets stack (Ask → Source is two deep). **Esc** or the backdrop closes the top one and returns focus to what opened it.
- In the Source sheet, **← / →** step through multiple sources (Prev/Next).
- Deep links: `/?open=<itemId>` opens a Source sheet on load; `/?share=1` opens the Share sheet.
- The doctor page and the lawyer's live preview render from **the same function** (`renderProviderView`), so the preview is literally what the doctor gets.

---

## 6. Screen specs

All case facts come from the API. Front-end files hold layout words only, never Sapini data. Example values below are Sapini's.

### 6.1 Top bar (lawyer)
Sticky, 56px, translucent white with `backdrop-filter: saturate(1.6) blur(14px)`, 1px bottom hairline.
- Left: **ROSS** wordmark (see §7.1).
- Right: a green pill **"● Read-only from Clio · Live Clio · synced 8:44 PM"**. Dot is grey and text says *Replica* when reading the bundled replica. "synced …" hides under 760px. Tooltip = data source.
- **Connect Clio** link (accent blue) appears only when in replica mode *and* Clio credentials are configured. Links to `/auth/clio`.
- If the URL has `?clio_error=…`, a red dismissible banner under the bar: *"Clio connection failed: <message>"*. Dismiss removes the param with `history.replaceState`.

### 6.2 Loading
Centred spinner and a live status line polled from `/api/sync/progress` every 700ms: *Connecting to Clio* → *Reading notes, emails, tasks and calendar* → *Reading documents · 7 of 15 documents* → *Reading scanned pages (first time only) · page 212 of 250* → *Building the case summary*. On failure: **"Could not load the matter"**, the error, and a *Connect Clio* button.

### 6.3 Lawyer · Case screen
Centred column, max-width 960px, padding 36px 32px 60px, white page. Top to bottom:

**① The person.** 64px circle avatar (initials "JS" on a soft blue-violet gradient; the client photo from the ID scan when extracted). Name **Justin Sapini** at 30px/800, tracking −0.03em. Sub-line, 13.5px muted, dot-separated: `30 · Injured Apr 23, 2023 · Litigation · Last contact Sep 27, 2026`. Stage is bold accent blue. *Last contact* is a link that opens the last client call (else last activity) in the Source sheet.

**② One sentence (headline).** 21px, line-height 1.45, max 820px. Built from facts with cite chips:
- If value > coverage: *"Worth $375,000, but only **$100,000** of insurance stands behind it [1]."* (cites = coverage sources + value sources)
- If anything is overdue, the first overdue task: *"Still waiting on updated records and right shoulder surgical date, **38 days late** [2]."* ("38 days late" in red.)
- Fallback: the AI brief headline.

**③ Three numbers.** One bordered box (16px radius) split into three equal tiles; each tile is a button that opens its sources.
| Tile label | Big number | Caption |
|---|---|---|
| Worth | $375,000 | Estimated case value |
| Insurance | $100,000 | ✓ confirmed Sep 9 (green) or *not confirmed* (amber) |
| Justin nets ≈ | **$43,080** (green) | of $100,000 cap after fee, costs, lien |
Big numbers 28px/750, tabular figures. Under 760px the tiles stack.

**④ New since you looked** (left column) and **⑤ Needs you** (right column). Two equal columns, 32px gap. Section headers are 12px uppercase muted with a faint count.
- *New since you looked:* up to 3 rows (blue dot, title, short date), ranked by importance then recency. If more than 3: note "*N changes, showing the 3 that matter most*". If none: "*Nothing new since Oct 2, 2026*". First visit ever: "*First visit — showing the 3 most important recent items*" (last 30 days).
- *Needs you:* overdue tasks first (red dot, bold title, red "38 days late"), then tasks due in the next 30 days (grey dot, "Oct 5"). Max 3 shown; header count is the total. Empty: "*Nothing on your plate.*" Task titles are tidied: strip "By medical provider: X - " style prefixes, capitalise.
- Every row opens its entry in the Source sheet.

**⑥ Ask box.** Full-width, 52px tall, 16px radius, 1.5px border that turns accent with a 4px soft ring on focus. Violet sparkle icon, placeholder *"Ask anything about this case"*, a white **Ask** button. Submitting opens the Ask sheet.

**⑦ Two quiet lines.** 13.5px, uppercase 11.5px labels.
- **INJURIES** `Both shoulders · Head · Cervical · Both knees · Lumbar` + link **7 pages ›** (opens the first finding page of each region, in turn). Left/right pairs collapse into "both shoulders".
- **DOCTORS** `McCulloch opened your link Sep 30 · Advanced Rockland not opened`, or *No doctor links yet*.

**⑧ Actions.** **Share with a doctor** (the only dark button: ink background, white, 46px, 13px radius, share icon) and **Full file ›** (white).

**⑨ Footer.** 12px faint: `Clio Manage (live) · 35 reads, 0 writes · 162 entries · 15 documents`. This is the visible proof of read-only.

When the tab is hidden or closed (`pagehide` / `visibilitychange`), the page POSTs `/api/seen` (keepalive) to mark everything as seen for this user.

### 6.4 Sheets (shared behaviour)
Bottom sheet, `min(720px,100%)` wide (1040px for wide sheets), max 88vh, 20px top radius, large soft shadow, slides up with `transform .22s cubic-bezier(.2,.8,.2,1)` over a 32% ink backdrop. Header: a small pill chip (*Source*, *✦ Ask*, *File*, *Share*), a 17px title that ellipsises, and an **Esc** button. `role="dialog" aria-modal="true"`, focus moves into the sheet and returns on close.

### 6.5 Source sheet
The trust feature: *every* cite in the product lands here.

**For a note / email / call / task / calendar entry / expense:**
- Meta row: kind icon (colour per kind), kind label, date, author or sender, amount if any.
- Body, 15px/1.65, pre-wrapped, with the cited sentence **highlighted** (`<mark>`, soft yellow #FFF1B8). Highlight match is whitespace-flexible so wrapped text still matches.
- *Why it matters* (dashed divider) when the AI triage gave a reason not already in the body.
- **Open in Clio ↗** (deep link to the matter section in Clio). For document items, **View pages**.

**For a document page (`doc:<id>#<page>`):**
- Title = pretty document name ("Records bundle part1 haggerty imaging"); meta "Document · 04 Medical Records · page 35 of 250".
- The **rendered page image** (PNG at 110 dpi, generated on demand) inside a scrollable frame, with a **highlight overlay**: one translucent yellow rectangle per text line covering the cited passage (`rgba(255,214,10,.38)`, 2px amber outline, one-shot pulse), auto-scrolled into view. Caption: *"Highlighted: the passage this answer is based on."* If the passage can't be placed: *"Passage is in the page text below."*
- Pager: **‹ p.34** · *Page [35] of 250* (editable) · **p.36 ›**.
- *PAGE TEXT (OCR)* block below with the same passage highlighted in text.
- **Open PDF at p.35 ↗** (serves the PDF inline with `#page=35`) and **Open in Clio ↗**.

**Multiple sources:** Prev / Next with "2 of 5", and keyboard arrows. If a ref isn't in the synced file: "*This entry (id) is not in the synced file.*" If a fact has no source: toast "*No source recorded for this*".

### 6.6 Ask sheet
Title *"About Justin's case only"*, chip *✦ Ask*. A chat thread:
- Question bubble right-aligned, ink background, white text, 16/16/4/16 radius.
- While waiting: spinner + *"Reading the file…"*.
- **Answer card:** 1–3 plain sentences with inline numbered cite chips, then a source list: number badge, bold title, `· p.35`, `· Sep 9, 2026`, and an italic snippet (≤160 chars). Every chip and row opens the Source sheet at that source, with the snippet highlighted (on the page image for documents).
- **Not in the file:** amber-tinted card, **"Not in the file."**, then *Nearest passages* (up to 3) so the lawyer can check. This is a feature: for a lawyer, refusing to guess is the most trustworthy answer.
- Errors: amber card *"Couldn't answer right now."* + reason.
- Follow-up input pinned under the thread (*"Ask a follow-up"*). The sheet stays open across questions.

Reference answers on Sapini: *"Has he had the shoulder surgery?"* → the left yes (Jul 26, 2023), the right recommended with no date, two sources. *"What is the defendant's liability coverage?"* → $100,000 per person / $300,000 per occurrence, cited to the Sep 9 adjuster email. *"What did the right shoulder MRI show?"* → page 35 of the Haggerty imaging bundle, "MRI Right shoulder May 2023, showing intermediate grade interstitial tear…" highlighted. *"Is there a trial date?"* → Not in the file.

### 6.7 Full file sheet
Wide sheet, title *"Full file · 162 entries"*. Filter chips by kind (Note, Email, Call, Task, Calendar, Document, Expense) with a coloured dot; multi-select, filled ink when on. List grouped by month (sticky month headers, newest first). Each row: kind icon, bold title, italic AI "why" (≤140 chars), short date. A row opens the Source sheet with Prev/Next across the filtered list.

### 6.8 Share with a doctor sheet
Wide sheet, two columns (composer | 340px preview column); stacks under 760px.

**Composer:**
- **To** select: only provider companies on this matter (`McCulloch Orthopaedic Surgical Services · 1 open ask`). Defaults to the first provider with an open ask.
- **Three switches**, plain words, iOS-style toggles (44×26, green when on):
  1. **Case status and what we need** · *Stage, last movement, open asks* · default **on**
  2. **Injuries and treatment** · *Treatment status and upcoming visits, no documents* · default **on**
  3. **Insurance** · *Sensitive · off by default* (amber text) · default **off**. When switched on the row turns amber, the toggle turns amber, and a warning appears: *"Shares the $100,000 limit"*.
- 🔒 *"Never shared: internal notes, case value, settlement talk, liens."* (These have no switch.)
- **Personal note** textarea (*Optional note to the office*), feeds the preview live.
- **Send secure link** (dark, full width), then *"Expires in 30 days · you can revoke it"*.
- After sending: a green box with the full URL in a monospace read-only input, **Copy** (falls back to selecting the text with "Press Cmd+C to copy"), and **Revoke**. Below: *Earlier links to this office* (last 3): "Sent Sep 30 · **opened 2×**" (green) or "**not opened**" (amber), each with Revoke.

**Preview column:** label *"Live preview · exactly what McCulloch will see"* above a phone frame (300×560, 40px radius, ink bezel, notch) containing the doctor page. Re-fetched from `/api/shares/preview` 150ms after any change. The *Reply* button is inert in preview.

### 6.9 Doctor · Patient screen (`/p/:token`)
Phone first; max 480px column; on wider screens it floats as a 28px-radius card with a big shadow on the grey page. Background #F6F7F9, white 20px-radius cards, 16px side margins, 12px between cards. `noindex`. Title `Justin Sapini · Patient update`.

Top to bottom:
1. **Header.** *"From Cedar Law, P.C. · secure link"* (small ROSS mark). *About your patient*. **Justin Sapini** (32px/800). *DOB Dec 21, 1995 · injured Apr 23, 2023*.
2. **Note from the firm** (only if written): white card with a violet left border, the note, attorney name as signature.
3. **Is this case alive?** (green card): pulsing green dot + **The case is active** (22px/750 green), *"Last moved Sep 27, 2026 · 5 days ago"*, an 8-segment progress bar (done = pale green, current = green, future = grey; no stage names), and a 2–3 sentence plain-English update written by AI from the shared fields only. Closed cases go grey: *The case is closed*.
4. **WE NEED FROM YOU:** each ask in bold 17px with its detail and a due pill (*"Needed by Oct 10 · in 8 days"*; overdue pills are amber: *"Past due · was needed by Aug 25"*). Empty: *"Nothing right now. Thank you."* Then the one primary button, **Reply to Cedar Law, P.C.** (accent blue, 50px, full width): a `mailto:` to the firm with subject *"Re: Justin Sapini records"* and a body pre-filled with the patient, DOB and one line per ask.
5. **INSURANCE BEHIND THE CASE** (only if shared): *Insurance confirmed*, **$100,000** *liability limit*, *Confirmed in writing Sep 9, 2026*. If not shared, this card does not exist.
6. **IS JUSTIN STILL TREATING?** **Yes · physical therapy and chiropractic adjustment** (green) and *Next visit Oct 6, 2026 · in 4 days*; or *No · treatment complete* / *No visits scheduled*. Visit types only, never other providers' names.
7. **Tell me when the case moves** with an iOS switch (51×31). Off text: *"Only when the stage changes or the firm needs something"*; on: *"On · we'll let you know"*. Saves optimistically to `/api/p/:token/follow`, reverts with *"Couldn't save that. Please try again."*
8. Footer: *"Shared by <attorney> · read-only · this link expires Nov 1, 2026"*.

Invalid, revoked or expired link: a centred empty state, ○, **This link isn't available**, *"This link is no longer active. Contact the firm for a new one."* Network failure: *"We could not reach the server. Check your connection and try again."*

What the doctor never has to do: create an account, remember a password, learn legal terms, read a chaser email, scroll past a second screen.

---

## 7. Visual design system

### 7.1 Brand: ROSS
- Wordmark: **ROSS** in **black letters**, all caps. Set in the system SF Pro stack, weight 800, letter-spacing about +0.08em, 17–18px in the top bar (black `#000` / `--ink`). No gradient, no coloured logo mark next to it; the word is the logo. On the doctor page the header shows the firm, with ROSS as a small black wordmark or mark only.
- Favicon: a black rounded square (8px radius on 32) with a white **R**.
- Page titles: `ROSS · Justin Sapini` (lawyer), `Justin Sapini · Patient update` (doctor).
- Basic Auth realm and any user-visible product name: **ROSS**.

### 7.2 Colour tokens
```css
:root {
  --bg: #F4F5F7; --surface: #FFFFFF; --surface-2: #F9FAFB; --line: #E6E8EC; --line-2: #EEF0F3;
  --ink: #0E1726; --ink-2: #364152; --muted: #6B7485; --faint: #98A1B1;
  --accent: #2B59F5; --accent-ink: #1C3FC4; --accent-soft: #EEF2FF;
  --red: #D92D20; --red-soft: #FEF1F0; --amber: #C2620A; --amber-soft: #FFF5E8;
  --green: #0A8A4F; --green-soft: #ECFAF2;
  --violet: #6E4AE0; --violet-soft: #F3EFFF; --teal: #0E8A9A; --teal-soft: #E9F8FA;
  /* entry kinds */
  --k-note: #6E4AE0; --k-email: #2B59F5; --k-call: #0E8A9A; --k-task: #C2620A;
  --k-event: #0A8A4F; --k-document: #364152; --k-expense: #98A1B1;
  --r: 14px; --r-sm: 9px;
  --shadow: 0 1px 2px rgba(14,23,38,.04), 0 1px 1px rgba(14,23,38,.03);
  --shadow-lg: 0 18px 50px -12px rgba(14,23,38,.25), 0 2px 6px rgba(14,23,38,.06);
}
```
**Meaning is fixed:** red = late / overdue only; amber = sensitive or not confirmed; green = good news (confirmed, active, net, opened, on); accent blue = tappable (links, cites, the doctor's Reply); ink = the single primary action. Highlight yellow `#FFF1B8` (text) and `rgba(255,214,10,.38)` with `rgba(240,160,0,.9)` outline (page image).

### 7.3 Type
- Lawyer app: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif`, 15px/1.5 base on white. Doctor page: Inter (Google Fonts 400–800) with the same fallbacks.
- Scale: name 30/800 (−0.03em) · headline 21/400 · big number 28/750 tabular · sheet title 17 · body 15 · list row 14.5 · meta 12.5–13.5 · section label 11.5–12 uppercase, +0.06em, 650, muted · cite chip 10.5/700.
- Doctor: patient name 32/800 · alive heading 22/750 · ask 17/700 · amount 28/800 · body 15.
- Always `font-variant-numeric: tabular-nums` on money and dates.

### 7.4 Components
- **Cite chip:** inline superscript, min 17×17, 5px radius, accent-soft background, accent 10.5px bold numeral; hover fills accent with white text.
- **Buttons:** 38px, 11px radius, 1px line border, 14px/600; `.sm` 30px; primary 46px ink; blue (accent) for the doctor.
- **Lists:** rows separated by `--line-2` hairlines, 10px vertical padding, 8px status dot, title flexes, right-aligned muted date. Hover turns the title accent.
- **Switches:** iOS style, white knob with a soft shadow, `.18s` slide; green on; amber on the Insurance row.
- **Kind icons:** Feather-style 24px stroke icons (note, email, call, task, calendar, document, expense, alert, clock, pin, user, share, sync, external, x, check, eye, lock, spark, copy, heart, shield, arrow), tinted by kind colour.
- **Toast:** bottom-centre, auto-hides after 2.2s.
- **Phone frame** for the preview (see §6.8).

### 7.5 Motion
Sheets 220ms spring-out ease. Backdrop fade 200ms. Highlight pulse 1.2s once. Doctor's active dot pulses every 2s. Button press: 1px down / scale .985. Nothing else moves.

### 7.6 Responsive
Breakpoint 760px: top bar 52px and hides the wordmark text and sync time; page padding 16px; name 25px; headline 18px; number tiles stack and lay out label above number; columns stack; actions go full width; Share sheet stacks; sheets go to 92vh. Doctor page is designed at 375–430px first.

### 7.7 Accessibility
Every tappable thing is a real `<button>` or `<a>`. Sheets are labelled dialogs with focus management and Esc. Cite chips have `aria-label="Source N"`. Switches use real checkboxes (`role="switch"` on the doctor page) with visible focus rings. Colour is never the only signal: late items also say "38 days late".

---

## 8. Voice and copy rules

- Lead with the answer. One sentence a lawyer can repeat in a meeting.
- Numbers first, plain words: *Worth*, *Insurance*, *nets*. No "KPI", no "AI summary" labels on the main screen.
- Doctor copy uses zero legal terms and the patient's first name: *"Is Justin still treating?"*
- Never guess. *"Not in the file."* is a complete answer.
- Never claim what wasn't computed. Assumptions are labelled (the 33.3% fee).
- Dates: `Sep 9` within the current year, `Sep 9, 2025` otherwise. Relative: *today*, *yesterday*, *5 days ago*, *3 months ago*, *2.4 years ago*; future *in 4 days*.
- Money: `$375,000` (no cents); short form `$375k` where space is tight.

---

## 9. User journeys

### Lawyer: an associate inherits Sapini on Monday (2 minutes)
| Time | They ask | They do | They see |
|---|---|---|---|
| 0:00 | "What is this?" | Open the matter | Face, one sentence, three numbers. Now knows the case is capped at $100k. |
| 0:15 | "What happened?" | Read *New since you looked* | McCulloch replied but there's still no date; Justin asked about PT. No AI cost. |
| 0:30 | "Can I trust that?" | Tap $100,000 | The adjuster's Sep 9 email with the limits line highlighted. Esc. |
| 0:50 | "Has he had the surgery?" | Ask | "The left, yes. The right, not yet," with two sources. |
| 1:20 | "Get the date." | Share with McCulloch | Two switches on, insurance off, preview, Send. |

### Doctor: McCulloch's records coordinator, on a phone (30 seconds)
| Time | They ask | They see / do |
|---|---|---|
| 0:00 | "One of ours?" | A text or email from Cedar Law. Patient name and DOB first. No login. |
| 0:05 | "Is it alive?" | **The case is active.** Relief: worth continuing to treat on the lien. |
| 0:15 | "What do they want?" | One thing: the right shoulder surgery date. |
| 0:30 | "Done." | Tap **Reply**, turn on *Tell me when the case moves*. |

**The loop closes:** the lawyer's Case screen now shows *McCulloch opened your link today*. The reply comes back by email (and into Clio through the firm's normal email capture), and appears under *New since you looked* next time. Nobody writes a sixth chaser.

**Edge cases:** first visit (no baseline) shows the 3 most important items of the last 30 days; revoked or expired link shows the empty state; AI off runs the whole product on the offline engine and still cites everything.

---

## 10. Architecture

```
Clio Manage v4 (GET only) ──▶ ingest/sync.js ──▶ CaseFile (every item: stable id + etag + Clio deep link)
   or the local replica             │
                                    ├─ documents ─▶ ingest/extract.js: pdftotext per page; empty page = scan
                                    │                ─▶ pdftoppm 150dpi gray + tesseract. Cached by sha256.
                                    ▼
                                digest/
                                  facts.js      exact numbers, dates, buckets from Clio fields (no model)
                                  heuristic.js  offline scoring, top items, injury extraction (also Claude pre-filter)
                                  llm.js        Claude: triage, injuries, brief, provider update, Ask answer
                                  index.js      orchestrates; "changes since" per user
                                    ▼
                                server.js (node:http) ─▶ public/  lawyer app  ·  /p/:token doctor page
                                    │                 ─▶ ask/rag.js  BM25 over entries + OCR'd pages
                                    │                 ─▶ ingest/pagebox.js  word boxes → highlight rectangles
                                    │                 ─▶ share/provider.js  allow-list provider view, links, view log
                                SQLite (node:sqlite): Clio token, snapshots, last-seen, AI cache, shares, view log
```

**Stack.** Node.js 22.5+ (built-in `node:http`, `node:sqlite`, `fetch`; no web framework), ES modules, one dependency `@anthropic-ai/sdk`. Front end is vanilla ES modules with hand-written CSS and inline SVG; no build step. System tools: poppler (`pdfinfo`, `pdftotext`, `pdftoppm`, `pdfimages`) and `tesseract`. One process. Data outside Clio: one SQLite file plus on-disk caches.

**Files.**
```
src/root.js            chdir to the app folder so all data paths are relative to it (import first)
src/server.js          routes, auth gate, static files, warm-up
src/db.js              SQLite schema + kv helper
src/clio/client.js     read-only Clio client (GET only) + FIELDS
src/clio/oauth.js      OAuth code flow, refresh, mode selection
src/clio/replica.js    local Clio v4 replica built from the fixtures JSON
src/ingest/sync.js     pull one matter → CaseFile; documentPages()
src/ingest/extract.js  per-page text / OCR, image extraction
src/ingest/pagebox.js  ensurePdf(), word boxes, locate(passage)
src/digest/facts.js    computeFacts()
src/digest/heuristic.js scoring, keySentence, topItems, injuries
src/digest/llm.js      Claude jobs, cache, spend
src/digest/index.js    buildDigest(), changesSince(), markSeen()
src/ask/rag.js         index, BM25, ask()
src/share/provider.js  policy, providerView(), share links, views, follow
public/index.html  app.js  styles.css  common.js          lawyer app
public/provider.html  provider-view.js  provider.css      doctor page (provider-view.js also renders the preview)
fixtures/sapini-clio-data.json   fixtures/Sapini documents/*.pdf
data/   ross.db (SQLite), text-cache/<sha>.json, pages/<doc>.pdf|<doc>-<p>.png|<doc>-<p>.words.json, photos/
```

**Server lifecycle.** On listen, warm up in the background (`ensureCase()` 50ms later) so the first page load finds the case already read. `state = { caseFile, digest, syncing, progress }` lives in memory; `ensureCase()` loads the latest snapshot for the current mode, syncs if none, then builds the digest. `doSync()` is single-flight (concurrent callers share the promise) and publishes progress for the loading screen.

---

## 11. Clio integration

### 11.1 Read-only by construction
`ClioReadOnlyClient` has exactly three public methods, `get(path, params)`, `all(path, params)` and `download(documentId)`, and its private fetch hard-codes `method: 'GET'`. There is no post, patch or delete to call. The UI footer counts reads and shows "0 writes". The only POST anywhere is to Clio's **OAuth token endpoint**, which exchanges a code for a token and writes no case data.

- `all()` follows `meta.paging.next` with `limit=200` until exhausted.
- Retries 429/502/503/504 up to 4 times, honouring `Retry-After`, else exponential backoff.
- On a 401 in live mode, force one token refresh and retry (another login can retire the token).
- Errors carry the HTTP status: `Clio GET <url> -> <status> <body>`.

**Field selections** (Clio returns only `id` and `etag` unless fields are named):
```
matter:         id,etag,display_number,description,status,open_date,close_date,statute_of_limitations,created_at,updated_at,client{id,name},practice_area{id,name},matter_stage{id,name},responsible_attorney{id,name},custom_field_values{id,field_name,field_type,value,custom_field}
contact:        id,etag,name,type,first_name,last_name,title,date_of_birth,company{name},email_addresses{address,default_email},phone_numbers{number,default_number},addresses{street,city,province,postal_code}
relationship:   id,etag,description,contact{id,name}
note:           id,etag,subject,detail,date,type,created_at,updated_at,author{id,name}
communication:  id,etag,subject,body,date,type,created_at,updated_at,senders{id,name,type},receivers{id,name,type}
task:           id,etag,name,description,due_at,status,priority,statute_of_limitations,completed_at,created_at,updated_at,assignee{id,name,type}
calendar_entry: id,etag,summary,description,start_at,end_at,all_day,location,created_at,updated_at
activity:       id,etag,type,date,quantity,price,total,note,created_at,updated_at
document:       id,etag,name,content_type,size,received_at,created_at,updated_at,parent{id,name,type},latest_document_version{uuid,size}
```

### 11.2 What one sync reads
1. Find the matter: `CLIO_MATTER_ID`, else `GET matters.json?query=<CLIO_MATTER_QUERY|Sapini>&fields=id,description,status`, first hit. None → *"No matter found in Clio matching "Sapini". Run the Swans setup app first."*
2. In parallel: `matters/{id}.json`, `relationships.json`, `notes.json?type=Matter`, `communications.json`, `tasks.json`, `calendar_entries.json`, `activities.json?type=ExpenseEntry`, `documents.json` (all with `matter_id`), and `users/who_am_i.json`.
3. `contacts/{id}.json` for the client and every related contact. Role = the relationship description; the client's role is "Client".
4. `documents/{id}/download` for each document, four at a time.
On Sapini this is about 35 GET requests.

### 11.3 OAuth
- `GET /auth/clio` → random `state` saved in kv → 302 to `${CLIO_BASE}/oauth/authorize?response_type=code&client_id=…&redirect_uri=…&state=…`.
- Callback on the redirect URI's path (default `/callback`; `/auth/clio/callback` also accepted). Clio `error` → redirect `/?clio_error=<description>`. State mismatch → 400 *"OAuth state mismatch. Start again from Connect Clio."* Else POST form-encoded to `${CLIO_BASE}/oauth/token` (`grant_type=authorization_code`, code, redirect_uri, client_id, client_secret); save `{access_token, refresh_token, expires_at}` in kv `clio_token`; reset state; start a fresh sync in the background; 302 to `/?connected=1`.
- `getToken()`: `CLIO_ACCESS_TOKEN` env wins; else the saved token (or a `CLIO_REFRESH_TOKEN` seed) refreshed when within 60s of expiry or when forced. Refresh keeps the old refresh token if Clio doesn't return a new one.
- **Redirect URI:** `CLIO_REDIRECT_URI`, else `https://$RAILWAY_PUBLIC_DOMAIN/callback`, else `http://127.0.0.1:<PORT>/callback`. The server **listens on the redirect URI's port** so it always matches what's registered in the Clio developer portal. Region hosts via `CLIO_BASE` (app / eu.app / ca.app / au.app .clio.com).
- `POST /api/clio/disconnect` clears the saved token.

### 11.4 Modes
`CLIO_MODE=live` always reads Clio; `replica` always reads the bundled replica; `auto` (default) reads Clio once a token exists, otherwise the replica. Snapshots record their mode, and a snapshot from the other mode is never shown.

### 11.5 The local replica
`src/clio/replica.js` replays Swans' request bodies into an in-memory Clio and answers the same GET endpoints under `/replica/api/v4/...` with the same envelope (`{ data, meta: { paging: { next } } }`), pagination, field selection and ids/etags. It serves `documents/{id}/download` from `fixtures/Sapini documents/` and refuses writes, exactly like the real client. Its user is a stand-in (`who_am_i`). The sync code cannot tell replica from live, which is what proves nothing is hardcoded. Deep links to Clio web: `${CLIO_WEB_BASE | CLIO_BASE + "/nc/#"}/matters/<id>/<notes|communications|tasks|calendar|activities|documents>`.

---

## 12. The CaseFile model

One normalised snapshot of a matter; the only thing the digest reads. Stored as JSON in `snapshots`.

```js
{
  syncedAt, mode: 'live'|'replica', source: 'Clio Manage (live)'|'Clio v4 replica (fixtures)', clioRequests, me: {id,name,email},
  matter: { id, displayNumber, description, status, openDate, sol, stage, practiceArea, attorney, clioUrl, updatedAt },
  customFields: { '<field name>': value, ... },        // e.g. 'Estimated Case Value': 375000
  contacts: [{ id, name, type, role, title, company, dob, email, phone, address }],
  clientId, photo: { docId, url } | null,
  documents: [{ id:'doc:<id>', clioId, name, folder, receivedAt, size, sha256, pageCount, ocrPages, clioUrl }],
  items: [  // sorted by date ascending
    { id:'note:<id>',    kind:'note',     date, title:subject, body:detail, author, etag, clioUrl },
    { id:'comm:<id>',    kind:'email'|'call' (type matches /Phone/), date, title, body, from:[names], to:[names], parties:[contactIds], etag, clioUrl },
    { id:'task:<id>',    kind:'task',     date:due_at[0..10], title:name, body:description, status, sol, etag, clioUrl },
    { id:'event:<id>',   kind:'event',    date:start_at[0..10], at, end, title:summary, body, etag, clioUrl },
    { id:'expense:<id>', kind:'expense',  date, title:first line of note, body:note, amount:total ?? price*quantity, etag, clioUrl },
    { id:'doc:<id>',     kind:'document', date:received_at||created_at, title:prettyDocName, body:'<folder> · N pages', etag, clioUrl }
  ]
}
```
Item ids are the cite format everywhere. Document pages are cited as `doc:<id>#<page>`. `prettyDocName("05-medical-bills__doc-20__records-and-bills-part2-pt-ortho-er-operative.pdf")` → "Records and bills part2 pt ortho er operative". Senders/receivers that are firm users with no name show as "Firm".

Sapini: 162 items (42 notes, 69 communications split into emails and calls, 14 tasks, 17 calendar entries, 5 expenses, 15 documents), 15 documents, 662 pages, 522 OCR'd.

---

## 13. Ingest: documents, OCR, photo

**Per-page text (`extractPdf`).** Hash the PDF (sha256). If `data/text-cache/<sha>.json` exists, return it. Else `pdfinfo` for the page count, then for each page in a pool sized to the CPU count: `pdftotext -layout -f p -l p`; if fewer than 40 non-space characters, it's a scan: `pdftoppm -r 150 -gray -png` that page and `tesseract <png> - --psm 3` (`OMP_THREAD_LIMIT=1`). Result `{ sha256, pageCount, pages:[{page, text, method:'native'|'ocr'}] }` cached forever. A document is read once, ever, no matter how often the case is opened. Progress is reported per page for the loading screen.

**Client photo.** For the first document whose name matches `/photo[-_ ]?id|driver|licen[cs]e/i`, run `pdfimages -png` and keep the largest image as `data/photos/<docId>.png`. Optional: any failure falls back to initials.

**Page images** for the Source sheet: `pdftoppm -r 110 -png -singlefile` on demand, cached at `data/pages/<docId>-<page>.png`. The PDF itself is cached at `data/pages/<docId>.pdf` (downloaded through the read-only client).

---

## 14. Digest: facts computed, not generated

**Rule: every number on screen comes from Clio fields and entries in `facts.js`. Claude writes words only.** Every fact carries `src` (item ids or the custom field) so the UI can open it. `asOf` = `AS_OF` env or today.

### Money
- `money(text)` = first `$1,234.56` in a string (or the number itself).
- **Coverage** = money of the *Defendant* line of the `Policy Limits` field (Sapini: "Defendant liability: $100,000 / $300,000" → 100000). *Confirmed* = `Policy Limits Confirmed` field; *confirmed on* = date of the latest note/email matching `/coverage (confirmed|position)|limits are \$/i`, which is also the source.
- **Value** = `Estimated Case Value`; sources = notes matching `/valuation|case evaluation/` (and the value itself).
- **Specials** = `Medical Specials To Date`. **Wage** = `Wage Loss Claimed`.
- **Lien** = money of `Health Insurance or Lien Holder`; sources = last 3 lien notes/emails/tasks.
- **Firm spend** = sum of the firm's own case costs among the expense entries (filing fees, records fees, service, experts). **Medical bills that a firm logs in Clio as expense entries are not firm costs**: they are the client's specials, already covered by the specials figure and the lien. Counting them as costs is a real bug that hit live Clio (it showed the client netting **−$76,730**); exclude expense entries that are provider bills (the note names a treating provider or reads as a medical bill or invoice) and show what was excluded in the source.
- **Waterfall:** `recoverable = min(value, coverage)`; `fee = round(recoverable × feePct)` with `feePct = CONTINGENCY_FEE || 0.3333` (an assumption, labelled as one); `net = recoverable − fee − firmSpend − lien`; `gap = value − coverage`.
  Sapini on the replica: min(375,000, 100,000) = 100,000; fee 33,330; firm spend 1,410; Medicaid lien 22,180; **net ≈ $43,080**. On Bijin's live Clio, after the fix above, the screen reads **≈ $41,965** (the live account holds different expense entries; by the formula that is $2,525 of firm costs, inferred, not read from the code).

### Dates and work
- Open tasks = status ≠ complete. **Overdue** = open with due date before today, plus `daysLate`. **Upcoming** = open, due within 30 days. **Waiting on others** = open tasks matching `/^By (medical provider|client|defen[cs]e|court|adjuster)[^:]*:|unanswered|no date given|awaiting|requests?,? no/i`, with *on whom* parsed from the title.
- Statute of limitations from the matter, satisfied if its SOL task is complete.
- Upcoming events = calendar entries from today, first 8.

### Client contact
Client touches = emails and calls whose parties include the client, on or before today. *Last talk* = latest call; *last any*; *last from client*; touches in 90 days. The Case screen's *Last contact* uses last talk, else last activity.

### Providers (for sharing)
Providers = contacts of type Company whose role matches `/provider|hospital|surgeon|chiropract|physical therapy|orthopa/i`. For each: name keys (distinctive words of the short name, person surnames, employed doctors' surnames, a doctor named in the role like "(Kevin M. Haggerty, D.C.)"); comms with them; records requested vs received (`/enclosed|attached/`); last reply; **chasers since last reply**; **open asks** (open tasks naming them); treatment visits (calendar entries naming them that look like treatment, not calls); documents naming them.

### Case health
Last activity = latest non-calendar item on or before today (*"moved 5 days ago"*). Treatment status from `Treatment Status` (ongoing if /active|ongoing/) and next treatment visits from the calendar. Flags: liability, prior injuries, coverage gap.

### Heuristic scoring (offline engine and Claude pre-filter)
Score = kind weight (note 1.5, document 1.2, task 1, call .8, event .7, email .6, expense .2) + signal weights (surgery 3; lien/Medicaid 2.5; coverage/limits/policy 2.5; exhausted 2; IME/expert/radiology 2; served/summons/complaint/answer 1.5; demand/offer/negotiation/settle 2.5; deposition/motion/compel 1.5; discrepancy/contradict/prior injury 3; scope of employment/liability/mechanism 2.5; recommend 1.5; no date/still no/unanswered/third request 2; valuation/$xxx,xxx 2.5; wage/1099/commission 1.5; limitations 2) − 2 for routine chasers (*Records request*, *Checking in*…) + recency (+1.5 under 45 days, +.5 under 120) + 3 for an overdue open task. Importance = clamp(round(score / 2.2), 1, 5). *Why* = the body sentence carrying the most signals (`keySentence`).

`topItems`: highest scores, never more than 3 from the same month, returned in date order.

Offline brief: headline *"<Stage>, N years post-incident. Valued at $X but recovery is capped at $Y of coverage; N overdue, N waiting on others."*; story = the strongest note in each of six equal time windows; risks from flags and the lien; next moves from overdue and upcoming tasks.

### Injuries
From documents in folders matching `/medical|bills|expert|records/`. Line-level scan: a line (plus the next) must contain a finding word (tear, herniation, bulge, fracture, radiculopathy, sprain, labral, impingement, effusion, stenosis, concussion, TBI, derangement, chondromalacia, bursitis…) and a body region (head, cervical, thoracic, lumbar, left/right shoulder, left/right knee), and must not be legal noise (settlement, counsel, deposition, CPLR…) or a negative (no acute, unremarkable, rule out…). Weight +2 inside an Impression/Diagnosis/Assessment/Findings section, +2 for strong evidence (MRI, EMG, tear, status post, labral repair), −2 for billing-code lines. Group by region, keep up to 6 distinct findings with page refs, rank by weight. With AI on, Claude rewrites this from the flagged pages only (§15).

### What changed since you looked
- Table `visits(user_key, matter_id, seen_at, seen_ids)`. `user_key` = a random `cl_user` cookie set on first GET (1-year, SameSite=Lax); no accounts needed.
- **Changed** = items whose `id:etag` pair isn't in `seen_ids`. Clio's etag changes when an entry is edited, so edits count as new, not just additions. Zero AI cost.
- `?since=YYYY-MM-DD` overrides with a date window (useful for demos).
- No row yet → `first-visit`. `markSeen` stores every current `id:etag` when the page hides.

---

## 15. AI features, prompts and cost

Five AI features, each with one rule it never breaks:

| Feature | What you see | How it works | Never |
|---|---|---|---|
| 1 · Case summary | The headline sentence (and the brief behind it) | Opus 5.5 writes from the digested file; every cite id must exist or it's dropped | Makes up a number |
| 2 · What's new, ranked | *New since you looked*, max 3 | Per-person etag diff (no AI), ranked by Haiku's importance scores | Re-reads the whole case |
| 3 · Ask the case (RAG) | The Ask sheet | BM25 over notes, emails, OCR'd pages; answer only from the top passages with numbered cites | Answers without a source |
| 4 · Records reader | The injuries line, Ask's page cites | OCR once; Haiku pulls diagnoses by body part with page numbers | Shows a finding without a page |
| 5 · Doctor update writer | The plain-English lines on the doctor page | Haiku writes only from the switches the lawyer turned on | Sees what wasn't shared |

**Models** (env-overridable): bulk `BULK_MODEL` = `claude-haiku-4-5`; brief `BRIEF_MODEL` = `claude-opus-5-5`. AI is on when `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`) is set. All calls use structured JSON output (`output_config.format = json_schema`). Opus/Sonnet 5 calls stream with the server-side fallback beta (`betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default'`). A `refusal` stop reason throws and the offline path takes over.

**Cache.** Every call is keyed by `sha256(PROMPT_VERSION + JSON(input))` in `llm_cache` with model and token counts. Bump `PROMPT_VERSION` (currently `v3`) to invalidate. The footer can show running spend computed from that table at $/MTok: Haiku 4.5 1/5, Opus 5.5 4/20, Sonnet 5.5 2/10.

### 1. Item triage (Haiku), batches of 40, cached per item content
```
You triage entries in a US personal-injury case file for the attorney who has to get up to speed.
For each entry return: importance 1-5 (5 = changes case value, coverage, liability, deadlines or treatment; 1 = routine admin),
why: one plain sentence, under 25 words, saying what this entry means for the case (not a restatement of its subject),
provider_relevant: true only if a treating medical provider would legitimately need it (their bills/records, treatment, case status) and it reveals no strategy.
```
Schema: `{ items: [{ id, importance:int, why, provider_relevant:bool }] }`. Item text format: `[note:123] 2026-09-24 EMAIL from A to B (status): <title>\n<body>`.

### 2. Injuries from scanned records (Haiku), chunks of 12 flagged pages, cached per document sha + pages
```
You read OCR'd pages from medical records in a personal-injury file. Extract the client's diagnosed injuries.
Only report a finding stated on the page (imaging impression, diagnosis, assessment, operative finding). Quote the exact OCR words (under 20 words).
Skip billing codes without a diagnosis, normal/negative findings, and anything about a different patient. Page numbers are given as [p.N].
```
Schema: `{ findings: [{ region: head|cervical|thoracic|lumbar|left shoulder|right shoulder|left knee|right knee|other, diagnosis, page:int, quote, source_type: imaging|treating|operative|emergency|defense|other }] }`. Pages are sent as `[p.N]\n<first 6000 chars>`.

### 3. The brief (Opus 5.5, effort medium), cached on the hash of the whole input
```
You brief a personal-injury trial attorney who is opening this matter cold and has 90 seconds.
Write like a sharp senior associate: concrete, numbers first, no hedging, no legal boilerplate.
headline: one sentence, under 30 words, the single most important thing about where this case stands.
story: 4-6 beats in chronological order, each one sentence, together telling how the case got here.
top10: the ten entries out of the whole file that matter most, each with a why under 20 words.
risks: 3-5 things that could cost the client money, each with one-sentence detail.
next_moves: 3-5 concrete actions, most urgent first.
Every claim must cite the entry ids it rests on, exactly as given in square brackets, e.g. "note:6601012". Never invent ids.
```
Input: `CASE FACTS (computed from Clio fields)` (as-of, client, DOI, stage, summary, value, coverage + detail, specials, wage, lien, firm spend, overdue tasks, last client call) then every non-expense entry with its triage score. Output schema: headline, story[{text,cites}], top10[{id,why}], risks[{title,detail,cites}], next_moves[{text,cites}]. **After the call, every cite not in the real id set is removed**; top10 entries with unknown ids are dropped.

### 4. Doctor update (Haiku), cached on the shared view
```
You write a short, warm, plain-English status update from a personal-injury law firm to a medical provider treating their client on a lien.
Use ONLY the facts given. Never speculate about value, strategy, or liability. summary: 2-3 sentences. asks: what the firm needs from this office, imperative, one line each.
```
Input is the already-filtered provider view (§17), so the model cannot leak what wasn't shared. Offline template: *"Justin's case is open and in litigation; it last moved on Sep 27, 2026. Treatment is recorded as ongoing. A $100,000 liability policy has been confirmed in writing on Sep 9, 2026."* (last sentence only when insurance is shared).

### 5. Ask answer (Haiku), cached on question + passage keys
```
You answer an attorney's question about one personal-injury case file, using ONLY the numbered passages given.
Write 1-3 plain sentences. Put the passage number in square brackets after each claim, like [2]. List every number you used in cites.
If the passages do not answer the question, set not_in_file true and answer "Not in the file." Never guess or use outside knowledge.
```
Schema `{ answer, cites:int[], not_in_file:bool }`.

### Cost per case (Sapini)
| Job | Model | Tokens | Cost |
|---|---|---|---|
| Triage 162 entries | Haiku 4.5 | 12k in / 7k out | ~$0.05 |
| Read ~155 flagged pages for diagnoses | Haiku 4.5 | 100k in / 15k out | ~$0.18 |
| Write the brief | Opus 5.5 | 16k in / 6k out | ~$0.18 |
| Doctor update per share | Haiku 4.5 | 1k in / 0.2k out | <$0.01 |
| OCR 522 scanned pages | tesseract, local | — | $0 |

**About $0.40 for the first full digest; $0 to reopen; about $0.15 for a sync with a few new entries.** Without a key everything still runs on the offline engine.

---

## 16. Ask: retrieval, answers, cited highlights

This is the main feature Bijin asked to work above all: *answer questions, give references to the right places, take you to the reference and open the document to show it.*

### Index (rebuilt only when `syncedAt` changes)
- Every non-document item → `title\nbody`, split into 900-char chunks (150 overlap). Label `email · Sep 9, 2026 · <title>`.
- Every document page → 1200-char chunks, key `doc:<id>#<page>`, title `<pretty name>, p.N`.
- Tokenise: lowercase, keep `$` and numbers, drop a stop-word list, light stemming (strip -ing/-ed/-es/-s on words over 4 chars).

### Search
BM25-style (k1 ≈ 1.2, b = .75 with a .25 floor) over unique query terms that exist in the index or have a synonym that does. **Lawyer synonyms** count at 0.6 weight: coverage→limit/policy/insurance/insurer; insurance→coverage/policy/limit; surgery→arthroscopy/operation/operative/repair; injury→tear/diagnosis/fracture; doctor→dr/physician; owe→lien; settle/settlement→offer/negotiation; adjuster→claim/carrier; job→employ/wage; income/salary→wage/earning; court→summon/complaint/index. Scanned-page chunks are scaled by 0.85 (firm records explain, scans corroborate). One result per key, top 8.

### Answer
- **Relevance floor:** the best passage must contain ≥60% of the terms (3+ terms) or all of them (fewer), else weak.
- **With AI:** send the top 6 passages to the Ask prompt. If `not_in_file` or no valid cites → *Not in the file* with up to 3 nearest passages. Else renumber cites 1..k in order of use so the text and the list agree.
- **Without AI (extractive):** if weak → Not in the file. Otherwise quote up to 2 best sentences from the top 4 passages (bodies, not titles). A sentence must cover the question: all terms for 1, n−1 for 2–3, two-thirds for more. *When/date* questions require a sentence with a date (or append the entry's date); *how much/limit/worth/value/cost* questions require an amount. Each sentence gets `[n]`.
- Each cite returned to the UI: `{ n, id, docId, page, title, date, kind, snippet }`, where **snippet** is the sentence on that passage that best matches the question (scanned-page line breaks joined first). The snippet is what gets highlighted.

### Highlight on the page image (`locate`)
1. Word boxes for the page, as page fractions: from `pdftotext -bbox` when the page has a text layer; if fewer than 8 words, it's a scan, so render at 200 dpi and read tesseract's TSV (level-5 rows). Cached as `data/pages/<doc>-<page>.words.json`.
2. Normalise words (lowercase, `[a-z0-9$]` only). Slide a window of `len(passage)+4` words across the page, maintaining a multiset overlap with the passage; keep the best window.
3. Accept if overlap ≥ max(2, 60% of passage words). Trim the window to matching words at both ends.
4. Merge the words into one rectangle per text line (vertical centres within 0.6 line heights), pad 0.002, return `{ found, score, rects:[{x,y,w,h}] }`.
5. The UI overlays absolutely positioned `<i>` elements at those percentages over the image and scrolls the first into view.

---

## 17. Sharing with a doctor

### Policy and what each switch reveals
```js
DEFAULT_POLICY = { status: true, treatment: true, coverage: false, hiddenItems: [], note: '' }
expand(p) = { ...p, milestones: p.status, asks: p.status, records: p.treatment, lien: false }
```
| Switch | Adds to the doctor view |
|---|---|
| Case status and what we need (`status`) | stage, the stage list (for the bar), open?, last movement + days, treatment-ongoing flag; public milestones (summons, complaint, answer, bill of particulars, served, demand package, IME, compliance conference, deposition, surgery, discovery, coverage confirmed, exhausted), max 12, deduped; this provider's **open asks** (title, detail, due, overdue) |
| Injuries and treatment (`treatment`) | injured regions (top 6); treatment ongoing; upcoming visits as *kind of care only* (title text after "Type:", parentheses stripped; calls excluded; **other providers' names removed**); past visit count; records requested/received/last received, unanswered requests, this provider's documents on file |
| Insurance (`coverage`, default off) | liability limit, confirmed, confirmed on |
| *(no switch)* | **Never:** case value, internal notes, strategy, liability analysis, settlement talk, liens, other providers' records |

The view is **assembled server-side from the allow-list**; anything not allowed is never serialised, so it can't leak through the browser. The AI update is written from that same filtered object. Every view also carries patient name/DOB/DOI, provider name, firm `{ attorney, name: FIRM_NAME || "<attorney>'s office", email: FIRM_EMAIL || the Clio user's email }`, as-of date and the personal note.

### Links
- `createShare` → token = 18 random bytes, base64url. Row stores matter, provider id + name, policy JSON, note, created_at.
- Valid for **30 days** from creation; `revoked_at` set by Revoke. Expired or revoked → 404 with *"This link is no longer active. Contact the firm for a new one."*
- **Every open is logged** (`share_views`: time, IP, user agent) unless the request carries `x-preview` (the lawyer's own preview). The lawyer sees "opened your link <date>" and "opened N×".
- **Follow:** `POST /api/p/:token/follow {follow}` stores the doctor's opt-in. (Alerts are designed to go out only when the stage changes or the firm needs something, each one approved by a person; sending them is not built yet.)
- **Reply** is a mailto to the firm; it lands in Clio through the firm's normal email capture. ROSS itself never writes to Clio.

---

## 18. HTTP API

| Method | Path | Does |
|---|---|---|
| GET | `/healthz` | `ok` (no auth) |
| GET | `/api/case[?since=YYYY-MM-DD]` | Digest + `changes {basis, items}` for this user |
| POST | `/api/sync` | Re-read Clio now (single-flight) |
| GET | `/api/sync/progress` | `{ syncing, progress: {step, docs:[a,b], ocr:[a,b,name]} }` |
| POST | `/api/seen` | Mark everything seen for this user |
| GET | `/api/doc/:docId/pages` | Document meta + every page's text |
| GET | `/media/page/:clioId/:page.png` | Rendered page image (cached) |
| GET | `/media/doc/:clioId.pdf` | The PDF inline (only documents of this matter) |
| GET | `/api/doc/:clioId/page/:page/locate?q=` | Highlight rectangles for a passage |
| GET | `/media/photos/:file.png` | Client photo |
| POST | `/api/ask` `{q}` | `{ answer, cites[], nearest?, notFound, source: 'claude'|'search'|'none' }` |
| GET | `/api/shares` | `{ shares (with views), milestones, defaultPolicy }` |
| POST | `/api/shares/preview` `{providerId, policy}` | The doctor view, not logged |
| POST | `/api/shares` `{providerId, policy, note}` | `{ token, url: '/p/<token>' }` |
| POST | `/api/shares/:token/revoke` | Revoke |
| GET | `/p/:token` | Doctor page HTML |
| GET | `/api/p/:token` | Doctor view JSON + `following`, `expiresAt` (logs a view) |
| POST | `/api/p/:token/follow` `{follow}` | Save opt-in |
| GET | `/auth/clio` | Start OAuth |
| GET | `/callback` (redirect path) and `/auth/clio/callback` | OAuth return |
| GET | `/api/clio/status` | `{ mode, credentials, base, redirectUri, source, connectedAs, matter, syncing, syncedAt, lastError }` |
| POST | `/api/clio/disconnect` | Forget the Clio token |
| GET | `/replica/api/v4/...` | The local Clio replica |
| GET | anything else | Static file from `public/` (path-normalised), sets the `cl_user` cookie |

Errors are JSON `{ error }` with the thrown status or 500.

---

## 19. Database

`node:sqlite` (`DatabaseSync`), WAL mode, file `DB_FILE` or `data/ross.db`.
```sql
CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);                     -- clio_token, oauth_state
CREATE TABLE snapshots (matter_id INTEGER, synced_at TEXT, data TEXT, PRIMARY KEY (matter_id, synced_at));
CREATE TABLE visits (user_key TEXT, matter_id INTEGER, seen_at TEXT, seen_ids TEXT, PRIMARY KEY (user_key, matter_id));
CREATE TABLE llm_cache (key TEXT PRIMARY KEY, model TEXT, created_at TEXT, input_tokens INTEGER, output_tokens INTEGER, value TEXT);
CREATE TABLE shares (token TEXT PRIMARY KEY, matter_id INTEGER, provider_id INTEGER, provider_name TEXT,
  policy TEXT, note TEXT, created_at TEXT, revoked_at TEXT, following INTEGER DEFAULT 0);
CREATE TABLE share_views (token TEXT, viewed_at TEXT, ip TEXT, ua TEXT);
```
Plus on-disk caches: `data/text-cache/` (OCR, by sha256), `data/pages/` (PDFs, page PNGs, word boxes), `data/photos/`.

---

## 20. Configuration

Names only. Real values live in an untracked `.env` (loaded with `node --env-file-if-exists=.env`) or the host's variables, never in code, git, docs, chat or memory.

| Variable | Purpose | Default |
|---|---|---|
| `CLIO_CLIENT_ID`, `CLIO_CLIENT_SECRET` | Clio developer app credentials | — |
| `CLIO_REDIRECT_URI` | Must equal the redirect registered in Clio; server listens on its port | `http://127.0.0.1:3000/callback` (or Railway domain) |
| `CLIO_BASE` | Clio region host | `https://app.clio.com` |
| `CLIO_MODE` | `auto` / `live` / `replica` | `auto` |
| `CLIO_ACCESS_TOKEN` / `CLIO_REFRESH_TOKEN` | Start connected without a browser login (hosted copies) | — |
| `CLIO_MATTER_ID` / `CLIO_MATTER_QUERY` | Which matter | query `Sapini` |
| `CLIO_BASE_URL`, `CLIO_WEB_BASE` | Override API / web deep-link bases | derived |
| `ANTHROPIC_API_KEY` | Turns on the Claude paths | off (offline engine) |
| `BULK_MODEL`, `BRIEF_MODEL` | Model ids | `claude-haiku-4-5`, `claude-opus-5-5` |
| `CONTINGENCY_FEE` | Fee fraction in the net figure | `0.3333` |
| `FIRM_NAME`, `FIRM_EMAIL` | What the doctor sees and replies to | attorney's office, Clio user's email |
| `APP_PASSWORD` | Gates the lawyer side on hosted deploys | off |
| `PORT`, `HOST` | Listen address | redirect port; `127.0.0.1` (`0.0.0.0` on Railway) |
| `DB_FILE`, `TEXT_CACHE_DIR`, `REPLICA_FIXTURES_DIR` | Paths | `data/ross.db`, `data/text-cache`, `fixtures` |
| `AS_OF` | Freeze "today" for demos and tests | today |

`.env.example` ships with empty Clio credentials, the default redirect, `CLIO_BASE`, `CLIO_MODE=auto` and a commented `ANTHROPIC_API_KEY=`.

---

## 21. Security and privacy

- **Read-only on Clio** by construction (§11.1). Nothing in ROSS can create, edit or delete Clio data.
- **Secrets** only in `.env` (git-ignored, docker-ignored, railway-ignored). If a secret is ever pasted in chat, rotate it in the Clio developer portal after the demo.
- **Hosted deploys:** `APP_PASSWORD` gates everything except the doctor routes (`/p/:token`, `/api/p/:token[/follow]`, the doctor page's CSS/JS, `/healthz`) with HTTP Basic (any username; constant-time compare of sha256 digests). Loopback without `x-forwarded-for` is exempt so the server can read its own replica.
- **Doctor access** is the unguessable token in the link; links expire in 30 days and can be revoked; every open is logged; pages are `noindex`.
- **Least privilege for doctors:** allow-list assembly server-side (§17); the AI writer only sees the filtered view.
- **Path safety:** static paths are normalised and stripped of `../`; document and page routes only serve documents belonging to this matter.
- **OAuth state** checked on return.

---

## 22. Running and deploying

### Local (what the demo uses: the Clio redirect must reach this machine)
```bash
npm install --no-bin-links     # one dependency
cp .env.example .env           # fill in the Clio app id and secret
npm start                      # node --env-file-if-exists=.env --no-warnings src/server.js
open http://127.0.0.1:3000     # starts on the replica; click Connect Clio, then Allow
```
Needs Node 22.5+ and poppler + tesseract (`brew install poppler tesseract` / `apt-get install poppler-utils tesseract-ocr`). Put Swans' `Sapini documents` folder into `fixtures/` for the replica. First run OCRs 522 pages once; later runs are instant. `RUN-ON-YOUR-LAPTOP.md` is the five-step plain-language version (install Node LTS, unzip, make `.env`, `npm start`, open and Connect Clio; optional step 6 for the Anthropic key from console.anthropic.com → Settings → API Keys).

### Docker / Railway
```dockerfile
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils tesseract-ocr ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
ENV NODE_ENV=production HOST=0.0.0.0
EXPOSE 3000
CMD ["node", "--no-warnings", "src/server.js"]
```
`railway.json`: Dockerfile builder, healthcheck `/healthz` (120s), restart on failure. Deploy with `railway up --no-gitignore` so the Sapini PDFs and the OCR cache ship; `.railwayignore`/`.dockerignore` exclude `.env`, `.git/`, `node_modules/`, the database, page images, photos and `docs/`. **Railway flow, and keeping the Clio login.**
```bash
railway init -n ross
railway up --no-gitignore --detach          # ships the Sapini PDFs and OCR cache
railway volume add --mount-path /data       # keeps the Clio login and share links across redeploys
railway variables --set DB_FILE=/data/ross.db --set APP_PASSWORD=<team password> \
  --set CLIO_CLIENT_ID=<id> --set CLIO_CLIENT_SECRET=<secret>   # plus the AI key if you have one
railway domain                              # https://<name>.up.railway.app
```
Leave `CLIO_REDIRECT_URI` unset on Railway; it defaults to `https://$RAILWAY_PUBLIC_DOMAIN/callback`.
1. Create the Railway project and upload the app (`railway up --no-gitignore`, from a machine that can reach Railway).
2. **Add a storage volume** (e.g. mounted at `/data`) and set `DB_FILE=/data/ross.db`. The Clio token lives in that database, so the login survives restarts and redeploys, along with share links and view logs.
3. Set the Clio client id and secret, `APP_PASSWORD`, and optionally the AI key as Railway variables.
4. Generate a public domain. Add `https://<domain>/callback` to the Clio app's redirect URIs in the Clio developer portal (Clio rejects the login otherwise), open the link, enter the team password, click **Connect Clio** once and approve.
5. From then on the saved token refreshes itself before expiry, and if Clio rejects it ROSS forces one refresh and retries the request (§11.1, §11.3).

Don't copy a Clio token from one machine to another or put the password in a link; both weaken security. The default is one Connect Clio on the hosted link. (A `CLIO_REFRESH_TOKEN` seed variable was drafted in the cloud copy but is not committed; treat it as optional.) GitHub Pages and other static hosts can't run ROSS: it needs a server for the Clio login, Ask and the doctor links.

**First-load speed.** The OCR text cache (`data/text-cache/`, keyed by each PDF's sha256) ships with the app, so a fresh install or deploy never re-OCRs the 522 scanned pages. Documents download in parallel, page images and word boxes are made only when a page is opened, and the server starts reading the case as soon as it boots and shows what it is reading. With the cache present a sync takes seconds, not minutes. The one unavoidable cost is the first download of the documents from live Clio (about 85 MB for Sapini).

---

## 23. Testing

### End-to-end checklist (run against a fresh unzip, with a stand-in Clio OAuth/API server and against the replica; 16 checks)
1. Server starts; `/healthz` ok; warm-up finishes.
2. **Connect Clio** redirects to `/oauth/authorize` with the right client id, redirect URI and state.
3. Callback exchanges the code (id + secret) for a token and returns on `/callback`.
4. Mode switches to live; status shows *connected as <user>*.
5. Sync pulls 162 entries and 15 documents with ~35 GET requests and **zero writes**.
6. Case screen numbers: $375,000 · $100,000 confirmed Sep 9 · ≈$43,080.
7. Headline cites open the right sources.
8. Ask *"When did coverage get confirmed?"* → Sep 9, cited.
9. Ask *"Medicaid lien?"* → $22,180, cited.
10. Ask *"Is there a trial date?"* → *Not in the file.*
11. Clicking a document cite opens the page image with the passage highlighted (e.g. right shoulder MRI, Haggerty imaging p.35).
12. Share sheet: insurance off by default; preview updates live; link created.
13. Doctor page opens on a phone viewport with no login; insurance, case value and lien are absent.
14. Follow toggle saves and survives reload.
15. Lawyer sees *opened your link* after the doctor opens it.
16. Revoke stops the link (*This link isn't available*).
Also: with `APP_PASSWORD` set, the lawyer side returns 401 without it, the doctor link opens without it but cannot reach case data.

On the Mac copy this has grown to **25 browser tests**, all passing, covering every flow in the design: Clio data reaching the Case screen, Ask with sources, the PDF page opening with the line highlighted, "Not in the file", Share with live preview and a secure link, the doctor's phone page, the opened loop, and revoke. Drive it with Playwright/Selenium, save screenshots to `docs/screens/` (`e2e-live-case.png`, `e2e-ask.png`, `e2e-reference-highlight.png`, `e2e-share.png`, `e2e-doctor.png`).

### Persona review
Before calling a change done, walk it as each of these and fix until each is satisfied: a hackathon **judge** ("Can I tell what's different in one breath?"), a **PI partner** ("Three numbers and a to-do list. That's my Monday. Insurance off by default is right."), a new **associate** (Ask covers the deep questions), and a **records coordinator** at the doctor's office ("I read it before my next patient. I'd turn on alerts."). These are role-played reviews, not real users, and must be described that way. Check every Sapini detail against the file (see §25); earlier drafts got the surgery and coverage facts wrong.

---

## 24. The 90-second demo

| Time | Say and do | Shows |
|---|---|---|
| 0:00 | "This is Justin." Open the Case screen. Read the one sentence: worth $375k, only $100k behind it, surgery has no date. | Case screen |
| 0:15 | "What changed since I looked?" Three lines. Nobody else shows you this. | Differentiator 1 |
| 0:25 | "Can I trust it?" Tap $100,000. The adjuster's email, highlighted. | Source sheet |
| 0:35 | "Has he had the surgery?" The left yes, the right no, two sources; tap a cite and the scanned page opens highlighted. "When is trial?" Not in the file. | Ask · RAG |
| 0:55 | "Now the doctor." Share with McCulloch: two switches, preview, send. | Share sheet |
| 1:05 | On a phone: "The case is active. We need the surgery date." Tap Reply. | Differentiator 2 |
| 1:15 | Back on the laptop: "McCulloch opened today." Reopen the case: $0.00, read-only, 0 writes in Clio. | Differentiator 3 |

Submission answers (tech stack, models, cost, judge notes) live in `SUBMISSION.md`; keep them in sync with this file and the product name ROSS.

---

## 25. Sapini golden values

Use these to verify a rebuild (as of Oct 2, 2026). They must come out of the code, never be typed into it.

- Client **Justin Sapini**, DOB Dec 21, 1995 (age 30), financial advisor at Northwestern Mutual (his **employer**, not an insurer).
- Incident Apr 23, 2023, Cedar St at Garden St, New Rochelle, NY: sideswiped by a Metro-North utility vehicle. Matter opened May 7, 2023. SOL Apr 22, 2026. Stage **Litigation**, status Open.
- Defendant Metro-North, **self-insured**, claims by Claims Service Bureau, claim SIR068120. Limits: defendant $100,000 / $300,000; client UM/UIM $25,000 / $50,000; no-fault $50,000 (Progressive). Coverage confirmed by the adjuster's email **Sep 9, 2026**.
- Estimated value **$375,000**; specials $118,400; wage loss claimed $214,000; Medicaid lien **$22,180**; firm spend $1,410 (5 expenses on the replica: records copies $85 + $65 + $450, IME observer $600, court filing $210); net ≈ **$43,080** at a 33.3% fee on the replica, ≈ **$41,965** on Bijin's live Clio after medical bills were excluded from firm costs (§14). A negative net means bills are being counted as costs.
- **Left shoulder already operated** (arthroscopic labral repair, Jul 26, 2023). **Right shoulder surgery recommended, no date**. McCulloch replied Sep 24 (surgeon wants to see him first); the surgery-date task is **38 days late**. Client employment/commission records task 6 days late. An offer exists in the file. No trial date in the file.
- Injuries: both shoulders, head, cervical, both knees, lumbar. Right shoulder MRI (May 2023) intermediate-grade interstitial tear, Haggerty imaging bundle p.35.
- Providers: McCulloch Orthopaedic Surgical Services (Dr. Capiola's office), Advanced Rockland (chiropractic, Kevin M. Haggerty, D.C.), SportsCare physical therapy, Montefiore Nyack (ER, DOI+1). Treatment ongoing: PT and chiropractic weekly.
- 162 entries, 15 documents, 662 pages, 522 scanned.

---

## 26. Known gaps

- "Reply to the firm" is a mailto; replies reach Clio through the firm's email capture, not through ROSS.
- *Tell me when the case moves* stores the opt-in; sending alerts (with the lawyer approving each) is not built.
- The 33.3% contingency fee is an assumption, labelled as one.
- Offline injury extraction is keyword-based and noisier than the Claude path; every finding opens its page so a person can check. OCR quality on poor scans is the main risk.
- The competitor table is from vendor sites and must be checked before quoting on stage.
- **Ask without an AI key** strings quoted sentences together, and some answers read like fragments; the key is what makes answers like "The left, yes. The right, not yet." The design is Claude (§15). Bijin also offered an OpenAI key, and the Mac copy is wiring it in for Ask answers. If you keep that path, it must follow the same contract: answer only from the numbered passages, return cites, say "Not in the file" otherwise, and cache by input. Any key pasted in chat must be rotated after the demo.
- Real app.clio.com was exercised from Bijin's Mac; the cloud build environment blocks app.clio.com and Railway, so CI-style tests run against a stand-in Clio and the replica.

---

## 27. Build order

If you are rebuilding ROSS from this file, go in this order and keep each step runnable:

1. `db.js`, `root.js`, the read-only Clio client and the **replica** from the fixtures JSON. Prove sync returns the CaseFile.
2. `extract.js`: page text + OCR with the sha256 cache (start it early; first OCR takes a while).
3. `facts.js` and check §25's money and dates.
4. `heuristic.js` and `index.js` (digest, changes since, mark seen).
5. Lawyer Case screen and the Source sheet (every number opens a source).
6. `rag.js` + the Ask sheet; then `pagebox.js` and the page-image highlight.
7. `provider.js`, the Share sheet with live preview, and the doctor page (one renderer for both).
8. OAuth + live mode; `/api/clio/status`, Connect Clio, error banner.
9. `llm.js` (triage, injuries, brief, doctor update, Ask) behind the key, all cached.
10. ROSS branding pass (§7.1), responsive pass, accessibility pass.
11. `APP_PASSWORD`, Dockerfile, Railway.
12. The §23 end-to-end run and persona review; screenshots; README and SUBMISSION.
