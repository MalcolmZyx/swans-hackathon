import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { loadCase } from "@/lib/data";
import { seenIds } from "@/lib/digest";
import { markSeen, USER_COOKIE } from "@/lib/visits";

// POST /api/seen: mark every current entry as seen for this person (sent when the page hides).
export async function POST() {
  const data = await loadCase();
  if (!data) return Response.json({ error: "No case data" }, { status: 404 });
  const jar = await cookies();
  let user = jar.get(USER_COOKIE)?.value;
  if (!user) {
    user = randomBytes(12).toString("base64url");
    jar.set(USER_COOKIE, user, { maxAge: 365 * 864e2, sameSite: "lax", httpOnly: true, path: "/" });
  }
  await markSeen(user, data.matter.id, seenIds(data));
  return Response.json({ ok: true });
}
