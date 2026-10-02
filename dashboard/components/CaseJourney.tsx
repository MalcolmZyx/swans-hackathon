"use client";

import { useRef } from "react";
import type { CaseEvent } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { Cite } from "./Cite";

const COLORS = ["var(--j1)", "var(--j2)", "var(--j3)", "var(--j4)", "var(--j5)", "var(--j6)", "var(--j7)"];

/**
 * Milestone timeline. Horizontal (default): points evenly spaced on one axis, captions alternating
 * above and below, with the year on the opposite side of the axis from its caption. Vertical: one
 * point per row down a rail, for a narrow card; it fills the card's height and scrolls.
 * A "Today" marker sits between the past and the upcoming points. Appointments and open tasks
 * that are not milestones are tagged by kind and drawn in that kind's timeline color.
 */
export function CaseJourney({ events, today, highlightId, vertical = false }: { events: CaseEvent[]; today: string; highlightId?: number; vertical?: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const todayRef = useRef<HTMLLIElement>(null);
  if (!events.length) return null;

  // Grid column (or row, when vertical) of the Today marker; events after it shift one place on.
  const t = events.findIndex((m) => m.date > today);
  const todayIdx = t === -1 ? events.length : t;
  const total = events.length + 1;
  const colOf = (i: number) => i + 1 + (i >= todayIdx ? 1 : 0);
  const columns = Array.from({ length: total }, (_, c) => (c === todayIdx ? "112px" : "minmax(150px, 1fr)")).join(" ");

  const scrollTo = (where: "start" | "today") => {
    const box = scroller.current;
    if (!box) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let offset = 0;
    if (where === "today" && todayRef.current) {
      const marker = todayRef.current.getBoundingClientRect();
      const frame = box.getBoundingClientRect();
      offset = vertical
        ? box.scrollTop + marker.top - frame.top - frame.height / 2 + marker.height / 2
        : box.scrollLeft + marker.left - frame.left - frame.width / 2 + marker.width / 2;
    }
    box.scrollTo({ [vertical ? "top" : "left"]: offset, behavior: smooth ? "smooth" : "auto" });
  };

  const controls = (
    <div className="flex flex-wrap items-center justify-end gap-2 text-[13px]">
      <button type="button" onClick={() => scrollTo("start")} className="rounded-md border border-line bg-surface px-2.5 py-1 hover:border-legal focus-visible:outline-2 focus-visible:outline-legal">
        {vertical ? "↑" : "←"} Start
      </button>
      <button type="button" onClick={() => scrollTo("today")} className="rounded-md bg-ink px-2.5 py-1 font-medium text-surface hover:opacity-90 focus-visible:outline-2 focus-visible:outline-legal">
        Jump to today
      </button>
    </div>
  );

  if (vertical) {
    const ROW = "grid grid-cols-[44px_24px_minmax(0,1fr)] gap-x-2";
    const todayRow = (
      <li key="today" ref={todayRef} className={ROW} aria-label={`Today, ${fmtDate(today)}`}>
        <span />
        <div className="relative flex justify-center">
          <Rail future={false} capStart={todayIdx === 0} capEnd={todayIdx === events.length} />
          <span aria-hidden="true" className="relative z-10 mt-1.5 size-3 rotate-45 bg-legal" />
        </div>
        <div className={`flex items-start gap-2 ${todayIdx === events.length ? "" : "pb-6"}`}>
          <span className="whitespace-nowrap rounded-full bg-legal px-2.5 py-1 text-[11.5px] font-semibold leading-tight text-surface">
            Today <span className="font-mono text-[10.5px] font-normal opacity-90">· {fmtDate(today, { month: "short", day: "numeric", year: "numeric" })}</span>
          </span>
          <span aria-hidden="true" className="mt-3 flex-1 border-t-2 border-dashed border-legal/60" />
        </div>
      </li>
    );

    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {controls}
        <div ref={scroller} className="max-h-[70vh] min-h-0 flex-1 overflow-y-auto border-t border-line lg:max-h-none">
          <ol className="grid py-5 pr-1" aria-label="Key moments and what is coming up, in order">
            {todayIdx === 0 && todayRow}
            {events.map((m, i) => {
              const color = m.milestone ? COLORS[i % COLORS.length] : m.kind === "task" ? "var(--k-task)" : "var(--k-calendar)";
              const future = m.date > today;
              const detail = m.milestone && m.title !== m.milestone ? m.title : m.body;
              const year = m.date.slice(0, 4);
              const col = colOf(i);
              return [
                <li key={m.id} className={ROW}>
                  {/* The year only where it changes; the full date is in the caption. */}
                  <span aria-hidden="true" className="text-right font-serif text-[18px] font-bold leading-none tabular" style={{ color }}>
                    {i === 0 || events[i - 1].date.slice(0, 4) !== year ? year : ""}
                  </span>
                  <div className="relative flex justify-center">
                    <Rail future={future} capStart={col === 1} capEnd={col === total} />
                    <span aria-hidden="true" className="relative z-10 mt-0.5 size-3.5 rounded-full border-2" style={{ borderColor: color, background: future ? "var(--surface)" : color }} />
                  </div>
                  <div className={`grid content-start gap-1 ${col === total ? "" : "pb-6"}`}>
                    <div className="flex flex-wrap items-baseline gap-x-2 font-mono text-[11px] tabular">
                      <span className="text-muted">
                        {fmtDate(m.date)}
                        {future && " · upcoming"}
                      </span>
                      {!m.milestone && (
                        <span className="font-semibold uppercase tracking-wider" style={{ color }}>
                          {m.kind === "task" ? "Task" : "Appointment"}
                        </span>
                      )}
                    </div>
                    <b className="text-[14px] font-semibold leading-snug">
                      {m.milestone ?? m.title} <Cite source={m.source} className="ml-0.5" />
                    </b>
                    {highlightId != null && m.providerIds.includes(highlightId) && (
                      <span className="w-fit rounded bg-med px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-surface">Your practice</span>
                    )}
                    {detail && <p className="line-clamp-2 text-[12.5px] leading-snug text-muted">{detail}</p>}
                  </div>
                </li>,
                i + 1 === todayIdx && todayRow,
              ];
            })}
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {controls}
      <div ref={scroller} className="overflow-x-auto rounded-xl border border-line bg-surface">
        <ol className="grid min-w-max px-6 py-6" style={{ gridTemplateColumns: columns, gridTemplateRows: "auto 72px auto" }} aria-label="Key moments and what is coming up, in order">
          {/* Today marker: a dashed line through all three rows */}
          <li ref={todayRef} className="relative flex justify-center" style={{ gridColumn: todayIdx + 1, gridRow: "1 / 4" }} aria-label={`Today, ${fmtDate(today)}`}>
            <span aria-hidden="true" className="absolute inset-y-0 left-1/2 border-l-2 border-dashed border-legal/60" />
            <span className="relative z-10 h-fit whitespace-nowrap rounded-full bg-legal px-2.5 py-1 text-center text-[11.5px] font-semibold leading-tight text-surface">
              Today
              <span className="block font-mono text-[10.5px] font-normal opacity-90">{fmtDate(today, { month: "short", day: "numeric", year: "numeric" })}</span>
            </span>
          </li>
          <AxisPiece column={todayIdx + 1} future={false} capStart={todayIdx === 0} capEnd={todayIdx === events.length} />

          {events.map((m, i) => {
            const color = m.milestone ? COLORS[i % COLORS.length] : m.kind === "task" ? "var(--k-task)" : "var(--k-calendar)";
            const above = i % 2 === 0;
            const future = m.date > today;
            const detail = m.milestone && m.title !== m.milestone ? m.title : m.body;
            const col = colOf(i);
            return (
              <li key={m.id} className="contents">
                <div className={`flex flex-col items-center px-2 ${above ? "justify-end" : "justify-start"}`} style={{ gridColumn: col, gridRow: above ? 1 : 3 }}>
                  {!above && <Stem color={color} future={future} />}
                  {!above && <Ring color={color} future={future} />}
                  <div className={`grid max-w-[180px] gap-1 text-center ${above ? "pb-2" : "pt-2"}`}>
                    {!m.milestone && (
                      <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wider" style={{ color }}>
                        {m.kind === "task" ? "Task" : "Appointment"}
                      </span>
                    )}
                    <b className="line-clamp-3 text-[13.5px] font-semibold leading-snug">{m.milestone ?? m.title}</b>
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

/** Vertical layout: this row's piece of the rail, capped at the first and last rows. */
function Rail({ future, capStart, capEnd }: { future: boolean; capStart: boolean; capEnd: boolean }) {
  return (
    <>
      <span aria-hidden="true" className={`absolute inset-y-0 left-1/2 -translate-x-1/2 border-l-2 ${future ? "border-dashed border-muted" : "border-solid border-ink/70"}`} />
      {capStart && <span aria-hidden="true" className="absolute left-1/2 top-0 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink" />}
      {capEnd && <span aria-hidden="true" className="absolute bottom-0 left-1/2 size-2 -translate-x-1/2 translate-y-1/2 rounded-full bg-ink" />}
    </>
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
