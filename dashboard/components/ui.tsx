import type { Source } from "@/lib/types";
import { Cite } from "./Cite";

export function Section({ id, eyebrow, title, intro, children, aside }: { id?: string; eyebrow?: string; title: string; intro?: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section id={id} className="grid min-w-0 scroll-mt-6 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          {eyebrow && <div className="font-mono text-[11.5px] font-medium uppercase tracking-wider text-muted">{eyebrow}</div>}
          <h2 className="font-serif text-[22px] font-semibold leading-tight">{title}</h2>
          {intro && <p className="max-w-[68ch] text-[14px] text-muted">{intro}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`min-w-0 rounded-xl border border-line bg-surface p-5 ${className}`}>{children}</div>;
}

export function Stat({ label, value, source, tone, note }: { label: React.ReactNode; value: string; source: Source | null; tone?: string; note?: string }) {
  return (
    <div className="grid content-start gap-1 bg-surface px-4 py-3.5">
      <div className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted">{label}</div>
      <div className={`text-[22px] font-semibold tabular ${tone ?? ""}`}>{value}</div>
      {note && <div className="text-[12.5px] text-muted">{note}</div>}
      <div>
        <Cite source={source} />
      </div>
    </div>
  );
}

export function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "crit" | "warn" | "ok" | "legal" | "med" }) {
  const tones = {
    neutral: "bg-sunk text-muted",
    crit: "bg-crit-soft text-crit",
    warn: "bg-warn-soft text-warn",
    ok: "bg-sunk text-ok",
    legal: "bg-legal-soft text-legal",
    med: "bg-med-soft text-med",
  };
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-medium ${tones[tone]}`}>{children}</span>;
}

export function NoData() {
  return (
    <main className="mx-auto grid max-w-2xl gap-3 px-6 py-16">
      <h1 className="font-serif text-3xl font-semibold">No case data yet</h1>
      <p className="text-muted">
        The dashboards read <code className="rounded bg-sunk px-1">dashboard/data/case.json</code>. From the project folder, run{" "}
        <code className="rounded bg-sunk px-1">python explore_clio.py</code> and then <code className="rounded bg-sunk px-1">python build_dashboard_data.py</code>, or use Refresh from Clio above.
      </p>
    </main>
  );
}
