import { createHash } from "node:crypto";
import type { CaseData, CaseEvent, Source } from "./types";
import { daysBetween } from "./format";

/**
 * Facts computed, not generated (DESIGN.md §14). Every number on the Case screen comes from Clio
 * fields and entries here, and carries the sources the UI opens when it is tapped.
 */

export type Sourced<T> = { value: T; src: Source[] };

const text = (e: CaseEvent) => `${e.title}\n${e.body}`;

/** First "$1,234.56" in a string, or the number itself. */
export function moneyIn(v: unknown): number | null {
  if (typeof v === "number") return v;
  const m = /\$\s?([\d,]+(?:\.\d+)?)/.exec(String(v ?? ""));
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

/** "By medical provider: X - Updated records" → "Updated records"; "Records request: Y" → "Y". */
export function tidyTitle(title: string): string {
  const t = title
    .replace(/^By [^:]+:\s*.+?\s[-–]\s/i, "")
    .replace(/^Records request:\s*/i, "")
    .trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

export function etag(e: CaseEvent): string {
  return createHash("sha1").update(`${e.date}|${e.title}|${e.body}|${e.status ?? ""}|${e.amount ?? ""}`).digest("hex").slice(0, 10);
}

export function computeFacts(data: CaseData, today: string) {
  const fact = (name: string) => data.facts.find((f) => f.name === name);
  const num = (key: string) => data.numbers.find((n) => n.key === key);
  const events = data.events.filter((e) => e.date <= today || e.kind === "task" || e.kind === "calendar");
  const latest = (re: RegExp, kinds: CaseEvent["kind"][], n = 1) =>
    events
      .filter((e) => kinds.includes(e.kind) && e.date <= today && re.test(text(e)))
      .slice(-n)
      .reverse();

  // Coverage: the Defendant line of Policy Limits.
  const limitsFact = fact("Policy Limits");
  const defLine = String(limitsFact?.value ?? "")
    .split("\n")
    .find((l) => /defendant/i.test(l));
  const coverageValue = moneyIn(defLine) ?? num("defendantLimit")?.value ?? null;
  const confirmedEvents = latest(/coverage (confirmed|position)|limits are \$/i, ["note", "email", "call"]);
  const confirmedFact = fact("Policy Limits Confirmed");
  const confirmed = confirmedFact?.value === true || String(confirmedFact?.value) === "true";
  const coverage = {
    value: coverageValue,
    confirmed,
    confirmedOn: confirmed ? (confirmedEvents[0]?.date ?? null) : null,
    src: [...confirmedEvents.map((e) => e.source), ...(limitsFact ? [limitsFact.source] : []), ...(confirmedFact ? [confirmedFact.source] : [])],
  };

  const valueNum = num("value");
  const valueFact = fact("Estimated Case Value");
  const value = {
    value: valueNum?.value ?? moneyIn(valueFact?.value),
    src: [...latest(/valuation|case evaluation/i, ["note"], 2).map((e) => e.source), ...(valueNum?.source ? [valueNum.source] : []), ...(valueFact ? [valueFact.source] : [])],
  };

  const lienFact = fact("Health Insurance or Lien Holder");
  const lienNum = num("lien");
  const lien = {
    value: lienNum?.value ?? moneyIn(lienFact?.value) ?? 0,
    src: [...(lienFact ? [lienFact.source] : []), ...latest(/\blien|medicaid/i, ["note", "email", "task"], 3).map((e) => e.source)],
  };

  // Firm spend: the firm's own case costs. Medical bills are the client's specials, already in
  // the specials figure and the lien, so they are kept out (data.charges, not data.costs).
  const firmSpend = { value: data.costs.reduce((s, c) => s + c.amount, 0), src: data.costs.map((c) => c.source) };

  const feePct = Number(process.env.CONTINGENCY_FEE) || 0.3333;
  const recoverable = value.value != null && coverage.value != null ? Math.min(value.value, coverage.value) : (coverage.value ?? value.value ?? 0);
  const fee = Math.round(recoverable * feePct);
  const net = recoverable - fee - firmSpend.value - lien.value;

  const tasks = data.events.filter((e) => e.kind === "task");
  const open = tasks.filter((t) => t.status !== "complete");
  const overdue = open
    .filter((t) => t.date < today)
    .map((t) => ({ event: t, daysLate: daysBetween(t.date, today) }))
    .sort((a, b) => b.daysLate - a.daysLate);
  const upcoming = open.filter((t) => t.date >= today && daysBetween(today, t.date) <= 30).sort((a, b) => a.date.localeCompare(b.date));

  // Last real conversation with the client.
  const clientId = data.matter.client.id;
  const withClient = data.events.filter((e) => (e.kind === "call" || e.kind === "email") && e.date <= today && (e.counterpartIds ?? []).includes(clientId));
  const lastTalk = withClient.filter((e) => e.kind === "call").at(-1) ?? null;
  const lastActivity = data.events.filter((e) => e.kind !== "calendar" && e.kind !== "milestone" && e.date <= today).at(-1) ?? null;

  const doi = String(fact("Date of Incident")?.value ?? "") || null;
  const dob = data.matter.client.dob;
  const age = dob ? Math.floor(daysBetween(dob, today) / 365.25) : null;
  const treatmentFact = fact("Treatment Status");
  const treatmentOngoing = /active|ongoing/i.test(String(treatmentFact?.value ?? ""));

  return {
    coverage,
    value,
    lien,
    firmSpend,
    feePct,
    recoverable,
    fee,
    net: { value: net, src: [...coverage.src.slice(0, 1), ...value.src.slice(0, 1), ...lien.src.slice(0, 1), ...firmSpend.src] },
    overdue,
    upcoming,
    openTasks: open,
    lastTalk,
    lastActivity,
    lastContact: lastTalk ?? lastActivity,
    doi,
    doiSource: fact("Date of Incident")?.source ?? null,
    age,
    treatmentOngoing,
    treatmentSource: treatmentFact?.source ?? null,
  };
}

export type Facts = ReturnType<typeof computeFacts>;

// ---------- Heuristic importance (§14) ----------

const KIND_WEIGHT: Partial<Record<CaseEvent["kind"], number>> = { note: 1.5, document: 1.2, task: 1, call: 0.8, calendar: 0.7, email: 0.6, charge: 0.2, milestone: 1.5 };
const SIGNALS: [RegExp, number][] = [
  [/surger|arthroscop|operative/i, 3],
  [/\blien|medicaid/i, 2.5],
  [/coverage|limits?\b|policy/i, 2.5],
  [/exhausted/i, 2],
  [/\bIME\b|expert|radiolog|MRI/i, 2],
  [/served|summons|complaint|\banswer\b/i, 1.5],
  [/demand|offer|negotiat|settle/i, 2.5],
  [/deposition|motion|compel/i, 1.5],
  [/discrepanc|contradict|prior injur/i, 3],
  [/scope of employment|liability|mechanism/i, 2.5],
  [/recommend/i, 1.5],
  [/no date|still no|unanswered|third request/i, 2],
  [/valuation|\$\d{3},\d{3}/i, 2.5],
  [/wage|1099|commission/i, 1.5],
  [/limitations/i, 2],
];
const ROUTINE = /^(records request|checking in|follow[- ]up|re: records)/i;

export function score(e: CaseEvent, today: string): number {
  const t = text(e);
  let s = KIND_WEIGHT[e.kind] ?? 0.5;
  for (const [re, w] of SIGNALS) if (re.test(t)) s += w;
  if (ROUTINE.test(e.title)) s -= 2;
  const age = daysBetween(e.date, today);
  if (age >= 0 && age < 45) s += 1.5;
  else if (age >= 0 && age < 120) s += 0.5;
  if (e.kind === "task" && e.status !== "complete" && e.date < today) s += 3;
  return s;
}

export function importance(e: CaseEvent, today: string): number {
  return Math.max(1, Math.min(5, Math.round(score(e, today) / 2.2)));
}

/** The body sentence carrying the most signals: the "why" line. */
export function keySentence(e: CaseEvent): string {
  const sentences = e.body.split(/(?<=[.!?])\s+/).filter((s) => s.length > 12);
  let best = "";
  let bestScore = -1;
  for (const s of sentences) {
    const sc = SIGNALS.reduce((acc, [re, w]) => acc + (re.test(s) ? w : 0), 0);
    if (sc > bestScore) {
      best = s;
      bestScore = sc;
    }
  }
  return best.length > 140 ? `${best.slice(0, 137)}…` : best;
}

// ---------- What changed since you looked ----------

export type ChangeBasis = "first-visit" | "since-seen" | "since-date";

export function changesSince(data: CaseData, today: string, seen: Set<string> | null, sinceDate?: string) {
  const items = data.events.filter((e) => e.kind !== "milestone" && e.kind !== "calendar" && e.date <= today);
  let basis: ChangeBasis;
  let changed: CaseEvent[];
  if (sinceDate) {
    basis = "since-date";
    changed = items.filter((e) => e.date >= sinceDate);
  } else if (!seen) {
    basis = "first-visit";
    changed = items.filter((e) => daysBetween(e.date, today) <= 30);
  } else {
    basis = "since-seen";
    changed = items.filter((e) => !seen.has(`${e.id}:${etag(e)}`));
  }
  const ranked = [...changed].sort((a, b) => score(b, today) - score(a, today) || b.date.localeCompare(a.date));
  return { basis, total: changed.length, top: ranked.slice(0, 3) };
}

export function seenIds(data: CaseData): string[] {
  return data.events.map((e) => `${e.id}:${etag(e)}`);
}
