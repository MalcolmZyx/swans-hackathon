import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** "What changed since you looked": the entries (id:etag) each person had on screen last time. */

export const USER_COOKIE = "cl_user";
const FILE = path.join(process.cwd(), "data", "visits.json");

type Visit = { seenAt: string; seenIds: string[] };
type Visits = Record<string, Visit>; // `${userKey}:${matterId}`

async function load(): Promise<Visits> {
  try {
    return JSON.parse(await readFile(FILE, "utf-8")) as Visits;
  } catch {
    return {};
  }
}

export async function lastVisit(userKey: string | undefined, matterId: number): Promise<Visit | null> {
  if (!userKey) return null;
  return (await load())[`${userKey}:${matterId}`] ?? null;
}

export async function markSeen(userKey: string, matterId: number, ids: string[]) {
  const all = await load();
  all[`${userKey}:${matterId}`] = { seenAt: new Date().toISOString(), seenIds: ids };
  await writeFile(FILE, JSON.stringify(all), "utf-8");
}
