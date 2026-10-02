export function fmtDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }): string {
  if (!iso) return "—";
  return new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", opts);
}

export function money(n: number | null | undefined, cents = false): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents ? 2 : 0 });
}

export function daysBetween(from: string, to: string): number {
  return Math.round((new Date(to.slice(0, 10)).getTime() - new Date(from.slice(0, 10)).getTime()) / 864e5);
}

/** "today", "in 8 days", "3 days ago", "in 2 months"… relative to `today`. */
export function relative(date: string, today: string): string {
  const d = daysBetween(today, date);
  if (d === 0) return "today";
  const abs = Math.abs(d);
  const unit = abs < 45 ? `${abs} day${abs === 1 ? "" : "s"}` : abs < 365 ? `${Math.round(abs / 30)} months` : `${(abs / 365).toFixed(1)} years`;
  return d > 0 ? `in ${unit}` : `${unit} ago`;
}

/** "Sep 9" within the current year, "Sep 9, 2025" otherwise (DESIGN.md §8). */
export function shortDate(iso: string | null | undefined, today: string): string {
  if (!iso) return "—";
  return fmtDate(iso, iso.slice(0, 4) === today.slice(0, 4) ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}
