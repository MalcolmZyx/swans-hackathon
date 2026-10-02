import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CaseData } from "./types";
import { computeFacts, firstName, tidyTitle } from "./digest";
import { daysBetween, fmtDate } from "./format";
import { injuries, injuryLabels } from "./pages";

/**
 * Sharing with a doctor (DESIGN.md §17). The doctor view is assembled here, on the server, from an
 * allow-list: anything not switched on is never serialised, so it cannot leak through the browser.
 * Case value, internal notes, strategy, settlement talk and liens have no switch at all.
 */

export type Policy = { status: boolean; treatment: boolean; coverage: boolean };
export const DEFAULT_POLICY: Policy = { status: true, treatment: true, coverage: false };
export const LINK_DAYS = 30;

export type Share = {
  token: string;
  matterId: number;
  providerId: number;
  providerName: string;
  policy: Policy;
  note: string;
  createdAt: string;
  revokedAt: string | null;
  following: boolean;
  views: { at: string; ua: string }[];
};

// Bring your own database outside Clio: a JSON file next to case.json.
const FILE = path.join(process.cwd(), "data", "shares.json");

export async function loadShares(): Promise<Share[]> {
  try {
    return JSON.parse(await readFile(FILE, "utf-8")) as Share[];
  } catch {
    return [];
  }
}

async function saveShares(shares: Share[]) {
  await writeFile(FILE, JSON.stringify(shares, null, 1), "utf-8");
}

export async function createShare(data: CaseData, providerId: number, policy: Policy, note: string): Promise<Share> {
  const provider = data.parties.find((p) => p.id === providerId && p.category === "medical");
  if (!provider) throw new Error("That provider is not on this matter.");
  const share: Share = {
    token: randomBytes(18).toString("base64url"),
    matterId: data.matter.id,
    providerId,
    providerName: provider.name,
    policy: { status: !!policy.status, treatment: !!policy.treatment, coverage: !!policy.coverage },
    note: note.slice(0, 2000),
    createdAt: new Date().toISOString(),
    revokedAt: null,
    following: false,
    views: [],
  };
  await saveShares([...(await loadShares()), share]);
  return share;
}

export function expiresAt(s: Share): string {
  return new Date(new Date(s.createdAt).getTime() + LINK_DAYS * 864e5).toISOString();
}

export function isLive(s: Share): boolean {
  return !s.revokedAt && new Date(expiresAt(s)) > new Date();
}

export async function updateShare(token: string, change: (s: Share) => void): Promise<Share | null> {
  const shares = await loadShares();
  const s = shares.find((x) => x.token === token);
  if (!s) return null;
  change(s);
  await saveShares(shares);
  return s;
}

/** A live share for this token, with the open logged. */
export async function openShare(token: string, ua: string): Promise<Share | null> {
  const shares = await loadShares();
  const s = shares.find((x) => x.token === token);
  if (!s || !isLive(s)) return null;
  s.views.push({ at: new Date().toISOString(), ua: ua.slice(0, 200) });
  await saveShares(shares);
  return s;
}

/** Providers the firm can share with: medical companies and doctors on this matter, with open asks. */
export function shareableProviders(data: CaseData) {
  const asks = (id: number) =>
    data.requests.filter((r) => r.providerId === id && r.status === "pending").length +
    data.events.filter((e) => e.kind === "task" && e.status === "pending" && e.providerIds.includes(id) && !/^Records request/i.test(e.title)).length;
  return data.parties
    .filter((p) => p.category === "medical")
    .map((p) => ({ id: p.id, name: p.name, openAsks: asks(p.id) }))
    .sort((a, b) => b.openAsks - a.openAsks || a.name.localeCompare(b.name));
}

/** "Client treatment: physical therapy (following week), SportsCare…" → "physical therapy". */
function careKind(title: string): string | null {
  const m = /^(?:client )?(?:treatment|type)\s*:\s*([^,]+)/i.exec(title);
  if (!m) return null;
  return m[1].replace(/\([^)]*\)/g, "").trim().toLowerCase();
}

export async function doctorView(data: CaseData, providerId: number, policy: Policy, note: string, today: string, expires?: string) {
  const provider = data.parties.find((p) => p.id === providerId && p.category === "medical");
  if (!provider) throw new Error("That provider is not on this matter.");
  const f = computeFacts(data, today);
  const { matter } = data;
  const firm = {
    attorney: matter.responsibleAttorney ?? "The firm",
    name: process.env.FIRM_NAME || `${matter.responsibleAttorney ?? "Your attorney"}'s office`,
    email: process.env.FIRM_EMAIL || "",
  };

  const view = {
    patient: { name: matter.client.name, firstName: firstName(matter.client.name), dob: matter.client.dob, doi: f.doi },
    provider: { id: provider.id, name: provider.name },
    firm,
    note: note.trim(),
    asOf: today,
    expiresAt: expires ?? new Date(Date.now() + LINK_DAYS * 864e5).toISOString(),
    status: null as null | {
      open: boolean;
      stageIndex: number;
      stageCount: number;
      lastMoved: string | null;
      daysAgo: number | null;
      asks: { title: string; detail: string; due: string; overdue: boolean; daysLeft: number }[];
    },
    treatment: null as null | { ongoing: boolean; regions: string[]; kinds: string[]; nextVisit: string | null; pastVisits: number },
    coverage: null as null | { limit: number | null; confirmed: boolean; confirmedOn: string | null },
    update: "",
  };

  if (policy.status) {
    const asks = [
      ...data.requests.filter((r) => r.providerId === providerId && r.status === "pending").map((r) => ({ title: tidyTitle(r.title), detail: r.detail, due: r.due })),
      ...data.events
        .filter((e) => e.kind === "task" && e.status === "pending" && e.providerIds.includes(providerId) && !/^Records request/i.test(e.title))
        .map((e) => ({ title: tidyTitle(e.title), detail: "", due: e.date })),
    ];
    view.status = {
      open: !/closed/i.test(matter.status) && matter.stage !== "Closed",
      stageIndex: Math.max(0, matter.stages.indexOf(matter.stage)),
      stageCount: matter.stages.length,
      lastMoved: f.lastActivity?.date ?? null,
      daysAgo: f.lastActivity ? daysBetween(f.lastActivity.date, today) : null,
      asks: asks.map((a) => ({ ...a, overdue: a.due < today, daysLeft: daysBetween(today, a.due) })).slice(0, 3),
    };
  }

  if (policy.treatment) {
    // Kind of care only: other providers' names are never included.
    const visits = data.events.filter((e) => e.kind === "calendar" && careKind(e.title));
    const upcoming = visits.filter((e) => e.date >= today);
    const regions = injuryLabels(await injuries(data)).map((i) => i.label);
    view.treatment = {
      ongoing: f.treatmentOngoing,
      regions,
      kinds: [...new Set(upcoming.map((e) => careKind(e.title)!))],
      nextVisit: upcoming[0]?.date ?? null,
      pastVisits: visits.length - upcoming.length,
    };
  }

  if (policy.coverage) {
    view.coverage = { limit: f.coverage.value, confirmed: f.coverage.confirmed, confirmedOn: f.coverage.confirmedOn };
  }

  // Plain-English update written only from what was shared (offline template).
  const parts: string[] = [];
  const name = view.patient.firstName;
  if (view.status) {
    parts.push(`${name}'s case is ${view.status.open ? "open and moving forward" : "closed"}${view.status.lastMoved ? `; it last moved on ${fmtDate(view.status.lastMoved)}` : ""}.`);
  }
  if (view.treatment) parts.push(view.treatment.ongoing ? "Treatment is recorded as ongoing." : "Treatment is recorded as complete.");
  if (view.coverage?.limit) parts.push(`A $${view.coverage.limit.toLocaleString("en-US")} liability policy has been confirmed${view.coverage.confirmedOn ? ` in writing on ${fmtDate(view.coverage.confirmedOn)}` : ""}.`);
  view.update = parts.join(" ");
  return view;
}

export type DoctorView = Awaited<ReturnType<typeof doctorView>>;
