"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "./Icons";

export function RefreshButton({ pulledAt }: { pulledAt: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "error" | "warning">("idle");
  const [error, setError] = useState("");

  const refresh = async () => {
    setState("running");
    setError("");
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Refresh failed");
      // The data refreshed but the AI summary didn't: say so, but still show the new data.
      setState(body.warning ? "warning" : "idle");
      setError(body.warning ?? "");
      router.refresh();
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const pulled = pulledAt ? new Date(pulledAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : null;

  return (
    <div className="relative flex shrink-0 items-center gap-2">
      {pulled && (
        <span title={`Data pulled from Clio ${pulled}`} className="inline-flex items-center gap-1.5 rounded-full bg-green-soft px-3 py-1 text-[12.5px] font-semibold text-green max-[560px]:hidden">
          <span className="dot bg-green" />
          Read-only from Clio
          <span className="font-medium max-[900px]:hidden">· pulled {pulled}</span>
        </span>
      )}
      <button type="button" onClick={refresh} disabled={state === "running"} className="btn sm disabled:cursor-wait">
        <Icon name="sync" size={14} className={state === "running" ? "animate-spin" : ""} />
        {state === "running" ? "Pulling from Clio and summarizing…" : "Refresh from Clio"}
      </button>
      {(state === "error" || state === "warning") && (
        <span role="alert" className={`absolute right-0 top-[calc(100%+10px)] w-max max-w-[360px] rounded-[9px] px-3 py-2 text-[12.5px] font-medium shadow-lg ${state === "error" ? "bg-red-soft text-red" : "bg-amber-soft text-amber"}`}>
          {error}
        </span>
      )}
    </div>
  );
}
