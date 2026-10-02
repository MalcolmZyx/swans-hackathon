import Link from "next/link";
import { RefreshButton } from "./RefreshButton";

/** Top bar for the lawyer and provider views: same sticky translucent bar as the Case screen (DESIGN.md §6.1). */
export function AppHeader({ active, pulledAt }: { active?: "lawyer" | "provider"; pulledAt: string | null }) {
  const tab = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`rounded-[9px] px-3 py-1.5 text-[13.5px] font-semibold transition-colors ${on ? "bg-surface text-ink shadow-[0_1px_3px_rgba(14,23,38,.12)]" : "text-muted hover:text-ink"}`}
    >
      {label}
    </Link>
  );
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/80 [backdrop-filter:saturate(1.6)_blur(14px)]">
      <div className="mx-auto flex h-14 max-w-[1100px] items-center justify-between gap-3 px-8 max-[760px]:h-[52px] max-[760px]:px-4">
        <div className="flex min-w-0 items-center gap-5 max-[760px]:gap-3">
          <Link href="/" className="text-[18px] font-extrabold tracking-[0.08em] text-black max-[760px]:hidden" aria-label="ROSS">
            ROSS
          </Link>
          <nav className="flex gap-0.5 rounded-[11px] bg-surface-2 p-[3px] ring-1 ring-line" aria-label="Dashboards">
            {tab("/lawyer", "Lawyer view", active === "lawyer")}
            {tab("/provider", "Provider view", active === "provider")}
          </nav>
        </div>
        <RefreshButton pulledAt={pulledAt} />
      </div>
    </header>
  );
}
