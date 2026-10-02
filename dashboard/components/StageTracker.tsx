import type { Source } from "@/lib/types";
import { Cite } from "./Cite";

const MEANING: Record<string, string> = {
  Intake: "The firm is signing the client and collecting the basic facts.",
  Treatment: "The client is still being treated; the firm gathers records and bills as they come in.",
  Demand: "The firm has sent the insurer a settlement demand.",
  Negotiation: "The firm and the insurer are negotiating a settlement.",
  Litigation: "A lawsuit has been filed. Both sides are exchanging evidence and examining the client before trial.",
  Trial: "The case is being tried in court.",
  Disbursement: "The case has resolved and the money is being paid out, including liens and fees.",
  Closed: "The case is finished.",
};

export function StageTracker({ stages, current, source }: { stages: string[]; current: string; source: Source }) {
  const idx = stages.indexOf(current);
  return (
    <div className="grid gap-3">
      <ol className="grid grid-flow-col auto-cols-[minmax(76px,1fr)] gap-1.5 overflow-x-auto pb-0.5" aria-label="Case stages">
        {stages.map((s, i) => (
          <li key={s} aria-current={i === idx ? "step" : undefined} className="grid gap-1.5">
            <span aria-hidden="true" className={`h-1.5 rounded-full ${i === idx ? "bg-accent" : i < idx ? "bg-accent/30" : "bg-line"}`} />
            <span className={`truncate text-[12.5px] ${i === idx ? "font-bold text-ink" : i < idx ? "text-ink-2" : "text-faint"}`}>
              {i < idx && <span aria-hidden="true">✓ </span>}
              {s}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-[14px] text-muted">
        <span className="font-semibold text-ink">Now: {current}.</span> {MEANING[current] ?? ""} <Cite source={source} />
      </p>
    </div>
  );
}
