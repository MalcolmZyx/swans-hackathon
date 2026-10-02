import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { generateBrief, saveBrief } from "@/lib/brief";
import { loadCase, today } from "@/lib/data";

const run = promisify(execFile);
const REPO_ROOT = path.resolve(process.cwd(), "..");
const PYTHON = process.env.PYTHON || "python";
// The Clio pull waits out rate limits and, on a first run, downloads every case PDF (~80 MB).
const TIMEOUT_MINUTES = 15;

const lastLine = (text?: string) => text?.trim().split("\n").at(-1)?.trim();

async function runScript(script: string) {
  const opts = {
    cwd: REPO_ROOT,
    timeout: TIMEOUT_MINUTES * 60_000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    // Give Python its own hidden console. Without this it inherits the server's, and when the
    // server was started from a shell that has since closed, Windows fails to start Python
    // (exit code 0xC0000142).
    windowsHide: true,
  };
  try {
    return (await run(PYTHON, [script], opts)).stdout.trim();
  } catch (e) {
    const err = e as { killed?: boolean; code?: number | string; stdout?: string; stderr?: string };
    if (err.killed) throw new Error(`${script} was stopped after ${TIMEOUT_MINUTES} minutes`);
    // A Python traceback ends on stderr; the scripts' own progress and errors go to stdout.
    const detail = lastLine(err.stderr) || lastLine(err.stdout) || `exited with code ${err.code}`;
    throw new Error(`${script}: ${detail}`);
  }
}

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
  let output: string;
  try {
    await runScript("explore_clio.py");
    output = await runScript("build_dashboard_data.py");
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
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
