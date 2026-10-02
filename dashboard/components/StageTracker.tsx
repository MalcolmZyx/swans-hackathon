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
      <ol className="flex flex-wrap gap-1.5" aria-label="Case stages">
        {stages.map((s, i) => (
          <li
            key={s}
            aria-current={i === idx ? "step" : undefined}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] ${
              i === idx ? "bg-legal font-semibold text-surface" : i < idx ? "bg-legal-soft text-ink" : "bg-sunk text-muted"
            }`}
          >
            {i < idx && <span aria-hidden="true">✓</span>}
            {s}
          </li>
        ))}
      </ol>
      <p className="text-[14px] text-muted">
        <span className="font-semibold text-ink">Now: {current}.</span> {MEANING[current] ?? ""} <Cite source={source} />
      </p>
    </div>
  );
}
