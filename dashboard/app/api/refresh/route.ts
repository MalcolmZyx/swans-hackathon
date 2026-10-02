import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { generateBrief, saveBrief } from "@/lib/brief";
import { loadCase, today } from "@/lib/data";

const run = promisify(execFile);
const REPO_ROOT = path.resolve(process.cwd(), "..");
const PYTHON = process.env.PYTHON || "python";

// Re-pull from Clio, rebuild data/case.json, then have Gemini brief the lawyer on the case and
// on what changed since the previous pull. Runs the project's Python scripts, so it is only
// allowed when the app is opened on this machine.
export async function POST(request: Request) {
  const host = new URL(request.url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    return Response.json({ error: "Refresh only runs on the local machine." }, { status: 403 });
  }
  // Stand-in for sign-in: the data on screen before this refresh is what the user saw last visit.
  const before = await loadCase();
  const opts = { cwd: REPO_ROOT, timeout: 5 * 60_000, env: { ...process.env, PYTHONIOENCODING: "utf-8" } };
  let output: string;
  try {
    await run(PYTHON, ["explore_clio.py"], opts);
    output = (await run(PYTHON, ["build_dashboard_data.py"], opts)).stdout.trim();
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    const detail = (err.stderr || err.message).trim().split("\n").at(-1);
    return Response.json({ error: `Refresh failed: ${detail}` }, { status: 500 });
  }

  // The Clio data is already refreshed, so a failed summary is reported but doesn't fail the refresh.
  try {
    const after = await loadCase();
    if (!after) throw new Error("data/case.json is missing after the rebuild");
    const brief = await generateBrief(before, after, today());
    await saveBrief(brief);
    return Response.json({ ok: true, output, changes: brief.changeCount });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: true, output, warning: `Clio data refreshed, but the AI summary failed: ${detail}` });
  }
}
