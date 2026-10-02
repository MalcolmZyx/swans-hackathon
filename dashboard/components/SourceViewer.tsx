"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { PdfCite, Source } from "@/lib/types";
import { fmtDate, money } from "@/lib/format";
import { Icon, KIND } from "./Icons";
import { Sheet } from "./Sheet";

/**
 * The Source sheet (DESIGN.md §6.5): every cite in the product lands here. A record opens with the
 * cited sentence highlighted; a document page opens as the page image with the passage outlined.
 * Several sources step with Prev / Next and the arrow keys.
 */

type Open = (sources: Source | Source[] | null | undefined, index?: number) => void;
const OpenSource = createContext<Open>(() => {});
export const useOpenSource = () => useContext(OpenSource);

const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

type Entry = { source: Source; cite?: PdfCite };

export function SourceViewerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ entries: Entry[]; index: number } | null>(null);
  const [toast, setToast] = useState<{ msg: string; n: number } | null>(null);

  const showToast = useCallback((msg: string) => setToast({ msg, n: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const open = useCallback<Open>(
    (sources, index = 0) => {
      const list = (Array.isArray(sources) ? sources : sources ? [sources] : []).filter(Boolean) as Source[];
      // A record first, then the PDF passages that back it (at most two per record).
      const entries: Entry[] = [];
      const seen = new Set<string>();
      for (const s of list) {
        const k = `${s.kind}:${s.recordId}:${s.field}`;
        if (s.kind !== "document" && !seen.has(k)) {
          seen.add(k);
          entries.push({ source: s });
        }
        for (const c of (s.pdf ?? []).slice(0, s.kind === "document" ? 1 : 2)) {
          const ck = `pdf:${c.doc}:${c.page}:${c.rects[0]?.join(",")}`;
          if (seen.has(ck)) continue;
          seen.add(ck);
          entries.push({ source: s, cite: c });
        }
      }
      if (!entries.length) return showToast("No source recorded for this");
      setState({ entries, index: Math.min(index, entries.length - 1) });
    },
    [showToast],
  );

  return (
    <ToastCtx.Provider value={showToast}>
      <OpenSource.Provider value={open}>
        {children}
        {state && <SourceSheet entries={state.entries} index={state.index} setIndex={(i) => setState({ ...state, index: i })} onClose={() => setState(null)} />}
        {toast && (
          <div key={toast.n} role="status" className="toast fixed bottom-6 left-1/2 z-[80] rounded-full bg-ink px-4 py-2 text-[13.5px] font-medium text-white shadow-lg">
            {toast.msg}
          </div>
        )}
      </OpenSource.Provider>
    </ToastCtx.Provider>
  );
}

function SourceSheet({ entries, index, setIndex, onClose }: { entries: Entry[]; index: number; setIndex: (i: number) => void; onClose: () => void }) {
  const entry = entries[index];
  const many = entries.length > 1;

  useEffect(() => {
    if (!many) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "ArrowLeft" && index > 0) setIndex(index - 1);
      if (e.key === "ArrowRight" && index < entries.length - 1) setIndex(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [many, index, entries.length, setIndex]);

  const title = entry.cite ? entry.cite.title : entry.source.label.replace(/^[^:]+:\s*/, "");
  return (
    <Sheet
      chip="Source"
      title={title}
      onClose={onClose}
      z={60}
      footer={
        many ? (
          <div className="flex items-center justify-between gap-3 border-t border-line-2 px-5 py-3">
            <button type="button" className="btn sm" disabled={index === 0} onClick={() => setIndex(index - 1)}>
              <Icon name="left" size={14} /> Prev
            </button>
            <span className="text-[13px] text-muted tabular">
              {index + 1} of {entries.length}
            </span>
            <button type="button" className="btn sm" disabled={index === entries.length - 1} onClick={() => setIndex(index + 1)}>
              Next <Icon name="right" size={14} />
            </button>
          </div>
        ) : null
      }
    >
      {entry.cite ? <PageSource key={`${entry.cite.doc}-${entry.cite.page}-${index}`} cite={entry.cite} /> : <RecordSource key={`${entry.source.recordId}-${entry.source.field}-${index}`} source={entry.source} />}
    </Sheet>
  );
}

type Record = { kind: string; title: string; date?: string; who?: string | null; amount?: number | null; status?: string | null; body: string; clioUrl?: string; error?: string };

/** Highlight `quote` in `body`, matching across any run of whitespace. */
function Highlighted({ body, quote }: { body: string; quote?: string }) {
  const ref = useRef<HTMLElement>(null);
  const parts = useMemo(() => {
    const q = quote?.trim().replace(/[…]+$/, "");
    if (!q || q.length < 6) return null;
    const pattern = q
      .split(/\s+/)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+");
    const m = new RegExp(pattern, "i").exec(body);
    return m ? [body.slice(0, m.index), m[0], body.slice(m.index + m[0].length)] : null;
  }, [body, quote]);
  useEffect(() => ref.current?.scrollIntoView({ block: "center" }), [parts]);
  if (!parts) return <>{body}</>;
  return (
    <>
      {parts[0]}
      <mark ref={ref}>{parts[1]}</mark>
      {parts[2]}
    </>
  );
}

function RecordSource({ source }: { source: Source }) {
  const [rec, setRec] = useState<Record | null>(null);
  useEffect(() => {
    const qs = new URLSearchParams({ kind: source.kind, id: String(source.recordId), field: source.field });
    fetch(`/api/record?${qs}`)
      .then((r) => r.json())
      .then(setRec)
      .catch((e) => setRec({ kind: "", title: "", body: "", error: String(e) }));
  }, [source]);

  if (!rec) return <Loading text="Opening the entry…" />;
  if (rec.error) return <p className="p-5 text-[14px] text-muted">{rec.error}</p>;
  const k = KIND[rec.kind] ?? KIND.note;
  return (
    <div className="grid gap-4 px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
        <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: k.color }}>
          <Icon name={k.icon} size={15} /> {k.label}
        </span>
        {rec.date && <span className="tabular">· {fmtDate(rec.date)}</span>}
        {rec.who && <span>· {rec.who}</span>}
        {rec.amount != null && <span className="tabular">· {money(rec.amount, true)}</span>}
        {rec.status && <span>· {rec.status === "complete" ? "Done" : "Open"}</span>}
      </div>
      <h3 className="text-[19px] font-bold leading-snug tracking-[-0.01em]">{rec.title}</h3>
      <div className="whitespace-pre-wrap text-[15px] leading-[1.65] text-ink-2">
        <Highlighted body={rec.body} quote={source.quote} />
      </div>
      <div className="flex flex-wrap gap-2 border-t border-dashed border-line pt-4">
        {rec.clioUrl && (
          <a href={rec.clioUrl} target="_blank" rel="noopener noreferrer" className="btn sm">
            Open in Clio <Icon name="external" size={13} />
          </a>
        )}
        {source.pdf?.length ? <span className="self-center text-[12.5px] text-muted">The matching document passage is next.</span> : null}
      </div>
    </div>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 p-6 text-[14px] text-muted">
      <span className="spinner" /> {text}
    </div>
  );
}

// ---------- Document page with the passage highlighted ----------

function PageSource({ cite }: { cite: PdfCite }) {
  const found = cite.rects.length > 0;
  return (
    <div className="grid gap-3 px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
        <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: "var(--k-document)" }}>
          <Icon name="document" size={15} /> Document
        </span>
        <span>· {cite.folder}</span>
        <span className="tabular">
          · page {cite.page} of {cite.pages}
        </span>
      </div>
      <PdfView cite={cite} />
      <p className="text-[12.5px] text-muted">{found ? "Highlighted: the passage this is based on." : "Passage is in the page text below."}</p>
      {cite.text && (
        <div className="grid gap-1.5">
          <div className="label">Page text</div>
          <p className="text-[14px] leading-relaxed text-ink-2">
            <mark>{cite.text}</mark>
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-2 border-t border-dashed border-line pt-4">
        <a href={`/api/documents?id=${cite.doc}#page=${cite.page}`} target="_blank" rel="noopener noreferrer" className="btn sm">
          Open PDF at p.{cite.page} <Icon name="external" size={13} />
        </a>
      </div>
    </div>
  );
}

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

function loadPdfjs() {
  pdfjsPromise ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
    return pdfjs;
  });
  return pdfjsPromise;
}

/** The cited page rendered from the PDF, with one translucent rectangle per highlighted line. */
function PdfView({ cite }: { cite: PdfCite }) {
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [width, setWidth] = useState(0);
  const aspect = cite.size[1] / cite.size[0];

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - 2));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!width) return;
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    let task: RenderTask | null = null;
    loadPdfjs()
      .then((pdfjs) => pdfjs.getDocument({ url: `/api/documents?id=${cite.doc}`, disableAutoFetch: true, disableStream: true, rangeChunkSize: 1 << 18 }).promise)
      .then((d) => {
        doc = d;
        return d.getPage(cite.page);
      })
      .then((page) => {
        if (cancelled || !canvas.current) return;
        const base = page.getViewport({ scale: 1 });
        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: (width / base.width) * dpr });
        canvas.current.width = Math.floor(viewport.width);
        canvas.current.height = Math.floor(viewport.height);
        task = page.render({ canvas: canvas.current, viewport });
        return task.promise;
      })
      .then(() => {
        if (cancelled) return;
        setReady(true);
        frame.current?.querySelector(".hl-rect")?.scrollIntoView({ block: "center" });
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
      task?.cancel();
      doc?.destroy();
    };
  }, [cite.doc, cite.page, width]);

  return (
    <div ref={frame} className="max-h-[52vh] overflow-y-auto rounded-[12px] border border-line bg-surface-2">
      {error ? (
        <p className="p-4 text-[14px] text-muted">Could not open this PDF: {error}</p>
      ) : (
        <div className="relative mx-auto bg-white" style={{ width: width || "100%", height: width ? width * aspect : 400 }}>
          <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
          {!ready && <div className="absolute inset-0 grid place-items-center text-[12.5px] text-faint">Rendering page {cite.page}…</div>}
          {ready &&
            cite.rects.map(([x0, y0, x1, y1], i) => (
              <i key={i} aria-hidden="true" className="hl-rect" style={{ left: `calc(${x0 * 100}% - 2px)`, top: `calc(${y0 * 100}% - 2px)`, width: `calc(${(x1 - x0) * 100}% + 4px)`, height: `calc(${(y1 - y0) * 100}% + 4px)` }} />
            ))}
        </div>
      )}
    </div>
  );
}
