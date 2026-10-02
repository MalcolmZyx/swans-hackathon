"use client";

import { useRef } from "react";
import type { CaseEvent } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { Cite } from "./Cite";

const COLORS = ["var(--j1)", "var(--j2)", "var(--j3)", "var(--j4)", "var(--j5)", "var(--j6)", "var(--j7)"];

/**
 * Horizontal milestone timeline: points evenly spaced on one axis, captions alternating
 * above and below, with the year on the opposite side of the axis from its caption.
 * A "Today" marker sits between the last past and first upcoming milestone.
 */
export function CaseJourney({ milestones, today, highlightId }: { milestones: CaseEvent[]; today: string; highlightId?: number }) {
  const scroller = useRef<HTMLDivElement>(null);
  const todayRef = useRef<HTMLLIElement>(null);
  if (!milestones.length) return null;

  // Grid column of the Today marker; milestones after it shift one column right.
  const t = milestones.findIndex((m) => m.date > today);
  const todayIdx = t === -1 ? milestones.length : t;
  const total = milestones.length + 1;
  const colOf = (i: number) => i + 1 + (i >= todayIdx ? 1 : 0);
  const columns = Array.from({ length: total }, (_, c) => (c === todayIdx ? "112px" : "minmax(150px, 1fr)")).join(" ");

  const scrollTo = (where: "start" | "today") => {
    const box = scroller.current;
    if (!box) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let left = 0;
    if (where === "today" && todayRef.current) {
      const marker = todayRef.current.getBoundingClientRect();
      const frame = box.getBoundingClientRect();
      left = box.scrollLeft + marker.left - frame.left - frame.width / 2 + marker.width / 2;
    }
    box.scrollTo({ left, behavior: smooth ? "smooth" : "auto" });
  };

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2 text-[13px]">
        <button type="button" onClick={() => scrollTo("start")} className="rounded-md border border-line bg-surface px-2.5 py-1 hover:border-legal focus-visible:outline-2 focus-visible:outline-legal">
          ← Start
        </button>
        <button type="button" onClick={() => scrollTo("today")} className="rounded-md bg-ink px-2.5 py-1 font-medium text-surface hover:opacity-90 focus-visible:outline-2 focus-visible:outline-legal">
          Jump to today
        </button>
      </div>
      <div ref={scroller} className="overflow-x-auto rounded-xl border border-line bg-surface">
        <ol className="grid min-w-max px-6 py-6" style={{ gridTemplateColumns: columns, gridTemplateRows: "auto 72px auto" }} aria-label="Key moments in order">
          {/* Today marker: a dashed line through all three rows */}
          <li ref={todayRef} className="relative flex justify-center" style={{ gridColumn: todayIdx + 1, gridRow: "1 / 4" }} aria-label={`Today, ${fmtDate(today)}`}>
            <span aria-hidden="true" className="absolute inset-y-0 left-1/2 border-l-2 border-dashed border-legal/60" />
            <span className="relative z-10 h-fit whitespace-nowrap rounded-full bg-legal px-2.5 py-1 text-center text-[11.5px] font-semibold leading-tight text-surface">
              Today
              <span className="block font-mono text-[10.5px] font-normal opacity-90">{fmtDate(today, { month: "short", day: "numeric", year: "numeric" })}</span>
            </span>
          </li>
          <AxisPiece column={todayIdx + 1} future={false} capStart={todayIdx === 0} capEnd={todayIdx === milestones.length} />

          {milestones.map((m, i) => {
            const color = COLORS[i % COLORS.length];
            const above = i % 2 === 0;
            const future = m.date > today;
            const detail = m.title !== m.milestone ? m.title : m.body;
            const col = colOf(i);
            return (
              <li key={m.id} className="contents">
                <div className={`flex flex-col items-center px-2 ${above ? "justify-end" : "justify-start"}`} style={{ gridColumn: col, gridRow: above ? 1 : 3 }}>
                  {!above && <Stem color={color} future={future} />}
                  {!above && <Ring color={color} future={future} />}
                  <div className={`grid max-w-[180px] gap-1 text-center ${above ? "pb-2" : "pt-2"}`}>
                    <b className="text-[13.5px] font-semibold leading-snug">{m.milestone}</b>
                    <span className="font-mono text-[11px] text-muted tabular">
                      {fmtDate(m.date)}
                      {future && " · upcoming"}
                    </span>
                    {highlightId != null && m.providerIds.includes(highlightId) && (
                      <span className="mx-auto w-fit rounded bg-med px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-surface">Your practice</span>
                    )}
                    {detail && <p className="line-clamp-3 text-[12px] leading-snug text-muted">{detail}</p>}
                    <div>
                      <Cite source={m.source} />
                    </div>
                  </div>
                  {above && <Ring color={color} future={future} />}
                  {above && <Stem color={color} future={future} />}
                </div>
                <div className="relative flex items-center justify-center" style={{ gridColumn: col, gridRow: 2 }}>
                  <AxisLine future={future} />
                  {col === 1 && <Cap side="start" />}
                  {col === total && <Cap side="end" />}
                  <span aria-hidden="true" className="z-10 size-3.5 rounded-full border-2" style={{ borderColor: color, background: future ? "var(--surface)" : color }} />
                  <span
                    className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-serif text-[22px] font-bold leading-none tabular ${above ? "top-[calc(50%+14px)]" : "bottom-[calc(50%+14px)]"}`}
                    style={{ color }}
                  >
                    {m.date.slice(0, 4)}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/** This column's piece of the axis; pieces join into one line. Upcoming stretches are dashed. */
function AxisLine({ future }: { future: boolean }) {
  return <span aria-hidden="true" className={`absolute inset-x-0 top-1/2 -translate-y-1/2 border-t-2 ${future ? "border-dashed border-muted" : "border-solid border-ink/70"}`} />;
}

function AxisPiece({ column, future, capStart, capEnd }: { column: number; future: boolean; capStart: boolean; capEnd: boolean }) {
  return (
    <li aria-hidden="true" className="relative" style={{ gridColumn: column, gridRow: 2 }}>
      <AxisLine future={future} />
      {capStart && <Cap side="start" />}
      {capEnd && <Cap side="end" />}
    </li>
  );
}

function Cap({ side }: { side: "start" | "end" }) {
  return (
    <span
      aria-hidden="true"
      className={`absolute top-1/2 size-2 -translate-y-1/2 rounded-full bg-ink ${side === "start" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2"}`}
    />
  );
}

function Ring({ color, future }: { color: string; future: boolean }) {
  return <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full border-2 bg-surface" style={{ borderColor: color, borderStyle: future ? "dashed" : "solid" }} />;
}

function Stem({ color, future }: { color: string; future: boolean }) {
  return <span aria-hidden="true" className="h-6 w-0 shrink-0 border-l-2" style={{ borderColor: color, borderStyle: future ? "dashed" : "solid" }} />;
}
