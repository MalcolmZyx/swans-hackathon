"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CaseEvent, EventKind } from "@/lib/types";
import { fmtDate, money, relative } from "@/lib/format";
import { Cite, SourceDetails } from "./Cite";

const KINDS: Record<EventKind, { label: string; plural: string; color: string }> = {
  milestone: { label: "Milestone", plural: "Milestones", color: "var(--k-milestone)" },
  note: { label: "Note", plural: "Notes", color: "var(--k-note)" },
  email: { label: "Email", plural: "Emails", color: "var(--k-email)" },
  call: { label: "Call", plural: "Calls", color: "var(--k-call)" },
  calendar: { label: "Appointment", plural: "Appointments", color: "var(--k-calendar)" },
  task: { label: "Task", plural: "Tasks", color: "var(--k-task)" },
  document: { label: "Document", plural: "Documents", color: "var(--k-document)" },
  charge: { label: "Medical bill", plural: "Medical bills", color: "var(--k-charge)" },
};

type Props = {
  events: CaseEvent[];
  today: string;
  highlightId?: number;
  highlightLabel?: string;
};

export function Timeline({ events, today, highlightId, highlightLabel }: Props) {
  const kinds = useMemo(() => (Object.keys(KINDS) as EventKind[]).filter((k) => events.some((e) => e.kind === k)), [events]);
  const [active, setActive] = useState<Set<EventKind>>(() => new Set(kinds));
  const [milestonesOnly, setMilestonesOnly] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [newestFirst, setNewestFirst] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<CaseEvent | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = events.filter(
      (e) =>
        active.has(e.kind) &&
        (!milestonesOnly || e.milestone) &&
        (!onlyMine || (highlightId != null && e.providerIds.includes(highlightId))) &&
        (!needle || `${e.title} ${e.body} ${e.from ?? ""} ${e.to ?? ""}`.toLowerCase().includes(needle)),
    );
    return newestFirst ? rows.slice().reverse() : rows;
  }, [events, active, milestonesOnly, onlyMine, highlightId, q, newestFirst]);

  // Group rows by month, and mark where "today" falls.
  const groups = useMemo(() => {
    const out: { month: string; rows: CaseEvent[] }[] = [];
    for (const e of shown) {
      const month = fmtDate(e.date, { month: "long", year: "numeric" });
      if (out.at(-1)?.month !== month) out.push({ month, rows: [] });
      out.at(-1)!.rows.push(e);
    }
    return out;
  }, [shown]);
  const todayIndex = newestFirst ? shown.findIndex((e) => e.date <= today) : shown.findIndex((e) => e.date > today);

  const toggleKind = (k: EventKind) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const jumpTo = (id: string) => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-id="${id}"]`);
    if (el && listRef.current) listRef.current.scrollTo({ top: el.offsetTop - listRef.current.offsetTop - 60, behavior: "smooth" });
  };

  const showAll = () => {
    setActive(new Set(kinds));
    setMilestonesOnly(false);
    setOnlyMine(false);
    setQ("");
  };

  return (
    <div className="grid gap-5">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {kinds.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={active.has(k)}
            onClick={() => toggleKind(k)}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-medium ${
              active.has(k) ? "border-line bg-surface text-ink" : "border-transparent bg-transparent text-muted line-through decoration-muted/50"
            }`}
          >
            <span className="size-2.5 rounded-full" style={{ background: KINDS[k].color, opacity: active.has(k) ? 1 : 0.35 }} />
            {KINDS[k].plural}
            <span className="text-muted tabular">{events.filter((e) => e.kind === k).length}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13.5px]">
        <label className="inline-flex items-center gap-2">
          <input id="tl-milestones" type="checkbox" checked={milestonesOnly} onChange={(e) => setMilestonesOnly(e.target.checked)} className="accent-[var(--legal)]" />
          Milestones only
        </label>
        {highlightId != null && (
          <label className="inline-flex items-center gap-2">
            <input id="tl-mine" type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} className="accent-[var(--med)]" />
            Only {highlightLabel ?? "this provider"}
          </label>
        )}
        <button type="button" onClick={() => setNewestFirst((v) => !v)} className="rounded-md border border-line bg-surface px-2.5 py-1 hover:border-legal">
          {newestFirst ? "Newest first" : "Oldest first"} <span aria-hidden="true">⇅</span>
        </button>
        {todayIndex >= 0 && (
          <button type="button" onClick={() => jumpTo("__today")} className="rounded-md border border-line bg-surface px-2.5 py-1 hover:border-legal">
            Jump to today
          </button>
        )}
        <input
          id="tl-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the timeline"
          aria-label="Search the timeline"
          className="min-w-0 flex-1 basis-48 rounded-md border border-line bg-surface px-3 py-1.5 sm:max-w-xs"
        />
        <span className="text-muted tabular">
          {shown.length} of {events.length}
        </span>
      </div>

      {/* Event list */}
      <div ref={listRef} className="relative max-h-[760px] overflow-y-auto rounded-xl border border-line bg-surface">
        {shown.length === 0 && (
          <div className="grid justify-items-start gap-2 p-6 text-muted">
            No events match these filters.
            <button type="button" onClick={showAll} className="rounded-md border border-line px-2.5 py-1 text-ink hover:border-legal">
              Show everything
            </button>
          </div>
        )}
        {groups.map((g) => (
          <section key={g.month + g.rows[0].id}>
            <h3 className="sticky top-0 z-10 border-b border-line bg-sunk/95 px-4 py-1.5 font-mono text-[11.5px] font-medium uppercase tracking-wider text-muted backdrop-blur">
              {g.month}
            </h3>
            <ol>
              {g.rows.map((e) => {
                const i = shown.indexOf(e);
                const mine = highlightId != null && e.providerIds.includes(highlightId);
                const future = e.date > today;
                return (
                  <li key={e.id} data-id={e.id}>
                    {i === todayIndex && <TodayDivider today={today} />}
                    <div
                      className={`group grid grid-cols-[78px_20px_minmax(0,1fr)] gap-x-2 border-b border-line px-4 py-3 hover:bg-sunk/60 ${mine ? "bg-med-soft/60" : ""}`}
                    >
                      <div className={`pt-0.5 font-mono text-[12px] tabular ${future ? "text-legal" : "text-muted"}`}>{fmtDate(e.date, { month: "short", day: "numeric" })}</div>
                      <div className="flex justify-center pt-1.5">
                        <Marker e={e} />
                      </div>
                      <div className="grid min-w-0 gap-0.5">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <button type="button" onClick={() => setSelected(e)} className="text-left font-medium leading-snug hover:text-legal hover:underline focus-visible:outline-2 focus-visible:outline-legal">
                            {e.title}
                          </button>
                          {e.milestone && <span className="rounded bg-ink px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide text-surface">{e.milestone}</span>}
                          {mine && <span className="rounded bg-med px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide text-surface">{highlightLabel ?? "Yours"}</span>}
                        </div>
                        <Meta e={e} today={today} />
                        {e.body && <p className="line-clamp-2 text-[13.5px] text-muted">{e.body}</p>}
                        <div className="pt-1">
                          <Cite source={e.source} />
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
        {todayIndex < 0 && shown.length > 0 && !newestFirst && <TodayDivider today={today} />}
      </div>

      {selected && <EventDrawer e={selected} today={today} onClose={() => setSelected(null)} />}
    </div>
  );
}

function TodayDivider({ today }: { today: string }) {
  return (
    <div data-id="__today" className="flex items-center gap-3 bg-legal-soft px-4 py-1.5 text-[12px] font-semibold text-legal">
      <span className="h-px flex-1 bg-legal/40" />
      Today, {fmtDate(today)} · everything below is upcoming
      <span className="h-px flex-1 bg-legal/40" />
    </div>
  );
}

function Marker({ e }: { e: CaseEvent }) {
  const color = KINDS[e.kind].color;
  if (e.milestone) return <span aria-hidden="true" className="size-3 rotate-45 rounded-[2px]" style={{ background: color, outline: "2px solid var(--surface)" }} />;
  if (e.kind === "task" && e.status === "pending") return <span aria-hidden="true" className="size-3 rounded-full border-2 bg-surface" style={{ borderColor: color }} />;
  return <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: color }} />;
}

function Meta({ e, today }: { e: CaseEvent; today: string }) {
  const parts: React.ReactNode[] = [<span key="k" style={{ color: KINDS[e.kind].color }} className="font-medium">{KINDS[e.kind].label}</span>];
  if (e.from) parts.push(<span key="ft">{e.from} → {e.to}</span>);
  if (e.kind === "task") {
    const overdue = e.status === "pending" && e.date < today;
    parts.push(
      <span key="s" className={overdue ? "font-semibold text-crit" : e.status === "pending" ? "text-warn" : "text-ok"}>
        {overdue ? `Overdue (due ${relative(e.date, today)})` : e.status === "pending" ? `Due ${relative(e.date, today)}` : "Done"}
      </span>,
    );
  }
  if (e.amount != null) parts.push(<span key="a" className="tabular">{money(e.amount)}</span>);
  if (e.folder) parts.push(<span key="f">{e.folder}</span>);
  return (
    <div className="flex flex-wrap gap-x-2 text-[12.5px] text-muted">
      {parts.map((p, i) => (
        <span key={i} className="inline-flex gap-2">
          {i > 0 && <span aria-hidden="true">·</span>}
          {p}
        </span>
      ))}
    </div>
  );
}

function EventDrawer({ e, today, onClose }: { e: CaseEvent; today: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close details" className="absolute inset-0 bg-ink/30" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-label={e.title} className="relative flex h-full w-full max-w-[540px] flex-col gap-4 overflow-y-auto bg-surface p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-1">
            <div className="font-mono text-[11.5px] uppercase tracking-wider" style={{ color: KINDS[e.kind].color }}>
              {KINDS[e.kind].label} · {fmtDate(e.date)} · {relative(e.date, today)}
            </div>
            <h2 className="font-serif text-2xl font-semibold leading-tight">{e.title}</h2>
            {e.milestone && <span className="w-fit rounded bg-ink px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide text-surface">Milestone: {e.milestone}</span>}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="rounded-md border border-line px-2.5 py-1 text-[13px] hover:border-legal">
            Close
          </button>
        </div>
        <Meta e={e} today={today} />
        <div className="whitespace-pre-wrap text-[14.5px] leading-relaxed">{e.body || "No further text on this record."}</div>
        <div className="mt-auto grid gap-2 rounded-lg border border-line bg-sunk p-4 text-[13px]">
          <SourceDetails source={e.source} />
        </div>
      </aside>
    </div>
  );
}
