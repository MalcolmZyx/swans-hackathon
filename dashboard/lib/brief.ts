import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Brief, CaseData, Source } from "./types";

const BRIEF_FILE = path.join(process.cwd(), "data", "brief.json");
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";

// There is no real sign-in yet, so each Refresh from Clio stands in for one: the case.json the
// user was looking at before the refresh is "what they saw last visit", and the brief explains
// what changed between that pull and the new one.

export type Change = {
  change: "added" | "removed" | "updated";
  id: string;
  what: string;
  title: string;
  record?: unknown; // the new record, for additions
  fields?: Record<string, { before: unknown; after: unknown }>; // for updates
};

function diffBy<T>(what: (item: T) => string, before: T[], after: T[], key: (item: T) => string, title: (item: T) => string, fields: (keyof T & string)[], show: (item: T) => unknown = (i) => i): Change[] {
  const old = new Map(before.map((i) => [key(i), i]));
  const now = new Map(after.map((i) => [key(i), i]));
  const changes: Change[] = [];
  for (const [id, item] of now) {
    const prev = old.get(id);
    if (!prev) {
      changes.push({ change: "added", id, what: what(item), title: title(item), record: show(item) });
      continue;
    }
    const diff: Change["fields"] = {};
    for (const f of fields) {
      if (JSON.stringify(prev[f]) !== JSON.stringify(item[f])) diff[f] = { before: prev[f], after: item[f] };
    }
    if (Object.keys(diff).length) changes.push({ change: "updated", id, what: what(item), title: title(item), fields: diff });
  }
  for (const [id, item] of old) {
    if (!now.has(id)) changes.push({ change: "removed", id, what: what(item), title: title(item) });
  }
  return changes;
}

/** Everything that differs between two Clio pulls. Documents and records requests are built from events, so events cover them. */
export function diffCase(before: CaseData, after: CaseData): Change[] {
  const matterFields = (d: CaseData) => ({ id: "matter", stage: d.matter.stage, status: d.matter.status, description: d.matter.description, responsibleAttorney: d.matter.responsibleAttorney, sol: d.matter.sol.date });
  return [
    ...diffBy(() => "matter", [matterFields(before)], [matterFields(after)], (m) => m.id, () => "Matter", ["stage", "status", "description", "responsibleAttorney", "sol"]),
    ...diffBy((e) => e.kind, before.events, after.events, (e) => e.id, (e) => e.title, ["date", "title", "body", "status", "from", "to", "amount", "folder"], (e) => condenseEvent(e)),
    ...diffBy(() => "case fact", before.facts, after.facts, (f) => `fact:${f.name}`, (f) => f.name, ["value"], (f) => ({ name: f.name, value: f.value })),
    ...diffBy(() => "key number", before.numbers, after.numbers, (n) => `number:${n.key}`, (n) => n.label, ["value"], (n) => ({ label: n.label, value: n.value })),
    ...diffBy(() => "person or organization", before.parties, after.parties, (p) => `party:${p.id}`, (p) => p.name, ["name", "role", "category", "email", "phone"], (p) => ({ name: p.name, role: p.role, category: p.category })),
    ...diffBy(() => "case cost", before.costs, after.costs, (c) => c.id, (c) => `${c.category}: ${c.description}`, ["amount", "date", "category", "description"], (c) => ({ date: c.date, amount: c.amount, category: c.category, description: c.description })),
  ];
}

function condenseEvent(e: CaseData["events"][number]) {
  return {
    id: e.id,
    kind: e.kind,
    date: e.date,
    title: e.title,
    ...(e.status && { status: e.status }),
    ...(e.milestone && { milestone: e.milestone }),
    ...(e.from && { from: e.from }),
    ...(e.to && { to: e.to }),
    ...(e.amount != null && { amount: e.amount }),
    body: e.body.length > 2000 ? `${e.body.slice(0, 2000)}…` : e.body,
  };
}

/** The case as the model sees it: no Clio API plumbing, every record tagged with an id it can cite. */
function condenseCase(data: CaseData) {
  const party = (id: number | null) => data.parties.find((p) => p.id === id)?.name ?? null;
  const { matter } = data;
  return {
    matter: { id: "matter", number: matter.displayNumber, description: matter.description, status: matter.status, practiceArea: matter.practiceArea, opened: matter.openDate, stage: matter.stage, stages: matter.stages, responsibleAttorney: matter.responsibleAttorney, client: matter.client.name, statuteOfLimitations: matter.sol },
    facts: data.facts.map((f) => ({ id: `fact:${f.name}`, name: f.name, value: f.value })),
    numbers: data.numbers.map((n) => ({ id: `number:${n.key}`, label: n.label, value: n.value })),
    parties: data.parties.map((p) => ({ id: `party:${p.id}`, name: p.name, category: p.category, role: p.role })),
    events: data.events.map(condenseEvent),
    recordsRequests: data.requests.map((r) => ({ id: r.taskId, provider: party(r.providerId), title: r.title, status: r.status, due: r.due, timesAsked: r.timesAsked, lastReply: r.lastReply })),
    costs: data.costs.map((c) => ({ id: c.id, date: c.date, amount: c.amount, category: c.category, description: c.description })),
  };
}

/** Record id → Clio source, for turning the ids the model cites back into source chips. */
export function sourceIndex(data: CaseData): Map<string, Source> {
  const index = new Map<string, Source>([["matter", data.matter.source]]);
  data.facts.forEach((f) => index.set(`fact:${f.name}`, f.source));
  data.numbers.forEach((n) => n.source && index.set(`number:${n.key}`, n.source));
  data.parties.forEach((p) => index.set(`party:${p.id}`, p.source));
  data.costs.forEach((c) => index.set(c.id, c.source));
  data.events.forEach((e) => index.set(e.id, e.source));
  return index;
}

const INSTRUCTIONS = `You write the briefing a lawyer sees when they open a personal-injury matter in the firm's case dashboard. The data is the matter exported from Clio, the firm's case-management system.

You receive:
- today: today's date.
- lastVisit: when the lawyer last opened the dashboard, or null if this is their first visit.
- changes: every record added, removed or updated in Clio since lastVisit.
- case: the whole matter.

Return:
- headline: one sentence on where the case stands right now.
- whatsNew: what changed since lastVisit, most important first. Merge related changes into one point (an email and the task it completed are one point) and say why the change matters to the case when the file makes that clear. Use only the changes list for this. Return an empty list when changes is empty.
- overview: 5 to 7 points a lawyer new to the file needs, in this order: who the client is and what happened; injuries and treatment; where the lawsuit stands; the money (estimated value, policy limits, medical specials, liens); the biggest risks; what is overdue or coming up next.

Rules:
- Use only facts in the data. Do not guess or fill gaps, and do not add legal advice the file does not contain.
- Each point is one or two plain-English sentences, under 40 words. Give it a label of one to three words (for example "Treatment" or "Next up") when that helps someone scanning.
- Write dates like "Mar 4, 2026" and money like "$250,000". Say "overdue", "today" or "in 5 days" relative to today where it helps.
- sources: the ids of the one to three records each point relies on, exactly as they appear in the data ("note-123", "task-456", "fact:Date of Incident", "number:value", "party:789", "matter"). Never invent an id.`;

const POINT = {
  type: "OBJECT",
  properties: { label: { type: "STRING" }, text: { type: "STRING" }, sources: { type: "ARRAY", items: { type: "STRING" } } },
  required: ["text", "sources"],
  propertyOrdering: ["label", "text", "sources"],
};
const SCHEMA = {
  type: "OBJECT",
  properties: { headline: { type: "STRING" }, whatsNew: { type: "ARRAY", items: POINT }, overview: { type: "ARRAY", items: POINT } },
  required: ["headline", "whatsNew", "overview"],
  propertyOrdering: ["headline", "whatsNew", "overview"],
};

/** Ask Gemini for the brief. `before` is the pull the user last saw, or null on the first visit. */
export async function generateBrief(before: CaseData | null, after: CaseData, today: string): Promise<Brief> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set in dashboard/.env.local");
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const changes = before ? diffCase(before, after) : [];
  const input = { today, lastVisit: before?.pulledAt ?? null, changes, case: condenseCase(after) };

  const res = await fetch(`${GEMINI}/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(input) }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? `Gemini returned ${res.status}`);
  const text = (body.candidates?.[0]?.content?.parts ?? [])
    .filter((p: { thought?: boolean }) => !p.thought)
    .map((p: { text?: string }) => p.text ?? "")
    .join("");
  if (!text) throw new Error(`Gemini returned no summary (${body.candidates?.[0]?.finishReason ?? body.promptFeedback?.blockReason ?? "empty response"})`);
  const out = JSON.parse(text) as Pick<Brief, "headline" | "whatsNew" | "overview">;

  // Keep only citations that point at real records.
  const known = sourceIndex(after);
  const clean = (points: Brief["overview"]) => points.map((p) => ({ ...p, sources: p.sources.filter((id) => known.has(id)) }));
  return {
    generatedAt: new Date().toISOString(),
    model,
    pulledAt: after.pulledAt,
    since: before?.pulledAt ?? null,
    changeCount: changes.length,
    headline: out.headline,
    whatsNew: changes.length ? clean(out.whatsNew) : [],
    overview: clean(out.overview),
  };
}

export async function saveBrief(brief: Brief): Promise<void> {
  await writeFile(BRIEF_FILE, JSON.stringify(brief, null, 1), "utf-8");
}

export async function loadBrief(): Promise<Brief | null> {
  try {
    return JSON.parse(await readFile(BRIEF_FILE, "utf-8")) as Brief;
  } catch {
    return null;
  }
}
