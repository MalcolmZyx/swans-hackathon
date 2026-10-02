"use client";

import type { Source } from "@/lib/types";
import { useOpenSource } from "./SourceViewer";

/** Cite chip (DESIGN.md §7.4): an inline superscript number that opens the Source sheet. */
export function Cite({ source, sources, n, className = "" }: { source?: Source | null; sources?: (Source | null | undefined)[]; n?: number; className?: string }) {
  const open = useOpenSource();
  const list = (sources ?? [source]).filter(Boolean) as Source[];
  if (!list.length) return null;
  const label = n != null ? `Source ${n}` : `Source: ${list[0].label}`;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        open(list);
      }}
      title={list[0].label}
      aria-label={label}
      className={`cite ${className}`}
    >
      {n ?? "↗"}
    </button>
  );
}

/** Any element that opens its sources in the Source sheet. */
export function SourceButton({ sources, className = "", children, label }: { sources: (Source | null | undefined)[]; className?: string; children: React.ReactNode; label?: string }) {
  const open = useOpenSource();
  return (
    <button type="button" className={className} aria-label={label} onClick={() => open(sources.filter(Boolean) as Source[])}>
      {children}
    </button>
  );
}

/** Where a record came from, with a button to open it in the Source sheet. */
export function SourceDetails({ source }: { source: Source }) {
  const open = useOpenSource();
  const cite = source.pdf?.[0];
  return (
    <>
      <div className="label">Source</div>
      <div className="font-semibold leading-snug">{cite ? `${cite.title}, page ${cite.page}` : source.label}</div>
      <button type="button" onClick={() => open(source)} className="btn sm mt-1 w-fit">
        {cite ? "View page" : "View source"}
      </button>
    </>
  );
}
