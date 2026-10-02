"use client";

import { useEffect, useRef, useState } from "react";
import type { Source } from "@/lib/types";

/** Small "source" chip; opens a card saying exactly which Clio record and field a value came from. */
export function Cite({ source, className = "" }: { source: Source | null | undefined; className?: string }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pos) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e.type === "mousedown" && (card.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node))) return;
      setPos(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [pos]);

  if (!source) return null;

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pos) return setPos(null);
    const r = btn.current!.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 16);
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left - 20, window.innerWidth - width - 8)) });
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={toggle}
        aria-expanded={!!pos}
        aria-label={`Source: ${source.label}`}
        className={`inline-flex items-center gap-1 align-middle rounded border border-line bg-surface px-1.5 py-px font-mono text-[10.5px] font-medium leading-4 text-muted hover:border-legal hover:text-legal focus-visible:outline-2 focus-visible:outline-legal ${className}`}
      >
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M2 1.5h4.5L8 3v5.5H2z" />
          <path d="M3.5 4.5h3M3.5 6.5h3" />
        </svg>
        source
      </button>
      {pos && (
        <div
          ref={card}
          role="dialog"
          aria-label="Data source"
          onClick={(e) => e.stopPropagation()}
          style={{ top: pos.top, left: pos.left, width: Math.min(320, typeof window === "undefined" ? 320 : window.innerWidth - 16) }}
          className="fixed z-50 grid gap-2 rounded-lg border border-line bg-surface p-3.5 text-left text-[13px] font-normal normal-case tracking-normal text-ink shadow-lg"
        >
          <SourceDetails source={source} />
        </div>
      )}
    </>
  );
}

export function SourceDetails({ source }: { source: Source }) {
  return (
    <>
      <div className="font-mono text-[10.5px] uppercase tracking-wider text-muted">From Clio</div>
      <div className="font-semibold leading-snug">{source.label}</div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]">
        <dt className="text-muted">Field</dt>
        <dd className="font-mono break-words">{source.field}</dd>
        <dt className="text-muted">Record ID</dt>
        <dd className="font-mono tabular">{source.recordId}</dd>
        <dt className="text-muted">API</dt>
        <dd className="font-mono break-all">{source.api}</dd>
      </dl>
      {source.href && (
        <a
          href={source.href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex w-fit items-center gap-1 rounded-md bg-legal px-2.5 py-1 text-[12.5px] font-medium text-surface hover:opacity-90"
        >
          Open in Clio <span aria-hidden="true">↗</span>
        </a>
      )}
    </>
  );
}
