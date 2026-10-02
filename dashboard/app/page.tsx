import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { Cite } from "@/components/Cite";
import { NoData } from "@/components/ui";
import { loadCase, medicalProviders, today as getToday } from "@/lib/data";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await loadCase();
  if (!data) {
    return (
      <>
        <AppHeader pulledAt={null} />
        <NoData />
      </>
    );
  }
  const today = getToday();
  const { matter } = data;
  const pending = data.events.filter((e) => e.kind === "task" && e.status === "pending");
  const overdue = pending.filter((e) => e.date < today);
  const openRequests = data.requests.filter((r) => r.status === "pending");
  return (
    <>
      <AppHeader pulledAt={data.pulledAt} />
      <main className="mx-auto grid w-full max-w-5xl gap-10 px-4 pb-24 pt-12 sm:px-6">
        <div className="grid gap-3">
          <div className="font-mono text-[12px] font-medium uppercase tracking-wider text-muted">
            Matter {matter.displayNumber} · {matter.practiceArea} · {matter.stage} <Cite source={matter.source} />
          </div>
          <h1 className="font-serif text-[clamp(30px,4.5vw,46px)] font-bold leading-tight">{matter.description}</h1>
          <p className="max-w-[62ch] text-[16px] text-muted">
            Two views of the same Clio case. Lawyers see the whole file. Treating providers see only the medical side, with attorney notes and strategy left out. Every figure links back to the Clio record it came from.
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <Link href="/lawyer" className="group grid gap-3 rounded-xl border border-line border-t-4 border-t-legal bg-surface p-6 hover:border-legal">
            <span className="font-mono text-[11.5px] font-medium uppercase tracking-wider text-legal">For the legal team</span>
            <span className="font-serif text-2xl font-semibold group-hover:underline">Lawyer view</span>
            <span className="text-[14.5px] text-muted">Where the case stands, the one-minute brief, money and coverage, deadlines, and the full timeline of every note, email, call and document.</span>
            <span className="text-[13.5px] font-medium">
              {pending.length} open tasks{overdue.length ? ` · ${overdue.length} overdue` : ""} · stage: {matter.stage}
            </span>
          </Link>
          <Link href="/provider" className="group grid gap-3 rounded-xl border border-line border-t-4 border-t-med bg-surface p-6 hover:border-med">
            <span className="font-mono text-[11.5px] font-medium uppercase tracking-wider text-med">For treating providers</span>
            <span className="font-serif text-2xl font-semibold group-hover:underline">Provider view</span>
            <span className="text-[14.5px] text-muted">Pick a provider to see the patient summary, what the firm is asking them for, their bills, upcoming appointments and the treatment timeline.</span>
            <span className="text-[13.5px] font-medium">
              {medicalProviders(data).length} providers · {openRequests.length} open records requests
            </span>
          </Link>
        </div>
        <p className="text-[12.5px] text-muted">Data snapshot from Clio, {fmtDate(data.pulledAt)}.</p>
      </main>
    </>
  );
}
