import { loadCase, today } from "@/lib/data";
import { createShare, DEFAULT_POLICY, expiresAt, isLive, loadShares, shareableProviders, type Policy } from "@/lib/share";

// GET /api/shares: links sent from this matter (with opens), the providers, the default policy.
export async function GET() {
  const data = await loadCase();
  if (!data) return Response.json({ error: "No case data" }, { status: 404 });
  const shares = (await loadShares())
    .filter((s) => s.matterId === data.matter.id)
    .map((s) => ({ token: s.token, providerId: s.providerId, providerName: s.providerName, createdAt: s.createdAt, expiresAt: expiresAt(s), live: isLive(s), revokedAt: s.revokedAt, views: s.views.length, lastView: s.views.at(-1)?.at ?? null, following: s.following }));
  return Response.json({ shares, providers: shareableProviders(data), defaultPolicy: DEFAULT_POLICY, today: today() });
}

// POST /api/shares {providerId, policy, note}: a new secure link.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { providerId?: number; policy?: Policy; note?: string };
  const data = await loadCase();
  if (!data) return Response.json({ error: "No case data" }, { status: 404 });
  try {
    const share = await createShare(data, Number(body.providerId), body.policy ?? DEFAULT_POLICY, body.note ?? "");
    return Response.json({ token: share.token, url: `/p/${share.token}`, expiresAt: expiresAt(share) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
