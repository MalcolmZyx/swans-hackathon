import { ask } from "@/lib/ask";
import { loadCase } from "@/lib/data";

// POST /api/ask {q}: an answer from the case file only, with numbered cites, or "Not in the file."
export async function POST(request: Request) {
  const { q } = (await request.json().catch(() => ({}))) as { q?: string };
  if (!q?.trim()) return Response.json({ error: "Ask a question about this case." }, { status: 400 });
  const data = await loadCase();
  if (!data) return Response.json({ error: "No case data" }, { status: 404 });
  try {
    return Response.json(await ask(data, q.slice(0, 500)));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
