"use client";

import { useRef, useState } from "react";

export type TabItem = {
  id: string;
  label: string;
  /** Small count next to the label; "crit" draws the eye to something overdue. */
  badge?: { value: number; tone?: "neutral" | "crit" | "warn"; title?: string };
  content: React.ReactNode;
};

const BADGE = {
  neutral: "bg-line-2 text-muted",
  crit: "bg-red-soft text-red",
  warn: "bg-amber-soft text-amber",
};

/**
 * Dashboard sections as tabs. Every panel stays mounted (inactive ones are hidden) so
 * filters and scroll positions survive switching. The active tab is kept in `?tab=` so
 * links and reloads land on the same tab.
 */
export function Tabs({ tabs, initial, tone }: { tabs: TabItem[]; initial?: string; tone: "legal" | "med" }) {
  const [active, setActive] = useState(() => (tabs.some((t) => t.id === initial) ? initial! : tabs[0].id));
  const root = useRef<HTMLDivElement>(null);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});

  const select = (id: string) => {
    setActive(id);
    const params = new URLSearchParams(window.location.search);
    if (id === tabs[0].id) params.delete("tab");
    else params.set("tab", id);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
    // If the tab bar is stuck to the top, bring the new panel's start into view.
    const top = root.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) window.scrollTo({ top: window.scrollY + top });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === active);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next == null) return;
    e.preventDefault();
    const id = tabs[(next + tabs.length) % tabs.length].id;
    select(id);
    buttons.current[id]?.focus();
  };

  return (
    <div ref={root} className="grid gap-7">
      <div className="sticky top-14 z-30 -mx-8 bg-bg/85 px-8 py-2.5 [backdrop-filter:saturate(1.6)_blur(14px)] max-[760px]:top-[52px] max-[760px]:-mx-4 max-[760px]:px-4">
        <div role="tablist" aria-label="Dashboard sections" onKeyDown={onKeyDown} className="flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-[12px] bg-line-2 p-[3px] ring-1 ring-line">
          {tabs.map((t) => {
            const on = t.id === active;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  buttons.current[t.id] = el;
                }}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={on}
                aria-controls={`panel-${t.id}`}
                tabIndex={on ? 0 : -1}
                onClick={() => select(t.id)}
                className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 py-2 text-[13.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 ${
                  tone === "legal" ? "focus-visible:outline-accent" : "focus-visible:outline-teal"
                } ${on ? "bg-surface text-ink shadow-[0_1px_3px_rgba(14,23,38,.12)]" : "text-muted hover:text-ink"}`}
              >
                {t.label}
                {t.badge && (
                  <span title={t.badge.title} className={`rounded-full px-1.5 py-px text-[11px] font-bold tabular ${BADGE[t.badge.tone ?? "neutral"]}`}>
                    {t.badge.value}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={t.id !== active} className="grid min-w-0 gap-8">
          {t.content}
        </div>
      ))}
    </div>
  );
}
