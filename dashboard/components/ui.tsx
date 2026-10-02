import type { Source } from "@/lib/types";
import { Cite } from "./Cite";

// Shared pieces for the lawyer and provider views, on the ROSS design system (DESIGN.md §7).

export function Section({ id, eyebrow, title, intro, children, aside }: { id?: string; eyebrow?: string; title: string; intro?: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section id={id} className="grid min-w-0 scroll-mt-20 content-start gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          {eyebrow && <div className="label">{eyebrow}</div>}
          <h2 className="text-[20px] font-bold leading-tight tracking-[-0.02em]">{title}</h2>
          {intro && <p className="max-w-[68ch] text-[14px] leading-relaxed text-muted">{intro}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`min-w-0 rounded-[16px] border border-line bg-surface p-5 shadow-soft ${className}`}>{children}</div>;
}

export function Stat({ label, value, source, tone, note }: { label: React.ReactNode; value: string; source: Source | null; tone?: string; note?: string }) {
  return (
    <div className="grid content-start gap-1 bg-surface px-5 py-4">
      <div className="label">{label}</div>
      <div className={`text-[26px] font-[750] tracking-[-0.02em] tabular ${tone ?? ""}`}>
        {value} <Cite source={source} />
      </div>
      {note && <div className="text-[12.5px] text-muted">{note}</div>}
    </div>
  );
}

export function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "crit" | "warn" | "ok" | "legal" | "med" }) {
  const tones = {
    neutral: "bg-surface-2 text-ink-2 ring-1 ring-inset ring-line",
    crit: "bg-red-soft text-red",
    warn: "bg-amber-soft text-amber",
    ok: "bg-green-soft text-green",
    legal: "bg-accent-soft text-accent-ink",
    med: "bg-teal-soft text-teal",
  };
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold tabular ${tones[tone]}`}>{children}</span>;
}

export function NoData() {
  return (
    <main className="mx-auto grid max-w-[560px] justify-items-center gap-3 px-6 py-24 text-center">
      <h1 className="text-[22px] font-bold tracking-[-0.02em]">No case data yet</h1>
      <p className="text-muted">
        The dashboards read <code className="rounded bg-surface-2 px-1">dashboard/data/case.json</code>. From the project folder, run{" "}
        <code className="rounded bg-surface-2 px-1">python explore_clio.py</code> and then <code className="rounded bg-surface-2 px-1">python build_dashboard_data.py</code>, or use Refresh from Clio above.
      </p>
    </main>
  );
}
