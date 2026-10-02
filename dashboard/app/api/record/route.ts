import { loadCase } from "@/lib/data";
import { fmtDate, money } from "@/lib/format";

const SECTION: Record<string, string> = { note: "notes", email: "communications", call: "communications", task: "tasks", calendar: "calendar", document: "documents", charge: "activities", expense: "activities" };

// GET /api/record?kind=&id=&field=: the entry a cite points at, for the Source sheet.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id") ?? "";
  const kind = params.get("kind") ?? "";
  const field = params.get("field") ?? "";
  const data = await loadCase();
  if (!data) return Response.json({ error: "No case data" }, { status: 404 });
  const same = (r: string | number) => String(r) === id;
  const clio = (section: string) => `${data.clioBase}/nc/#/matters/${data.matter.id}/${section}`;

  if (kind === "custom_field") {
    const fact = data.facts.find((f) => f.source.field === field);
    if (fact) {
      const value = fact.type === "currency" ? money(fact.value as number) : fact.type === "date" ? fmtDate(String(fact.value)) : fact.type === "checkbox" ? (fact.value ? "Yes" : "No") : String(fact.value);
      return Response.json({ kind: "field", title: fact.name, body: value, clioUrl: clio("") });
    }
  }
  if (kind === "matter") {
    const m = data.matter;
    return Response.json({ kind: "matter", title: `Matter ${m.displayNumber}`, body: `${m.description}\nStage: ${m.stage} · Status: ${m.status} · Opened ${fmtDate(m.openDate)}`, clioUrl: clio("") });
  }
  if (kind === "contact" || kind === "relationship") {
    const party = data.parties.find((p) => same(p.id) || same(p.source.recordId) || same(p.contactSource.recordId));
    if (party) return Response.json({ kind: "contact", title: party.name, body: [party.role, party.email, party.phone, party.address].filter(Boolean).join("\n"), clioUrl: `${data.clioBase}/nc/#/contacts/${party.id}` });
  }
  const event = data.events.find((e) => same(e.source.recordId) && e.kind !== "milestone");
  if (event) {
    return Response.json({
      kind: event.kind,
      title: event.title,
      date: event.date,
      who: event.from ? `${event.from}${event.to ? ` → ${event.to}` : ""}` : null,
      amount: event.amount ?? null,
      status: event.status ?? null,
      body: event.body,
      clioUrl: clio(SECTION[event.kind] ?? ""),
    });
  }
  const cost = data.costs.find((c) => same(c.source.recordId));
  if (cost) return Response.json({ kind: "expense", title: cost.category, date: cost.date, amount: cost.amount, body: cost.description, clioUrl: clio("activities") });
  return Response.json({ error: `This entry (${id}) is not in the synced file.` }, { status: 404 });
}
