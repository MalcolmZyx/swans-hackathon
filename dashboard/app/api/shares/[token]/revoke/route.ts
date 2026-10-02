import { updateShare } from "@/lib/share";

// POST /api/shares/:token/revoke
export async function POST(_req: Request, ctx: RouteContext<"/api/shares/[token]/revoke">) {
  const { token } = await ctx.params;
  const s = await updateShare(token, (x) => {
    x.revokedAt ??= new Date().toISOString();
  });
  return s ? Response.json({ ok: true }) : Response.json({ error: "Not found" }, { status: 404 });
}
