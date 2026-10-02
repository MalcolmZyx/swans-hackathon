import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import { CaseBrief } from "@/components/CaseBrief";
import { CaseJourney } from "@/components/CaseJourney";
import { Cite } from "@/components/Cite";
import { StageTracker } from "@/components/StageTracker";
import { Tabs } from "@/components/Tabs";
import { Term } from "@/components/Term";
import { Timeline } from "@/components/Timeline";
import { Card, NoData, Pill, Section, Stat } from "@/components/ui";
import { loadBrief, sourceIndex } from "@/lib/brief";
import { journey, loadCase, today as getToday } from "@/lib/data";
import { daysBetween, fmtDate, money, relative } from "@/lib/format";
import type { CaseEvent, Party } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Lawyer view · ROSS" };

const CATEGORY: Record<Party["category"], { label: string; tone: "legal" | "crit" | "warn" | "med" | "neutral" }> = {
  client: { label: "Client", tone: "legal" },
  adverse: { label: "Other side", tone: "neutral" },
  insurer: { label: "Insurance", tone: "warn" },
  medical: { label: "Medical provider", tone: "med" },
  other: { label: "Other", tone: "neutral" },
};

export default async function LawyerPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const data = await loadCase();
  if (!data) {
    return (
      <>
        <AppHeader active="lawyer" pulledAt={null} />
        <NoData />
      </>
    );
  }
  const { tab } = await searchParams;
  const today = getToday();
  const { matter, events } = data;
  // The AI brief is written on Refresh from Clio; only show it if it describes the data on screen.
  const brief = await loadBrief();
  const aiBrief = brief?.pulledAt === data.pulledAt ? brief : null;
  const fact =(name: string) => data.facts.find((f) => f.name === name);
  const num = (key: string) => data.numbers.find((n) => n.key === key);
  const providerName = (id: number) => data.parties.find((p) => p.id === id)?.name ?? "Unknown provider";

  const doi = fact("Date of Incident");
  const location = fact("Accident Location");
  const summary = fact("Case Summary");
  const treatment = fact("Treatment Status");
  const liability = fact("Liability Assessment");
  const priors = fact("Prior Related Injuries");
  const lawsuit = events.find((e) => e.milestone === "Lawsuit filed");
  const nextAppt = events.find((e) => e.kind === "calendar" && e.date >= today);
  const tasks = events.filter((e) => e.kind === "task");
  const pending = tasks.filter((t) => t.status === "pending");
  const overdue = pending.filter((t) => t.date < today);
  const soon = events.filter((e) => (e.kind === "calendar" || (e.kind === "task" && e.status === "pending")) && e.date >= today && daysBetween(today, e.date) <= 30);
  const value = num("value");
  const limit = num("defendantLimit");
  const coverPct = value?.value && limit?.value ? Math.round((limit.value / value.value) * 100) : null;
  const lastNote = [...events].reverse().find((e) => e.kind === "note" && e.date <= today);

  const docsByFolder = data.documents.reduce<Record<string, CaseEvent[]>>((acc, d) => {
    (acc[d.folder ?? "Other"] ??= []).push(d);
    return acc;
  }, {});
  const partyOrder: Party["category"][] = ["client", "adverse", "insurer", "medical", "other"];

  return (
    <div className="min-h-screen flex-1 bg-bg">
      <AppHeader active="lawyer" pulledAt={data.pulledAt} />
      <main className="mx-auto grid w-full max-w-[1100px] gap-8 px-8 pb-24 pt-9 max-[760px]:px-4 max-[760px]:pt-6">
        {/* Case header */}
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2 label">
            <span>Matter {matter.displayNumber}</span>
            <span aria-hidden="true">·</span>
            <span>{matter.practiceArea}</span>
            <span aria-hidden="true">·</span>
            <span>{matter.status}</span>
            <span aria-hidden="true">·</span>
            <span>Opened {fmtDate(matter.openDate)}</span>
            <Cite source={matter.source} />
          </div>
          <h1 className="text-[30px] font-extrabold leading-tight tracking-[-0.03em] max-[760px]:text-[25px]">{matter.description}</h1>
          <StageTracker stages={matter.stages} current={matter.stage} source={matter.source} />
        </div>

        <Tabs
          tone="legal"
          initial={tab}
          tabs={[
            {
              id: "overview",
              label: "Overview",
              badge: overdue.length ? { value: overdue.length, tone: "crit", title: `${overdue.length} overdue tasks` } : undefined,
              content: (
                <>
                  <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                    {/* On wide screens the journey takes the brief's height (contain:size keeps its long list from setting the row height) and scrolls inside. */}
                    <Card className="flex flex-col gap-3 lg:min-h-[560px] lg:[contain:size]">
                      <div className="grid gap-1">
                        <div className="label text-accent">Case journey</div>
                        <h2 className="text-[20px] font-bold tracking-[-0.02em]">Key moments in the case</h2>
                        <p className="text-[14px] text-muted">The legal milestones from the crash to today, then the appointments and open tasks still ahead. The full record is on the Timeline tab.</p>
                      </div>
                      <CaseJourney events={journey(events, today)} today={today} vertical />
                    </Card>

                    {aiBrief ? (
                      <CaseBrief brief={aiBrief} sources={sourceIndex(data)} />
                    ) : (
                    <Card className="grid content-start gap-4">
                      <div className="grid gap-1">
                        <div className="label text-accent">New to this case? Start here</div>
                        <h2 className="text-[20px] font-bold tracking-[-0.02em]">The case in one minute</h2>
                      </div>
                      <ul className="grid gap-3 text-[15px] leading-relaxed">
                        <li>
                          <b>{matter.client.name}</b> was hurt in a car crash on <b>{fmtDate(doi?.value as string)}</b> ({relative(doi?.value as string, today)}) at {location?.value as string}.{" "}
                          <Cite source={doi?.source} /> <Cite source={location?.source} />
                        </li>
                        <li>
                          {summary?.value as string} <Cite source={summary?.source} />
                        </li>
                        <li>
                          <b>Treatment:</b> {treatment?.value as string} <Cite source={treatment?.source} />
                        </li>
                        {lawsuit && (
                          <li>
                            <b>Lawsuit filed</b> {fmtDate(lawsuit.date)}. The case is now in <b>{matter.stage.toLowerCase()}</b>: evidence exchange (<Term id="discovery">discovery</Term>) and defense medical exams (<Term id="ime">IMEs</Term>). <Cite source={lawsuit.source} />
                          </li>
                        )}
                        <li>
                          <b>Biggest risks:</b> liability is {String(liability?.value).charAt(0).toLowerCase() + String(liability?.value).slice(1)} <Cite source={liability?.source} /> Prior injuries: {String(priors?.value).toLowerCase()} <Cite source={priors?.source} />
                        </li>
                        {nextAppt && (
                          <li>
                            <b>Next on the calendar:</b> {nextAppt.title}, {fmtDate(nextAppt.date)} ({relative(nextAppt.date, today)}). <Cite source={nextAppt.source} />
                          </li>
                        )}
                        {lastNote && (
                          <li>
                            <b>Latest file note:</b> “{lastNote.title}” ({fmtDate(lastNote.date)}). <Cite source={lastNote.source} />
                          </li>
                        )}
                      </ul>
                      <p className="text-[12.5px] text-muted">Use Refresh from Clio for an AI summary of the case and of what changed since your last visit.</p>
                    </Card>
                    )}
                  </div>

                  <Card className="grid content-start gap-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <h2 className="text-[20px] font-bold tracking-[-0.02em]">Needs attention</h2>
                      <span className="text-[13px] text-muted tabular">
                        {pending.length} open tasks{overdue.length ? `, ${overdue.length} overdue` : ""}
                      </span>
                    </div>
                    <ul className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                      {pending.map((t) => {
                        const late = t.date < today;
                        return (
                          <li key={t.id} className={`grid gap-1.5 rounded-[12px] border p-3.5 ${late ? "border-[#f6c9c4] bg-red-soft" : "border-line bg-surface"}`}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-semibold leading-snug">{t.title}</span>
                              <Pill tone={late ? "crit" : "warn"}>{late ? `Overdue · due ${fmtDate(t.date)}` : `Due ${fmtDate(t.date)}`}</Pill>
                            </div>
                            <p className="text-[13px] text-muted">{t.body}</p>
                            <div>
                              <Cite source={t.source} />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </Card>
                </>
              ),
            },
            {
              id: "timeline",
              label: "Timeline",
              badge: { value: events.length, title: `${events.length} records` },
              content: (
                <Section
                  id="timeline"
                  eyebrow={`${events.length} records`}
                  title="What happened when"
                  intro="Every note, email, call, appointment, task, document and medical bill on one timeline. Filter by type, search, or click an event to read it in full."
                >
                  <Timeline events={events} today={today} />
                </Section>
              ),
            },
            {
              id: "deadlines",
              label: "Deadlines & requests",
              badge: soon.length ? { value: soon.length, tone: "warn", title: `${soon.length} due in the next 30 days` } : undefined,
              content: (
                <div className="grid gap-6 lg:grid-cols-2">
                  <Section title="Next 30 days" intro="Appointments and open tasks coming up.">
                    <Card className="p-0">
                      <ul>
                        {soon.length === 0 && <li className="p-4 text-muted">Nothing scheduled in the next 30 days.</li>}
                        {soon.map((e) => (
                          <li key={e.id} className="grid grid-cols-[86px_minmax(0,1fr)] gap-3 border-b border-line-2 px-4 py-3 last:border-0">
                            <div className="text-[12.5px] font-semibold text-accent tabular">
                              {fmtDate(e.date, { weekday: "short", month: "short", day: "numeric" })}
                            </div>
                            <div className="grid gap-0.5">
                              <span className="font-medium leading-snug">{e.title}</span>
                              <span className="text-[12.5px] text-muted">
                                {e.kind === "task" ? "Task" : "Appointment"} · {relative(e.date, today)} <Cite source={e.source} />
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  </Section>

                  <Section title="Records requests" intro={<>What the firm has asked each provider for (<Term id="recordsRequest">records requests</Term>), and how many times.</>}>
                    <Card className="overflow-x-auto p-0">
                      <table className="w-full text-[13.5px]">
                        <thead className="label bg-surface-2 text-left">
                          <tr>
                            <th className="px-4 py-2 font-medium">Provider</th>
                            <th className="px-4 py-2 font-medium">Asked</th>
                            <th className="px-4 py-2 font-medium">Last reply</th>
                            <th className="px-4 py-2 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.requests.map((r) => {
                            const late = r.status === "pending" && r.due < today;
                            return (
                              <tr key={r.taskId} className="border-t border-line-2 align-top">
                                <td className="px-4 py-3">
                                  <div className="font-medium">{providerName(r.providerId)}</div>
                                  <div className="text-[12.5px] text-muted">{r.title}</div>
                                  <Cite source={r.source} />
                                </td>
                                <td className="px-4 py-3 tabular">{r.timesAsked}×</td>
                                <td className="px-4 py-3 tabular">{r.lastReply ? fmtDate(r.lastReply) : <span className="text-muted">None</span>}</td>
                                <td className="px-4 py-3">
                                  <Pill tone={r.status === "complete" ? "ok" : late ? "crit" : "warn"}>{r.status === "complete" ? "Done" : late ? "Overdue" : `Due ${fmtDate(r.due, { month: "short", day: "numeric" })}`}</Pill>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </Card>
                  </Section>
                </div>
              ),
            },
            {
              id: "money",
              label: "Money",
              content: (
                <>
                  <Section eyebrow="Damages and coverage" title="Key numbers" intro={<>What the case is worth, what insurance can pay, and what comes off the top. Hover the underlined terms for a definition.</>}>
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-px overflow-hidden rounded-[16px] border border-line bg-line shadow-soft">
                      <Stat label={<Term id="specials">Medical bills (specials)</Term>} value={money(num("specials")?.value)} source={num("specials")?.source ?? null} />
                      <Stat label="Lost wages claimed" value={money(num("wageLoss")?.value)} source={num("wageLoss")?.source ?? null} />
                      <Stat label="Estimated case value" value={money(value?.value)} source={value?.source ?? null} />
                      <Stat label={<Term id="limits">Defendant&apos;s policy limit</Term>} value={money(limit?.value)} source={limit?.source ?? null} />
                      <Stat label={<Term id="lien">Medicaid lien</Term>} value={money(num("lien")?.value)} source={num("lien")?.source ?? null} note="Repaid from any recovery" />
                      <Stat label={<Term id="nofault">No-fault benefits</Term>} value={money(num("noFault")?.value)} source={num("noFault")?.source ?? null} note="Used up" />
                    </div>
                    {coverPct != null && (
                      <Card className="grid gap-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <b>Insurance covers about {coverPct}% of the estimated value</b>
                          <span className="text-[13px] text-muted">
                            {money(limit?.value)} limit against {money(value?.value)} value <Cite source={limit?.source} /> <Cite source={value?.source} />
                          </span>
                        </div>
                        <div className="relative h-3 overflow-hidden rounded-full bg-line-2" role="img" aria-label={`Policy limit covers ${coverPct} percent of estimated value`}>
                          <div className="h-full rounded-full bg-accent" style={{ width: `${coverPct}%` }} />
                        </div>
                        <div className="flex justify-between text-[12.5px] text-muted tabular">
                          <span>Covered by the defendant&apos;s policy: {money(limit?.value)}</span>
                          <span>Uncovered: {money((value?.value ?? 0) - (limit?.value ?? 0))}</span>
                        </div>
                      </Card>
                    )}
                  </Section>

                  <Section title="Case costs paid by the firm" intro="Out-of-pocket costs the firm has advanced. None are reimbursed yet.">
                    <Card className="overflow-x-auto p-0">
                      <table className="w-full text-[13.5px]">
                        <tbody>
                          {data.costs.map((c) => (
                            <tr key={c.id} className="border-b border-line-2 last:border-0">
                              <td className="whitespace-nowrap px-4 py-2.5 text-[12.5px] text-muted tabular">{fmtDate(c.date)}</td>
                              <td className="px-4 py-2.5">
                                <b className="font-medium">{c.category}</b> <span className="text-muted">{c.description}</span>
                              </td>
                              <td className="px-4 py-2.5 text-right tabular">{money(c.amount, true)}</td>
                              <td className="px-4 py-2.5">
                                <Cite source={c.source} />
                              </td>
                            </tr>
                          ))}
                          <tr className="bg-surface-2 font-semibold">
                            <td className="px-4 py-2.5" colSpan={2}>
                              Total
                            </td>
                            <td className="px-4 py-2.5 text-right tabular">{money(data.costs.reduce((s, c) => s + c.amount, 0), true)}</td>
                            <td />
                          </tr>
                        </tbody>
                      </table>
                    </Card>
                  </Section>
                </>
              ),
            },
            {
              id: "people",
              label: "People & documents",
              content: (
                <div className="grid gap-6 lg:grid-cols-2">
                  <Section title="Who's involved" intro={`${data.parties.length} people and organizations linked to the matter.`}>
                    <Card className="grid gap-4">
                      {partyOrder.map((cat) => {
                        const group = data.parties.filter((p) => p.category === cat);
                        if (!group.length) return null;
                        return (
                          <div key={cat} className="grid gap-2">
                            <Pill tone={CATEGORY[cat].tone}>{CATEGORY[cat].label}</Pill>
                            <ul className="grid gap-2">
                              {group.map((p) => (
                                <li key={p.id} className="grid gap-0.5 border-b border-line-2 pb-2 last:border-0">
                                  <span className="font-medium">
                                    {p.name} <Cite source={p.contactSource} />
                                  </span>
                                  <span className="text-[13px] text-muted">
                                    {p.role} <Cite source={p.source} />
                                  </span>
                                  {(p.email || p.phone) && <span className="text-[12.5px] text-muted">{[p.email, p.phone].filter(Boolean).join(" · ")}</span>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                    </Card>
                  </Section>

                  <Section title="Documents" intro={`${data.documents.length} documents filed to the matter, by folder.`}>
                    <Card className="grid gap-4">
                      {Object.entries(docsByFolder)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([folder, docs]) => (
                          <div key={folder} className="grid gap-1.5">
                            <h3 className="label">{folder}</h3>
                            <ul className="grid gap-1.5">
                              {docs.map((d) => (
                                <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2 text-[14px]">
                                  <span>
                                    {d.title} <Cite source={d.source} />
                                  </span>
                                  <span className="text-[12.5px] text-muted tabular">received {fmtDate(d.date)}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                    </Card>
                  </Section>
                </div>
              ),
            },
            {
              id: "facts",
              label: "Case facts",
              content: (
                <Section title="All case facts" intro="Every custom field recorded on the matter in Clio, as written.">
                  <Card className="overflow-x-auto p-0">
                    <table className="w-full text-[13.5px]">
                      <tbody>
                        {data.facts.map((f) => (
                          <tr key={f.name} className="border-b border-line-2 align-top last:border-0">
                            <th scope="row" className="w-56 px-4 py-3 text-left font-medium">
                              {f.name}
                            </th>
                            <td className="whitespace-pre-wrap px-4 py-3">{f.type === "currency" ? money(f.value as number) : f.type === "checkbox" ? (f.value ? "Yes" : "No") : String(f.value)}</td>
                            <td className="px-4 py-3">
                              <Cite source={f.source} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Card>
                </Section>
              ),
            },
          ]}
        />
      </main>
    </div>
  );
}
