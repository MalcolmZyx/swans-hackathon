import { isLive, updateShare } from "@/lib/share";

// POST /api/p/:token/follow {follow}: the doctor's opt-in to hear when the case moves.
export async function POST(request: Request, ctx: RouteContext<"/api/p/[token]/follow">) {
  const { token } = await ctx.params;
  const { follow } = (await request.json().catch(() => ({}))) as { follow?: boolean };
  let live = true;
  const s = await updateShare(token, (x) => {
    live = isLive(x);
    if (live) x.following = !!follow;
  });
  if (!s || !live) return Response.json({ error: "This link is no longer active. Contact the firm for a new one." }, { status: 404 });
  return Response.json({ ok: true, following: s.following });
}
