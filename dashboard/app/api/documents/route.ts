import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

const DOCS = path.join(process.cwd(), "data", "documents");

// GET /api/documents?id=<Clio document id>: a case PDF downloaded by explore_clio.py. Supports byte
// ranges, so the source viewer can show one page of a 40 MB scan without fetching the whole file.
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^\d+$/.test(id)) return new Response("Not found", { status: 404 });
  const file = path.join(DOCS, `${id}.pdf`);
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const headers: Record<string, string> = { "Content-Type": "application/pdf", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600" };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  const partial = !!range && !!(range[1] || range[2]);
  let start = 0;
  let end = size - 1;
  if (partial) {
    start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Length"] = String(end - start + 1);
  const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
  return new Response(body, { status: partial ? 206 : 200, headers });
}
