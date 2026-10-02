"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "./Icons";
import { useToast } from "./SourceViewer";

/** Sticky translucent top bar (DESIGN.md §6.1): the ROSS wordmark and the read-only pill. */
export function TopBar({ pulledAt, source = "Clio Manage (live)" }: { pulledAt: string | null; source?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const synced = pulledAt ? new Date(pulledAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null;

  const sync = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Sync failed");
      toast(body.warning ? "Synced from Clio (summary unavailable)" : "Synced from Clio");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-white/80 [backdrop-filter:saturate(1.6)_blur(14px)]">
        <div className="mx-auto flex h-14 max-w-[1100px] items-center justify-between gap-3 px-8 max-[760px]:h-[52px] max-[760px]:px-4">
          <a href="/" className="text-[18px] font-extrabold tracking-[0.08em] text-black" aria-label="ROSS">
            ROSS
          </a>
          <div className="flex items-center gap-2">
            <span title={`Data source: ${source}`} className="inline-flex items-center gap-1.5 rounded-full bg-green-soft px-3 py-1 text-[12.5px] font-semibold text-green">
              <span className="dot bg-green" />
              Read-only from Clio
              {synced && <span className="font-medium max-[760px]:hidden">· synced {synced}</span>}
            </span>
            <button type="button" onClick={sync} disabled={busy} className="btn sm" aria-label="Sync from Clio" title="Re-read the matter from Clio">
              <Icon name="sync" size={14} className={busy ? "animate-spin" : ""} />
              <span className="max-[760px]:hidden">{busy ? "Reading Clio…" : "Sync"}</span>
            </button>
          </div>
        </div>
      </header>
      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 bg-red-soft px-8 py-2.5 text-[13.5px] text-red max-[760px]:px-4">
          <span>Clio sync failed: {error}</span>
          <button type="button" className="btn sm" onClick={() => setError("")}>
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}
