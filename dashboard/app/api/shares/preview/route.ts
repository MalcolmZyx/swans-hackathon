import { loadCase, today } from "@/lib/data";
import { DEFAULT_POLICY, doctorView, type Policy } from "@/lib/share";

// POST /api/shares/preview {providerId, policy, note}: exactly what the doctor would see. Not logged.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { providerId?: number; policy?: Policy; note?: string };
  const data = await loadCase();
  if (!data) return Response.json({ error: "No case data" }, { status: 404 });
  try {
    return Response.json(await doctorView(data, Number(body.providerId), body.policy ?? DEFAULT_POLICY, body.note ?? "", today()));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
