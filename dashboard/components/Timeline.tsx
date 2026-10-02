"use client";

import { useMemo, useRef, useState } from "react";
import type { CaseEvent, EventKind } from "@/lib/types";
import { fmtDate, money, relative } from "@/lib/format";
import { Cite, SourceDetails } from "./Cite";
import { Sheet } from "./Sheet";

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
            className={`inline-flex h-[32px] items-center gap-2 rounded-full border px-3 text-[13px] font-semibold transition-colors ${
              active.has(k) ? "border-ink bg-ink text-white" : "border-line bg-surface text-muted hover:border-[#d3d7de] hover:text-ink"
            }`}
          >
            <span className="size-2 rounded-full" style={{ background: KINDS[k].color, boxShadow: active.has(k) ? "0 0 0 2px rgba(255,255,255,.9)" : undefined }} />
            {KINDS[k].plural}
            <span className={`tabular ${active.has(k) ? "text-white/60" : "text-faint"}`}>{events.filter((e) => e.kind === k).length}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13.5px]">
        <label className="inline-flex items-center gap-2">
          <input id="tl-milestones" type="checkbox" checked={milestonesOnly} onChange={(e) => setMilestonesOnly(e.target.checked)} className="size-4 accent-[var(--accent)]" />
          Milestones only
        </label>
        {highlightId != null && (
          <label className="inline-flex items-center gap-2">
            <input id="tl-mine" type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} className="size-4 accent-[var(--teal)]" />
            Only {highlightLabel ?? "this provider"}
          </label>
        )}
        <button type="button" onClick={() => setNewestFirst((v) => !v)} className="btn sm">
          {newestFirst ? "Newest first" : "Oldest first"} <span aria-hidden="true">⇅</span>
        </button>
        {todayIndex >= 0 && (
          <button type="button" onClick={() => jumpTo("__today")} className="btn sm">
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
          className="h-[34px] min-w-0 flex-1 basis-48 rounded-[10px] border-[1.5px] border-line bg-surface px-3 outline-none transition-shadow focus:border-accent focus:shadow-[0_0_0_4px_var(--accent-soft)] sm:max-w-xs"
        />
        <span className="text-[12.5px] text-faint tabular">
          {shown.length} of {events.length}
        </span>
      </div>

      {/* Event list */}
      <div ref={listRef} className="relative max-h-[760px] overflow-y-auto rounded-[16px] border border-line bg-surface shadow-soft">
        {shown.length === 0 && (
          <div className="grid justify-items-start gap-2 p-6 text-muted">
            No events match these filters.
            <button type="button" onClick={showAll} className="btn sm">
              Show everything
            </button>
          </div>
        )}
        {groups.map((g) => (
          <section key={g.month + g.rows[0].id}>
            <h3 className="label sticky top-0 z-10 border-b border-line-2 bg-surface-2/90 px-4 py-2 backdrop-blur">
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
                      className={`group grid grid-cols-[64px_20px_minmax(0,1fr)] gap-x-2 border-b border-line-2 px-4 py-3 transition-colors hover:bg-surface-2 ${mine ? "bg-teal-soft/60" : ""}`}
                    >
                      <div className={`pt-0.5 text-[12.5px] tabular ${future ? "font-semibold text-accent" : "text-muted"}`}>{fmtDate(e.date, { month: "short", day: "numeric" })}</div>
                      <div className="flex justify-center pt-1.5">
                        <Marker e={e} />
                      </div>
                      <div className="grid min-w-0 gap-0.5">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <button type="button" onClick={() => setSelected(e)} className="text-left text-[14.5px] font-semibold leading-snug transition-colors hover:text-accent">
                            {e.title}
                          </button>
                          {e.milestone && <span className="rounded-full bg-ink px-2 py-px text-[10.5px] font-bold uppercase tracking-[0.04em] text-white">{e.milestone}</span>}
                          {mine && <span className="rounded-full bg-teal px-2 py-px text-[10.5px] font-bold uppercase tracking-[0.04em] text-white">{highlightLabel ?? "Yours"}</span>}
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
    <div data-id="__today" className="flex items-center gap-3 bg-accent-soft px-4 py-1.5 text-[12px] font-semibold text-accent">
      <span className="h-px flex-1 bg-accent/30" />
      Today, {fmtDate(today)} · everything below is upcoming
      <span className="h-px flex-1 bg-accent/30" />
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
  const parts: React.ReactNode[] = [<span key="k" style={{ color: KINDS[e.kind].color }} className="font-semibold">{KINDS[e.kind].label}</span>];
  if (e.from) parts.push(<span key="ft">{e.from} → {e.to}</span>);
  if (e.kind === "task") {
    const overdue = e.status === "pending" && e.date < today;
    parts.push(
      <span key="s" className={overdue ? "font-semibold text-red" : e.status === "pending" ? "text-amber" : "text-green"}>
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
  return (
    <Sheet chip={KINDS[e.kind].label} title={e.title} onClose={onClose}>
      <div className="grid gap-4 px-5 py-5">
        <div className="grid gap-2">
          <div className="text-[12.5px] font-semibold tabular" style={{ color: KINDS[e.kind].color }}>
            {KINDS[e.kind].label} · {fmtDate(e.date)} · {relative(e.date, today)}
          </div>
          {e.milestone && <span className="w-fit rounded-full bg-ink px-2 py-px text-[11px] font-bold uppercase tracking-[0.04em] text-white">Milestone: {e.milestone}</span>}
          <Meta e={e} today={today} />
        </div>
        <div className="whitespace-pre-wrap text-[15px] leading-[1.65]">{e.body || "No further text on this record."}</div>
        <div className="grid gap-2 rounded-[14px] bg-surface-2 p-4 text-[13px] ring-1 ring-line-2">
          <SourceDetails source={e.source} />
        </div>
      </div>
    </Sheet>
  );
}
