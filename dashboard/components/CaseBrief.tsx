import type { Brief, BriefPoint, Source } from "@/lib/types";
import { Cite } from "./Cite";
import { Card } from "./ui";

const stamp = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

function Points({ points, sources }: { points: BriefPoint[]; sources: Map<string, Source> }) {
  return (
    <ul className="grid gap-3 text-[15px]">
      {points.map((p, i) => (
        <li key={i}>
          {p.label && <b>{p.label}:</b>} {p.text}{" "}
          {[...new Set(p.sources)].map((id) => (
            <Cite key={id} source={sources.get(id)} className="mr-1" />
          ))}
        </li>
      ))}
    </ul>
  );
}

/** Gemini's summary of the case and of what changed in Clio since the user's last visit (their previous refresh). */
export function CaseBrief({ brief, sources }: { brief: Brief; sources: Map<string, Source> }) {
  return (
    <Card className="grid content-start gap-5">
      <div className="grid gap-1">
        <div className="font-mono text-[11.5px] font-medium uppercase tracking-wider text-legal">AI case brief</div>
        <h2 className="font-serif text-[22px] font-semibold">The case in one minute</h2>
        <p className="text-[15.5px] font-medium">{brief.headline}</p>
      </div>

      <div className="grid gap-2.5 rounded-lg border border-legal bg-legal-soft p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="font-semibold">What&apos;s new since your last visit</h3>
          {brief.since && (
            <span className="text-[12.5px] text-muted">
              {brief.changeCount} {brief.changeCount === 1 ? "change" : "changes"} since {stamp(brief.since)}
            </span>
          )}
        </div>
        {!brief.since ? (
          <p className="text-[14px] text-muted">This is your first visit, so there is nothing to compare against yet. Changes made in Clio will show here after your next refresh.</p>
        ) : brief.whatsNew.length ? (
          <Points points={brief.whatsNew} sources={sources} />
        ) : (
          <p className="text-[14px] text-muted">Nothing has changed in Clio since then.</p>
        )}
      </div>

      <div className="grid gap-2.5">
        <h3 className="font-mono text-[11.5px] font-medium uppercase tracking-wider text-muted">The case so far</h3>
        <Points points={brief.overview} sources={sources} />
      </div>

      <p className="text-[12px] text-muted">
        Written by {brief.model} from the Clio data pulled {stamp(brief.pulledAt)}. AI summaries can get details wrong, so check the sources.
      </p>
    </Card>
  );
}
