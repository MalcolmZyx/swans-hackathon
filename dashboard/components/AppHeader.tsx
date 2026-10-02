import Link from "next/link";
import { RefreshButton } from "./RefreshButton";

export function AppHeader({ active, pulledAt }: { active?: "lawyer" | "provider"; pulledAt: string | null }) {
  const tab = (href: string, label: string, on: boolean, tone: string) => (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`rounded-md px-3 py-1.5 text-[14px] font-medium ${on ? `${tone} text-surface` : "text-muted hover:bg-sunk hover:text-ink"}`}
    >
      {label}
    </Link>
  );
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/" className="font-serif text-xl font-bold tracking-tight">
            Case Desk
          </Link>
          <nav className="flex gap-1" aria-label="Dashboards">
            {tab("/lawyer", "Lawyer view", active === "lawyer", "bg-legal")}
            {tab("/provider", "Provider view", active === "provider", "bg-med")}
          </nav>
        </div>
        <RefreshButton pulledAt={pulledAt} />
      </div>
    </header>
  );
}
