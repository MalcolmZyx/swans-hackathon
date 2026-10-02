"use client";

import { useState } from "react";
import type { DoctorView } from "@/lib/share";
import { fmtDate, relative } from "@/lib/format";

/**
 * The doctor's patient screen (DESIGN.md §6.9). The same renderer draws the real page at /p/:token
 * and the lawyer's live preview, so the preview is literally what the doctor gets. Zero legal words.
 */

const card = "rounded-[20px] bg-white p-5 shadow-[0_1px_2px_rgba(14,23,38,.05)]";
const label = "text-[11.5px] font-bold uppercase tracking-[0.06em] text-[#6B7485]";

export function DoctorUpdate({ view, token, following: initialFollowing = false, preview = false }: { view: DoctorView; token?: string; following?: boolean; preview?: boolean }) {
  const [following, setFollowing] = useState(initialFollowing);
  const [followError, setFollowError] = useState("");
  const today = view.asOf;
  const { patient, firm, status, treatment, coverage } = view;

  const toggleFollow = async (on: boolean) => {
    setFollowing(on);
    setFollowError("");
    if (preview || !token) return;
    try {
      const res = await fetch(`/api/p/${token}/follow`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ follow: on }) });
      if (!res.ok) throw new Error();
    } catch {
      setFollowing(!on);
      setFollowError("Couldn't save that. Please try again.");
    }
  };

  const asks = status?.asks ?? [];
  const mailBody = [`Patient: ${patient.name}`, patient.dob ? `DOB: ${fmtDate(patient.dob)}` : "", "", ...asks.map((a) => `- ${a.title}: `)].filter((l) => l !== undefined).join("\n");
  const mailto = `mailto:${firm.email}?subject=${encodeURIComponent(`Re: ${patient.name} records`)}&body=${encodeURIComponent(mailBody)}`;

  return (
    <div className="grid gap-3 font-inter text-[15px] leading-normal text-[#0E1726]">
      {/* 1. Header */}
      <div className="grid gap-1 px-1 pb-2 pt-1">
        <div className="flex items-center gap-2 text-[12.5px] text-[#6B7485]">
          <span className="rounded-[5px] bg-black px-1.5 py-px text-[10px] font-extrabold tracking-[0.08em] text-white">ROSS</span>
          From {firm.name} · secure link
        </div>
        <div className="mt-3 text-[13px] font-semibold text-[#6B7485]">About your patient</div>
        <h1 className="text-[32px] font-extrabold leading-tight tracking-[-0.03em]">{patient.name}</h1>
        <div className="text-[14px] text-[#6B7485] tabular">
          {patient.dob && `DOB ${fmtDate(patient.dob)}`}
          {patient.doi && ` · injured ${fmtDate(patient.doi)}`}
        </div>
      </div>

      {/* 2. Note from the firm */}
      {view.note && (
        <div className={`${card} border-l-4 border-[#6E4AE0]`}>
          <p className="whitespace-pre-wrap text-[15px]">{view.note}</p>
          <p className="mt-2 text-[13px] text-[#6B7485]">— {firm.attorney}</p>
        </div>
      )}

      {/* 3. Is this case alive? */}
      {status && (
        <div className={`${card} ${status.open ? "bg-[#ECFAF2]" : "bg-[#F4F5F7]"}`}>
          <div className="flex items-center gap-2.5">
            <span className={`h-3 w-3 rounded-full ${status.open ? "alive-dot bg-[#0A8A4F]" : "bg-[#98A1B1]"}`} />
            <span className={`text-[22px] font-bold tracking-[-0.02em] ${status.open ? "text-[#0A8A4F]" : "text-[#6B7485]"}`}>{status.open ? "The case is active" : "The case is closed"}</span>
          </div>
          {status.lastMoved && (
            <p className="mt-1 text-[14px] text-[#364152] tabular">
              Last moved {fmtDate(status.lastMoved)} · {relative(status.lastMoved, today)}
            </p>
          )}
          <div className="mt-3 flex gap-1" aria-label={`Progress: step ${status.stageIndex + 1} of ${status.stageCount}`} role="img">
            {Array.from({ length: status.stageCount }, (_, i) => (
              <span key={i} className="h-1.5 flex-1 rounded-full" style={{ background: i < status.stageIndex ? "#A7E3C4" : i === status.stageIndex ? "#0A8A4F" : "#E3E6EB" }} />
            ))}
          </div>
          {view.update && <p className="mt-3 text-[15px] text-[#364152]">{view.update}</p>}
        </div>
      )}
      {!status && view.update && (
        <div className={card}>
          <p className="text-[15px] text-[#364152]">{view.update}</p>
        </div>
      )}

      {/* 4. We need from you */}
      {status && (
        <div className={card}>
          <div className={label}>We need from you</div>
          {asks.length === 0 ? (
            <p className="mt-2 text-[15px] text-[#364152]">Nothing right now. Thank you.</p>
          ) : (
            <ul className="mt-2 grid gap-3">
              {asks.map((a, i) => (
                <li key={i} className="grid gap-1 border-b border-[#EEF0F3] pb-3 last:border-0 last:pb-0">
                  <b className="text-[17px] font-bold leading-snug">{a.title}</b>
                  {a.detail && <span className="text-[14px] text-[#364152]">{a.detail}</span>}
                  <span className={`w-fit rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold tabular ${a.overdue ? "bg-[#FFF5E8] text-[#C2620A]" : "bg-[#EEF2FF] text-[#1C3FC4]"}`}>
                    {a.overdue ? `Past due · was needed by ${fmtDate(a.due, { month: "short", day: "numeric" })}` : `Needed by ${fmtDate(a.due, { month: "short", day: "numeric" })} · ${relative(a.due, today)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {preview ? (
            <span className="mt-4 flex h-[50px] w-full items-center justify-center rounded-[13px] bg-[#2B59F5] text-[15px] font-semibold text-white">Reply to {firm.name}</span>
          ) : (
            <a href={mailto} className="mt-4 flex h-[50px] w-full items-center justify-center rounded-[13px] bg-[#2B59F5] text-[15px] font-semibold text-white hover:bg-[#1C3FC4] active:translate-y-px">
              Reply to {firm.name}
            </a>
          )}
        </div>
      )}

      {/* 5. Insurance (only if shared) */}
      {coverage && coverage.limit != null && (
        <div className={card}>
          <div className={label}>Insurance behind the case</div>
          <p className="mt-2 text-[14px] font-semibold text-[#0A8A4F]">{coverage.confirmed ? "Insurance confirmed" : "Insurance not yet confirmed"}</p>
          <p className="text-[28px] font-extrabold tracking-[-0.02em] tabular">${coverage.limit.toLocaleString("en-US")}</p>
          <p className="text-[13.5px] text-[#6B7485]">
            liability limit{coverage.confirmedOn ? ` · Confirmed in writing ${fmtDate(coverage.confirmedOn)}` : ""}
          </p>
        </div>
      )}

      {/* 6. Still treating? */}
      {treatment && (
        <div className={card}>
          <div className={label}>Is {patient.firstName} still treating?</div>
          {treatment.ongoing && treatment.kinds.length ? (
            <p className="mt-2 text-[17px] font-bold text-[#0A8A4F]">Yes · {treatment.kinds.join(" and ")}</p>
          ) : treatment.ongoing ? (
            <p className="mt-2 text-[17px] font-bold text-[#0A8A4F]">Yes · no visits scheduled</p>
          ) : (
            <p className="mt-2 text-[17px] font-bold text-[#364152]">No · treatment complete</p>
          )}
          {treatment.nextVisit && (
            <p className="text-[14px] text-[#6B7485] tabular">
              Next visit {fmtDate(treatment.nextVisit)} · {relative(treatment.nextVisit, today)}
            </p>
          )}
          {treatment.regions.length > 0 && <p className="mt-2 text-[14px] text-[#364152]">Injuries on file: {treatment.regions.join(" · ").toLowerCase()}</p>}
        </div>
      )}

      {/* 7. Follow */}
      <div className={`${card} flex items-center justify-between gap-4`}>
        <div>
          <div className="text-[15px] font-semibold">Tell me when the case moves</div>
          <div className="text-[13px] text-[#6B7485]">{following ? "On · we'll let you know" : "Only when the stage changes or the firm needs something"}</div>
          {followError && <div className="text-[13px] text-[#C2620A]">{followError}</div>}
        </div>
        <label className="switch lg">
          <input type="checkbox" role="switch" checked={following} onChange={(e) => toggleFollow(e.target.checked)} aria-label="Tell me when the case moves" />
          <span />
        </label>
      </div>

      {/* 8. Footer */}
      <p className="px-1 pb-2 pt-1 text-center text-[12px] text-[#98A1B1]">
        Shared by {firm.attorney} · read-only · this link expires {fmtDate(view.expiresAt)}
      </p>
    </div>
  );
}
