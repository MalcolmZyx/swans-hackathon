import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CaseData, CaseEvent, Party, PdfCite } from "./types";

const CASE_FILE = path.join(process.cwd(), "data", "case.json");

/** Today, or AS_OF (YYYY-MM-DD) to freeze it for demos and tests. */
export function today(): string {
  return process.env.AS_OF || new Date().toLocaleDateString("en-CA");
}

// Keep only the PDF passages in documents this viewer may open.
function restrictPdfs(node: unknown, allowed: Set<number>): void {
  if (Array.isArray(node)) {
    node.forEach((n) => restrictPdfs(n, allowed));
  } else if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if ("api" in obj && "recordId" in obj && Array.isArray(obj.pdf)) {
      obj.pdf = (obj.pdf as PdfCite[]).filter((c) => allowed.has(c.doc));
      return;
    }
    Object.values(obj).forEach((v) => restrictPdfs(v, allowed));
  }
}

export async function loadCase(): Promise<CaseData | null> {
  let raw: string;
  try {
    raw = await readFile(CASE_FILE, "utf-8");
  } catch {
    return null;
  }
  return JSON.parse(raw) as CaseData;
}

export function medicalProviders(data: CaseData): Party[] {
  return data.parties.filter((p) => p.category === "medical");
}

/** What the case journey plots: the key moments, plus the appointments and open tasks still ahead. */
export function journey<T extends CaseEvent>(events: T[], today: string): T[] {
  return events.filter((e) => e.milestone || (e.date >= today && (e.kind === "calendar" || (e.kind === "task" && e.status === "pending"))));
}

/**
 * What a medical provider may see. Filtering happens here on the server, so attorney notes,
 * legal case facts, insurer correspondence and other providers' bills never reach the browser.
 * Source passages are cut to the PDFs this provider may see, everywhere in `data` (this request's
 * copy), so it also covers sources the page reads from `data` directly.
 */
export function providerView(data: CaseData, providerId: number) {
  const shared = <T extends { audience: string }>(items: T[]) => items.filter((i) => i.audience !== "legal");
  const theirs = shared(data.documents).filter((d) => d.providerIds.includes(providerId));
  restrictPdfs(data, new Set(theirs.map((d) => Number(d.source.recordId))));
  return {
    matter: { ...data.matter, sol: undefined },
    facts: shared(data.facts),
    numbers: shared(data.numbers),
    // Providers see treatment milestones in place of legal ones.
    events: shared(data.events).map(({ medicalMilestone, ...e }) => ({ ...e, milestone: medicalMilestone })),
    documents: shared(data.documents).filter((d) => d.providerIds.includes(providerId)),
    charges: data.charges.filter((c) => c.providerId === providerId),
    requests: data.requests.filter((r) => r.providerId === providerId),
    careTeam: medicalProviders(data),
    pulledAt: data.pulledAt,
  };
}

export type ProviderView = ReturnType<typeof providerView>;
