import { readFile } from "node:fs/promises";
import path from "node:path";
import { clioUrl } from "./clio";
import type { CaseData, Party } from "./types";

const CASE_FILE = path.join(process.cwd(), "data", "case.json");

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Give every source object an "Open in Clio" link.
function addLinks(node: unknown, matterId: number, base: string): void {
  if (Array.isArray(node)) {
    node.forEach((n) => addLinks(n, matterId, base));
  } else if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if ("api" in obj && "recordId" in obj && "kind" in obj) {
      obj.href = clioUrl(obj as never, matterId, base);
    }
    Object.values(obj).forEach((v) => addLinks(v, matterId, base));
  }
}

export async function loadCase(): Promise<CaseData | null> {
  let raw: string;
  try {
    raw = await readFile(CASE_FILE, "utf-8");
  } catch {
    return null;
  }
  const data = JSON.parse(raw) as CaseData;
  addLinks(data, data.matter.id, data.clioBase);
  return data;
}

export function medicalProviders(data: CaseData): Party[] {
  return data.parties.filter((p) => p.category === "medical");
}

/**
 * What a medical provider may see. Filtering happens here on the server, so attorney notes,
 * legal case facts, insurer correspondence and other providers' bills never reach the browser.
 */
export function providerView(data: CaseData, providerId: number) {
  const shared = <T extends { audience: string }>(items: T[]) => items.filter((i) => i.audience !== "legal");
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
