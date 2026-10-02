import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import { CaseJourney } from "@/components/CaseJourney";
import { Cite } from "@/components/Cite";
import { ProviderPicker } from "@/components/ProviderPicker";
import { Term } from "@/components/Term";
import { Tabs } from "@/components/Tabs";
import { Timeline } from "@/components/Timeline";
import { Card, NoData, Pill, Section } from "@/components/ui";
import { journey, loadCase, medicalProviders, providerView, today as getToday } from "@/lib/data";
import { fmtDate, money, relative } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Provider view · ROSS" };

export default async function ProviderPage({ searchParams }: { searchParams: Promise<{ provider?: string; tab?: string }> }) {
  const data = await loadCase();
  if (!data) {
    return (
      <>
        <AppHeader active="provider" pulledAt={null} />
        <NoData />
      </>
    );
  }
  const providers = medicalProviders(data);
  const { provider: requestedParam, tab } = await searchParams;
  const requested = Number(requestedParam);
  // Default to the first provider with an open request from the firm.
  const fallback = data.requests.find((r) => r.status === "pending")?.providerId ?? providers[0]?.id;
  const provider = providers.find((p) => p.id === requested) ?? providers.find((p) => p.id === fallback)!;

  // Only the provider-safe slice of the case is used below.
  const view = providerView(data, provider.id);
  const today = getToday();
  const fact = (name: string) => view.facts.find((f) => f.name === name);
  const num = (key: string) => view.numbers.find((n) => n.key === key);
  const { client } = view.matter;
  const doi = fact("Date of Incident");
  const hipaa = fact("HIPAA Authorization Received");
  const treatment = fact("Treatment Status");
  const summary = fact("Case Summary");
  const location = fact("Accident Location");
  const mine = (ids: number[]) => ids.includes(provider.id);
  const messages = view.events.filter((e) => (e.kind === "email" || e.kind === "call") && mine(e.providerIds)).reverse();
  const upcoming = view.events.filter((e) => e.kind === "calendar" && e.date >= today);
  const openRequests = view.requests.filter((r) => r.status === "pending");
  const billed = view.charges.reduce((s, c) => s + c.amount, 0);
  const firstVisit = view.events.find((e) => mine(e.providerIds));

  return (
    <div className="min-h-screen flex-1 bg-bg">
      <AppHeader active="provider" pulledAt={view.pulledAt} />
      <main className="mx-auto grid w-full max-w-[1100px] gap-8 px-8 pb-24 pt-9 max-[760px]:px-4 max-[760px]:pt-6">
        <div className="grid gap-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <ProviderPicker providers={providers.map((p) => ({ id: p.id, name: p.name, role: p.role }))} current={provider.id} />
            <p className="max-w-md text-[13px] text-muted">
              Shared view for treating providers. Attorney notes, legal strategy, insurer correspondence and other providers&apos; bills are not included.
            </p>
          </div>
          <p className="text-[14px] text-muted">
            <span className="font-semibold text-teal">{provider.role}</span> <Cite source={provider.source} />
          </p>
        </div>

        <Card className="grid gap-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="grid gap-1">
              <div className="label text-teal">Patient</div>
              <h1 className="text-[30px] font-extrabold leading-tight tracking-[-0.03em] max-[760px]:text-[25px]">
                {client.name} <Cite source={view.matter.clientSource} />
              </h1>
              <div className="text-[14px] text-muted">
                Born {fmtDate(client.dob)} · referred by {view.matter.responsibleAttorney ?? "the firm"}, matter {view.matter.displayNumber} <Cite source={view.matter.source} />
              </div>
            </div>
            <div className="grid gap-1.5 justify-items-end">
              {hipaa && (
                <span className="inline-flex items-center gap-2">
                  <Pill tone={hipaa.value ? "ok" : "warn"}>{hipaa.value ? "✓ HIPAA authorization on file" : "No HIPAA authorization"}</Pill>
                  <Cite source={hipaa.source} />
                </span>
              )}
              {firstVisit && <span className="text-[12.5px] text-muted">Your practice first appears {fmtDate(firstVisit.date)}</span>}
            </div>
          </div>
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-x-8 gap-y-4 text-[14px]">
            <div className="grid gap-1">
              <dt className="label">Injury date</dt>
              <dd>
                {fmtDate(doi?.value as string)} ({relative(doi?.value as string, today)}) <Cite source={doi?.source} />
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="label">How it happened</dt>
              <dd>
                {summary?.value as string} <Cite source={summary?.source} />
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="label">Where</dt>
              <dd>
                {location?.value as string} <Cite source={location?.source} />
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="label">Treatment status</dt>
              <dd>
                {treatment?.value as string} <Cite source={treatment?.source} />
              </dd>
            </div>
          </dl>
        </Card>

        <Tabs
          tone="med"
          initial={tab}
          tabs={[
            {
              id: "requests",
              label: "Requests & billing",
              badge: openRequests.length ? { value: openRequests.length, tone: "warn", title: `${openRequests.length} open records requests` } : undefined,
              content: (
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                  <Section
                    title="What the law firm needs from you"
                    intro={<>Open <Term id="recordsRequest">records requests</Term> and how often the firm has asked.</>}
                    aside={<Pill tone={openRequests.length ? "warn" : "ok"}>{openRequests.length} open</Pill>}
                  >
                    <div className="grid gap-3">
                      {view.requests.length === 0 && <Card className="text-muted">The firm has no requests on file for {provider.name}.</Card>}
                      {view.requests.map((r) => {
                        const late = r.status === "pending" && r.due < today;
                        return (
                          <Card key={r.taskId} className={`grid gap-2 ${late ? "border-crit" : ""}`}>
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <b className="font-semibold leading-snug">{r.title}</b>
                              <Pill tone={r.status === "complete" ? "ok" : late ? "crit" : "warn"}>
                                {r.status === "complete" ? "Done" : late ? `Overdue since ${fmtDate(r.due)}` : `Due ${fmtDate(r.due)}`}
                              </Pill>
                            </div>
                            <p className="text-[14px] text-muted">{r.detail}</p>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                              <span>
                                Asked <b className="tabular">{r.timesAsked}</b> time{r.timesAsked === 1 ? "" : "s"}
                                {r.lastAsked && `, most recently ${fmtDate(r.lastAsked)}`}
                              </span>
                              <span className={r.lastReply ? "" : "font-semibold text-amber"}>{r.lastReply ? `Your last reply: ${fmtDate(r.lastReply)}` : "No reply on file"}</span>
                              <Cite source={r.source} />
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  </Section>

                  <Section title="Billing on file" intro="Your charges as recorded by the firm, and what affects payment.">
                    <Card className="grid gap-4">
                      {view.charges.length === 0 ? (
                        <p className="text-muted">No bills from {provider.name} are recorded on this case.</p>
                      ) : (
                        <>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-muted">Total billed</span>
                            <span className="text-[26px] font-[750] tracking-[-0.02em] tabular">{money(billed, true)}</span>
                          </div>
                          <ul className="grid gap-2">
                            {view.charges.map((c) => (
                              <li key={c.id} className="grid gap-0.5 border-t border-line-2 pt-2 text-[13.5px]">
                                <div className="flex justify-between gap-2">
                                  <span>
                                    Services {fmtDate(c.serviceStart)}
                                    {c.serviceEnd !== c.serviceStart && ` to ${fmtDate(c.serviceEnd)}`}
                                  </span>
                                  <b className="tabular">{money(c.amount, true)}</b>
                                </div>
                                <span className="text-muted">
                                  Payment status: {c.paymentStatus} · {c.file} <Cite source={c.source} />
                                </span>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                      <div className="grid gap-2 rounded-[12px] bg-surface-2 p-3.5 ring-1 ring-line-2 text-[13.5px]">
                        <p>
                          <Term id="nofault">No-fault benefits</Term> of {money(num("noFault")?.value)} are <b>used up</b>, so further bills are unlikely to be paid until the case resolves. <Cite source={num("noFault")?.source} />
                        </p>
                        <p>
                          A <Term id="lien">Medicaid lien</Term> of {money(num("lien")?.value, true)} is asserted against any recovery. <Cite source={num("lien")?.source} />
                        </p>
                      </div>
                    </Card>
                  </Section>
                </div>
              ),
            },
            {
              id: "treatment",
              label: "Treatment",
              badge: upcoming.length ? { value: upcoming.length, title: `${upcoming.length} upcoming appointments` } : undefined,
              content: (
                <>
                  <Section eyebrow="Treatment journey" title="Key moments in the patient's care" intro={`From the injury to upcoming appointments and open tasks, oldest to newest. Moments involving ${provider.name} are marked.`}>
                    <CaseJourney events={journey(view.events, today)} today={today} highlightId={provider.id} />
                  </Section>

                  <Section title="Patient's upcoming appointments" intro="Scheduled treatment across the care team. Yours are highlighted.">
                    <Card className="p-0">
                      <ul>
                        {upcoming.length === 0 && <li className="p-4 text-muted">No upcoming appointments on file.</li>}
                        {upcoming.map((e) => (
                          <li key={e.id} className={`grid grid-cols-[86px_minmax(0,1fr)] gap-3 border-b border-line-2 px-4 py-3 last:border-0 ${mine(e.providerIds) ? "bg-med-soft" : ""}`}>
                            <div className="text-[12.5px] font-semibold text-teal tabular">{fmtDate(e.date, { weekday: "short", month: "short", day: "numeric" })}</div>
                            <div className="grid gap-0.5">
                              <span className="font-medium leading-snug">{e.title}</span>
                              <span className="text-[12.5px] text-muted">
                                {relative(e.date, today)} <Cite source={e.source} />
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  </Section>
                </>
              ),
            },
            {
              id: "messages",
              label: "Messages",
              badge: { value: messages.length, title: `${messages.length} emails and calls` },
              content: (
                <Section title="Messages with the firm" intro={`${messages.length} emails and calls between the firm and ${provider.name}, newest first.`}>
                  <Card className="p-0">
                    <ul>
                      {messages.length === 0 && <li className="p-4 text-muted">No messages on file.</li>}
                      {messages.map((m) => (
                        <li key={m.id} className="grid gap-0.5 border-b border-line-2 px-4 py-3 last:border-0">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="font-medium leading-snug">{m.title}</span>
                            <span className="text-[12.5px] text-muted tabular">{fmtDate(m.date)}</span>
                          </div>
                          <span className="text-[12.5px] text-muted">
                            {m.kind === "call" ? "Call" : "Email"} · {m.outbound ? "From the firm" : "From your office"} <Cite source={m.source} />
                          </span>
                          <p className="line-clamp-2 text-[13px] text-muted">{m.body}</p>
                        </li>
                      ))}
                    </ul>
                  </Card>
                </Section>
              ),
            },
            {
              id: "care",
              label: "Care team & records",
              content: (
                <div className="grid gap-6 lg:grid-cols-2">
                  <Section title="Care team" intro="Other providers treating this patient for the same injuries.">
                    <Card className="p-0">
                      <ul>
                        {view.careTeam
                          .filter((p) => p.id !== provider.id)
                          .map((p) => (
                            <li key={p.id} className="grid gap-0.5 border-b border-line-2 px-4 py-3 last:border-0">
                              <span className="font-medium">
                                {p.name} <Cite source={p.contactSource} />
                              </span>
                              <span className="text-[13px] text-muted">
                                {p.role} <Cite source={p.source} />
                              </span>
                            </li>
                          ))}
                      </ul>
                    </Card>
                  </Section>

                  <Section title="Records from your practice" intro="Documents on the matter that came from your office.">
                    <Card className="p-0">
                      <ul>
                        {view.documents.length === 0 && <li className="p-4 text-muted">No documents from {provider.name} are filed on the matter yet.</li>}
                        {view.documents.map((d) => (
                          <li key={d.id} className="grid gap-0.5 border-b border-line-2 px-4 py-3 last:border-0">
                            <span className="font-medium">
                              {d.title} <Cite source={d.source} />
                            </span>
                            <span className="text-[12.5px] text-muted">
                              {d.folder} · received {fmtDate(d.date)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  </Section>
                </div>
              ),
            },
            {
              id: "timeline",
              label: "Timeline",
              badge: { value: view.events.length, title: `${view.events.length} records` },
              content: (
                <Section
                  title="Treatment and records timeline"
                  intro="The medical side of the case: appointments, records requests, records received and bills. Events involving your practice are highlighted."
                >
                  <Timeline events={view.events} today={today} highlightId={provider.id} highlightLabel={provider.name.split(",")[0]} />
                </Section>
              ),
            },
          ]}
        />
      </main>
    </div>
  );
}
