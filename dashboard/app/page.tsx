import type { Metadata } from "next";
import { cookies } from "next/headers";
import { CaseActions, type FileEntry } from "@/components/CaseSheets";
import { Cite, SourceButton } from "@/components/Cite";
import { TopBar } from "@/components/TopBar";
import { loadBrief } from "@/lib/brief";
import { loadCase, today as getToday } from "@/lib/data";
import { changesSince, computeFacts, firstName, keySentence, tidyTitle } from "@/lib/digest";
import { fmtDate, money, shortDate } from "@/lib/format";
import { injuries, injuryLabels } from "@/lib/pages";
import { isLive, loadShares } from "@/lib/share";
import { lastVisit, USER_COOKIE } from "@/lib/visits";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const data = await loadCase();
  return { title: data ? `ROSS · ${data.matter.client.name}` : "ROSS" };
}

// "McCulloch Orthopaedic Surgical Services, PLLC" → "McCulloch"; "Advanced Rockland Chiropractic…" → "Advanced Rockland".
const GENERIC = /^(orthopa\w*|chiropract\w*|physical|surgical|hospital|radiology|imaging|center|offices?|associates|medical|services|interventional|therapy|of|pllc|llc|p\.?c\.?|inc\.?)$/i;
function shortProvider(name: string): string {
  const words = name.replace(/,.*$/, "").split(/\s+/);
  const keep: string[] = [];
  for (const w of words) {
    if (GENERIC.test(w) || keep.length === 2) break;
    keep.push(w);
  }
  return keep.join(" ") || words[0];
}

export default async function CaseScreen({ searchParams }: { searchParams: Promise<{ since?: string }> }) {
  const data = await loadCase();
  if (!data) {
    return (
      <>
        <TopBar pulledAt={null} />
        <main className="mx-auto grid max-w-[560px] justify-items-center gap-3 px-6 py-24 text-center">
          <h1 className="text-[22px] font-bold">Could not load the matter</h1>
          <p className="text-muted">
            ROSS reads <code className="rounded bg-surface-2 px-1">dashboard/data/case.json</code>. Run <code className="rounded bg-surface-2 px-1">python explore_clio.py</code> and{" "}
            <code className="rounded bg-surface-2 px-1">python build_dashboard_data.py</code>, or press Sync above.
          </p>
        </main>
      </>
    );
  }

  const today = getToday();
  const { since } = await searchParams;
  const { matter } = data;
  const f = computeFacts(data, today);
  const first = firstName(matter.client.name);

  // What changed since this person last looked (per-person, zero AI cost).
  const user = (await cookies()).get(USER_COOKIE)?.value;
  const visit = await lastVisit(user, matter.id);
  const changes = changesSince(data, today, visit ? new Set(visit.seenIds) : null, since && /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : undefined);

  // The headline: built from facts, AI brief as the fallback.
  const brief = await loadBrief();
  const gap = f.value.value != null && f.coverage.value != null && f.value.value > f.coverage.value;
  const worst = f.overdue[0];

  // Needs you: overdue first, then due in the next 30 days. Max 3 shown.
  const needs = [...f.overdue.map((o) => ({ e: o.event, late: o.daysLate })), ...f.upcoming.map((e) => ({ e, late: 0 }))];

  const injuryLine = injuryLabels(await injuries(data));
  const injurySources = injuryLine.flatMap((i) => i.sources);

  // Doctors: the latest link to each office, and whether anyone opened it.
  const shares = (await loadShares()).filter((s) => s.matterId === matter.id && isLive(s));
  const latestByProvider = new Map(shares.map((s) => [s.providerId, s]));
  const doctors = [...latestByProvider.values()].map((s) => {
    const all = shares.filter((x) => x.providerId === s.providerId);
    const lastView = all.flatMap((x) => x.views).map((v) => v.at).sort().at(-1);
    return { name: shortProvider(s.providerName), opened: lastView ?? null };
  });

  const entries: FileEntry[] = data.events
    .filter((e) => e.kind !== "milestone")
    .map((e) => ({ id: e.id, kind: e.kind, date: e.date, title: e.title, why: keySentence(e), source: e.source }));

  const initials = matter.client.name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <>
      <TopBar pulledAt={data.pulledAt} />
      <main className="mx-auto grid w-full max-w-[960px] gap-9 px-8 pb-[60px] pt-9 max-[760px]:gap-7 max-[760px]:px-4 max-[760px]:pt-6">
        {/* ① The person */}
        <section className="flex items-center gap-4">
          <div aria-hidden="true" className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#dfe6ff,#ece3ff)] text-[22px] font-bold text-accent-ink">
            {initials}
          </div>
          <div className="grid min-w-0 gap-1">
            <h1 className="text-[30px] font-extrabold leading-tight tracking-[-0.03em] max-[760px]:text-[25px]">{matter.client.name}</h1>
            <p className="flex flex-wrap items-center gap-x-1.5 text-[13.5px] text-muted tabular">
              {f.age != null && <span>{f.age}</span>}
              {f.doi && (
                <>
                  <span aria-hidden="true">·</span>
                  <SourceButton sources={[f.doiSource]} className="hover:text-accent">
                    Injured {fmtDate(f.doi)}
                  </SourceButton>
                </>
              )}
              <span aria-hidden="true">·</span>
              <SourceButton sources={[matter.source]} className="font-bold text-accent">
                {matter.stage}
              </SourceButton>
              {f.lastContact && (
                <>
                  <span aria-hidden="true">·</span>
                  <SourceButton sources={[f.lastContact.source]} className="text-accent hover:underline">
                    Last contact {fmtDate(f.lastContact.date)}
                  </SourceButton>
                </>
              )}
            </p>
          </div>
        </section>

        {/* ② One sentence */}
        <p className="max-w-[820px] text-[21px] leading-[1.45] tracking-[-0.01em] max-[760px]:text-[18px]">
          {gap && (
            <>
              Worth {money(f.value.value)}, but only <b>{money(f.coverage.value)}</b> of insurance stands behind it
              <Cite n={1} sources={[...f.coverage.src, ...f.value.src]} />.{" "}
            </>
          )}
          {worst && (
            <>
              Still waiting on {tidyTitle(worst.event.title).replace(/^./, (c) => c.toLowerCase())}, <b className="text-red">{worst.daysLate} days late</b>
              <Cite n={gap ? 2 : 1} source={worst.event.source} />.
            </>
          )}
          {!gap && !worst && (brief?.headline ?? `${matter.stage}. Nothing is overdue.`)}
        </p>

        {/* ③ Three numbers */}
        <section className="grid grid-cols-3 overflow-hidden rounded-[16px] border border-line max-[760px]:grid-cols-1">
          <SourceButton sources={f.value.src} className="grid content-start gap-1 p-5 text-left hover:bg-surface-2 max-[760px]:border-b max-[760px]:border-line" label={`Worth ${money(f.value.value)}, open sources`}>
            <span className="label">Worth</span>
            <span className="text-[28px] font-[750] tracking-[-0.02em] tabular">{money(f.value.value)}</span>
            <span className="text-[13px] text-muted">Estimated case value</span>
          </SourceButton>
          <SourceButton sources={f.coverage.src} className="grid content-start gap-1 border-l border-line p-5 text-left hover:bg-surface-2 max-[760px]:border-b max-[760px]:border-l-0" label={`Insurance ${money(f.coverage.value)}, open sources`}>
            <span className="label">Insurance</span>
            <span className="text-[28px] font-[750] tracking-[-0.02em] tabular">{money(f.coverage.value)}</span>
            {f.coverage.confirmed ? (
              <span className="text-[13px] font-semibold text-green">✓ confirmed{f.coverage.confirmedOn ? ` ${shortDate(f.coverage.confirmedOn, today)}` : ""}</span>
            ) : (
              <span className="text-[13px] font-semibold text-amber">not confirmed</span>
            )}
          </SourceButton>
          <SourceButton sources={f.net.src} className="grid content-start gap-1 border-l border-line p-5 text-left hover:bg-surface-2 max-[760px]:border-l-0" label={`${first} nets about ${money(f.net.value)}, open sources`}>
            <span className="label">{first} nets ≈</span>
            <span className={`text-[28px] font-[750] tracking-[-0.02em] tabular ${f.net.value >= 0 ? "text-green" : "text-red"}`}>{money(f.net.value)}</span>
            <span className="text-[13px] text-muted">of {money(f.recoverable)} cap after fee, costs, lien</span>
          </SourceButton>
        </section>

        {/* ④ New since you looked · ⑤ Needs you */}
        <section className="grid grid-cols-2 gap-8 max-[760px]:grid-cols-1">
          <div className="grid content-start gap-1">
            <h2 className="label flex items-baseline gap-2">
              New since you looked <span className="font-semibold text-faint">{changes.total}</span>
            </h2>
            {changes.top.length === 0 ? (
              <p className="py-2.5 text-[14px] text-muted">Nothing new since {fmtDate(visit?.seenAt ?? today)}</p>
            ) : (
              <div>
                {changes.top.map((e) => (
                  <SourceButton key={e.id} sources={[e.source]} className="row">
                    <span className="dot bg-accent" />
                    <span className="row-title min-w-0 flex-1 truncate">{e.title}</span>
                    <span className="shrink-0 text-[12.5px] text-muted tabular">{shortDate(e.date, today)}</span>
                  </SourceButton>
                ))}
              </div>
            )}
            {changes.basis === "first-visit" ? (
              <p className="text-[12.5px] text-faint">First visit — showing the 3 most important recent items</p>
            ) : changes.total > 3 ? (
              <p className="text-[12.5px] text-faint">
                {changes.total} changes, showing the 3 that matter most
              </p>
            ) : null}
          </div>

          <div className="grid content-start gap-1">
            <h2 className="label flex items-baseline gap-2">
              Needs you <span className="font-semibold text-faint">{needs.length}</span>
            </h2>
            {needs.length === 0 ? (
              <p className="py-2.5 text-[14px] text-muted">Nothing on your plate.</p>
            ) : (
              <div>
                {needs.slice(0, 3).map(({ e, late }) => (
                  <SourceButton key={e.id} sources={[e.source]} className="row">
                    <span className={`dot ${late ? "bg-red" : "bg-faint"}`} />
                    <span className={`row-title min-w-0 flex-1 truncate ${late ? "font-semibold" : ""}`}>{tidyTitle(e.title)}</span>
                    <span className={`shrink-0 text-[12.5px] tabular ${late ? "font-semibold text-red" : "text-muted"}`}>{late ? `${late} days late` : shortDate(e.date, today)}</span>
                  </SourceButton>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ⑥ Ask, ⑦ quiet lines, ⑧ actions */}
        <CaseActions firstName={first} entries={entries} today={today} clientName={matter.client.name}>
          <section className="grid gap-2.5 text-[13.5px]">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted">Injuries</span>
              {injuryLine.length ? (
                <>
                  <span className="text-ink-2">{injuryLine.map((i) => i.label).join(" · ")}</span>
                  <SourceButton sources={injurySources} className="font-semibold text-accent hover:underline">
                    {injurySources.length} pages ›
                  </SourceButton>
                </>
              ) : (
                <span className="text-muted">No findings read from the records yet</span>
              )}
            </p>
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted">Doctors</span>
              {doctors.length ? (
                <span className="text-ink-2">
                  {doctors.map((d, i) => (
                    <span key={d.name}>
                      {i > 0 && " · "}
                      {d.name} {d.opened ? <span className="text-green">opened your link {shortDate(d.opened, today)}</span> : <span className="text-amber">not opened</span>}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="text-muted">No doctor links yet</span>
              )}
            </p>
          </section>
        </CaseActions>

        {/* ⑨ Footer: visible proof of read-only */}
        <footer className="text-[12px] text-faint tabular">
          Clio Manage (live) · 0 writes · {entries.length} entries · {data.documents.length} documents · synced {fmtDate(data.pulledAt)}
          <br />
          “Nets” assumes a {(f.feePct * 100).toFixed(1)}% contingency fee and {money(f.firmSpend.value)} of firm costs; medical bills are excluded from costs.
        </footer>
      </main>
    </>
  );
}
