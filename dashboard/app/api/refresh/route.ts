import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const REPO_ROOT = path.resolve(process.cwd(), "..");
const PYTHON = process.env.PYTHON || "python";

// Re-pull from Clio and rebuild data/case.json. Runs the project's Python scripts, so it is
// only allowed when the app is opened on this machine.
export async function POST(request: Request) {
  const host = new URL(request.url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    return Response.json({ error: "Refresh only runs on the local machine." }, { status: 403 });
  }
  const opts = { cwd: REPO_ROOT, timeout: 5 * 60_000, env: { ...process.env, PYTHONIOENCODING: "utf-8" } };
  try {
    await run(PYTHON, ["explore_clio.py"], opts);
    const { stdout } = await run(PYTHON, ["build_dashboard_data.py"], opts);
    return Response.json({ ok: true, output: stdout.trim() });
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    const detail = (err.stderr || err.message).trim().split("\n").at(-1);
    return Response.json({ error: `Refresh failed: ${detail}` }, { status: 500 });
  }
}
