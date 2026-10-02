"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[12.5px] text-muted">
      {pulledAt && <span>Data pulled from Clio {new Date(pulledAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>}
      <button
        type="button"
        onClick={refresh}
        disabled={state === "running"}
        className="rounded-md border border-line bg-surface px-2.5 py-1 font-medium text-ink hover:border-legal disabled:cursor-wait disabled:opacity-60"
      >
        {state === "running" ? "Pulling from Clio and summarizing…" : "Refresh from Clio"}
      </button>
      {(state === "error" || state === "warning") && (
        <span role="alert" className={`basis-full text-right ${state === "error" ? "text-crit" : "text-warn"}`}>
          {error}
        </span>
      )}
    </div>
  );
}
