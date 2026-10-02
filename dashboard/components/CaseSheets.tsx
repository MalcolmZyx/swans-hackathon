"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { AskResult } from "@/lib/ask";
import type { DoctorView, Policy } from "@/lib/share";
import type { Source } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { DoctorUpdate } from "./DoctorUpdate";
import { Icon, KIND } from "./Icons";
import { Sheet } from "./Sheet";
import { useOpenSource, useToast } from "./SourceViewer";

export type FileEntry = { id: string; kind: string; date: string; title: string; why: string; source: Source };

const shortDate = (iso: string, today: string) => fmtDate(iso, iso.slice(0, 4) === today.slice(0, 4) ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });

/**
 * Everything on the Case screen that opens a sheet: the Ask box, Share with a doctor and Full file.
 * Deep links: ?share=1 opens the Share sheet, ?open=<entry id> opens that entry's source.
 */
export function CaseActions({ firstName, entries, today, clientName, children }: { firstName: string; entries: FileEntry[]; today: string; clientName: string; children?: React.ReactNode }) {
  const params = useSearchParams();
  const router = useRouter();
  const openSource = useOpenSource();
  const [sheet, setSheet] = useState<"ask" | "file" | "share" | null>(params.get("share") ? "share" : null);
  const [question, setQuestion] = useState("");
  const [firstQ, setFirstQ] = useState<string | null>(null);

  useEffect(() => {
    const id = params.get("open");
    const e = id && entries.find((x) => x.id === id);
    if (e) openSource(e.source);
    // Only on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Everything on screen counts as seen once the page is hidden or closed.
  useEffect(() => {
    let sent = false;
    const seen = () => {
      if (sent || document.visibilityState !== "hidden") return;
      sent = true;
      fetch("/api/seen", { method: "POST", keepalive: true }).catch(() => {});
    };
    const onHide = () => {
      if (!sent) {
        sent = true;
        fetch("/api/seen", { method: "POST", keepalive: true }).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", seen);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", seen);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);

  const close = () => {
    setSheet(null);
    if (params.get("share")) router.replace("/", { scroll: false });
  };

  return (
    <>
      {/* ⑥ Ask box */}
      <form
        className="group flex h-[52px] items-center gap-2.5 rounded-[16px] border-[1.5px] border-line bg-white pl-4 pr-1.5 transition-[border-color,box-shadow] focus-within:border-accent focus-within:shadow-[0_0_0_4px_var(--accent-soft)]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!question.trim()) return;
          setFirstQ(question.trim());
          setQuestion("");
          setSheet("ask");
        }}
      >
        <Icon name="spark" size={18} className="text-violet" />
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask anything about this case" aria-label="Ask anything about this case" className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint" />
        <button type="submit" className="btn sm h-[38px] px-4">
          Ask
        </button>
      </form>

      {/* ⑦ The quiet lines, passed in by the page */}
      {children}

      {/* ⑧ Actions */}
      <div className="flex flex-wrap gap-2.5">
        <button type="button" className="btn primary max-[760px]:w-full" onClick={() => setSheet("share")}>
          <Icon name="share" size={17} /> Share with a doctor
        </button>
        <button type="button" className="btn h-[46px] rounded-[13px] px-5 max-[760px]:w-full" onClick={() => setSheet("file")}>
          Full file ›
        </button>
      </div>

      {sheet === "ask" && firstQ && <AskSheet first={firstQ} firstName={firstName} today={today} onClose={close} />}
      {sheet === "file" && <FullFileSheet entries={entries} today={today} onClose={close} />}
      {sheet === "share" && <ShareSheet clientName={clientName} onClose={close} />}
    </>
  );
}

// ---------- Ask ----------

type Turn = { q: string; a: AskResult | null; error?: string };

function AskSheet({ first, firstName, today, onClose }: { first: string; firstName: string; today: string; onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const send = async (q: string) => {
    setTurns((t) => [...t, { q, a: null }]);
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "The server could not answer.");
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a: body } : x)));
    } catch (e) {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: e instanceof Error ? e.message : String(e) } : x)));
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    send(first);
  }, [first]);
  useEffect(() => end.current?.scrollIntoView({ block: "end", behavior: "smooth" }), [turns]);

  return (
    <Sheet
      chip="✦ Ask"
      title={`About ${firstName}'s case only`}
      onClose={onClose}
      footer={
        <form
          className="flex gap-2 border-t border-line-2 px-5 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            send(draft.trim());
            setDraft("");
          }}
        >
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask a follow-up" aria-label="Ask a follow-up" className="h-[42px] min-w-0 flex-1 rounded-[12px] border-[1.5px] border-line px-3.5 text-[15px] outline-none focus:border-accent" />
          <button type="submit" className="btn h-[42px]">
            Ask
          </button>
        </form>
      }
    >
      <div className="grid gap-5 px-5 py-5">
        {turns.map((t, i) => (
          <Fragment key={i}>
            <div className="ml-auto max-w-[85%] rounded-[16px_16px_4px_16px] bg-ink px-4 py-2.5 text-[15px] text-white">{t.q}</div>
            {t.error ? (
              <div className="rounded-[14px] bg-amber-soft p-4 text-[14.5px]">
                <b>Couldn&apos;t answer right now.</b> <span className="text-ink-2">{t.error}</span>
              </div>
            ) : !t.a ? (
              <div className="flex items-center gap-3 text-[14px] text-muted">
                <span className="spinner" /> Reading the file…
              </div>
            ) : (
              <Answer a={t.a} today={today} />
            )}
          </Fragment>
        ))}
        <div ref={end} />
      </div>
    </Sheet>
  );
}

function Answer({ a, today }: { a: AskResult; today: string }) {
  const open = useOpenSource();
  const list = a.notFound ? (a.nearest ?? []) : a.cites;
  const sources = list.map((c) => c.source);
  const parts = a.answer.split(/(\[\d+\])/g);
  return (
    <div className={`grid gap-3 rounded-[16px] border p-4 ${a.notFound ? "border-[#F3DDBF] bg-amber-soft" : "border-line bg-white"}`}>
      {a.notFound ? (
        <p className="text-[16px] font-bold">Not in the file.</p>
      ) : (
        <p className="text-[15.5px] leading-relaxed">
          {parts.map((p, i) => {
            const m = /^\[(\d+)\]$/.exec(p);
            if (!m) return <Fragment key={i}>{p}</Fragment>;
            const n = Number(m[1]);
            return (
              <button key={i} type="button" className="cite" aria-label={`Source ${n}`} onClick={() => open(sources, n - 1)}>
                {n}
              </button>
            );
          })}
        </p>
      )}
      {list.length > 0 && (
        <div className="grid gap-1">
          {a.notFound && <div className="label mb-1">Nearest passages</div>}
          {list.map((c, i) => {
            const k = KIND[c.kind] ?? KIND.note;
            return (
              <button key={i} type="button" onClick={() => open(sources, i)} className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-2.5 rounded-[10px] px-2 py-2 text-left hover:bg-surface-2">
                <span className="mt-0.5 grid h-[20px] w-[20px] place-items-center rounded-[6px] bg-accent-soft text-[11px] font-bold text-accent">{c.n}</span>
                <span className="grid gap-0.5">
                  <span className="text-[13.5px]">
                    <b className="font-semibold" style={{ color: k.color }}>
                      {c.title}
                    </b>
                    {c.page != null && <span className="text-muted"> · p.{c.page}</span>}
                    {c.date && <span className="text-muted tabular"> · {shortDate(c.date, today)}</span>}
                  </span>
                  <span className="text-[13px] italic text-muted">{c.snippet}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- Full file ----------

const FILTERS = ["note", "email", "call", "task", "calendar", "document", "charge"] as const;

function FullFileSheet({ entries, today, onClose }: { entries: FileEntry[]; today: string; onClose: () => void }) {
  const open = useOpenSource();
  const [on, setOn] = useState<Set<string>>(new Set());
  const shown = useMemo(() => [...entries].filter((e) => !on.size || on.has(e.kind)).sort((a, b) => b.date.localeCompare(a.date)), [entries, on]);
  const months = useMemo(() => {
    const out: { month: string; items: { e: FileEntry; i: number }[] }[] = [];
    shown.forEach((e, i) => {
      const month = new Date(`${e.date.slice(0, 7)}-15T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
      if (out.at(-1)?.month !== month) out.push({ month, items: [] });
      out.at(-1)!.items.push({ e, i });
    });
    return out;
  }, [shown]);

  return (
    <Sheet chip="File" title={`Full file · ${entries.length} entries`} onClose={onClose} wide>
      <div className="sticky top-0 z-10 flex flex-wrap gap-1.5 border-b border-line-2 bg-white px-5 py-3">
        {FILTERS.map((k) => {
          const active = on.has(k);
          const count = entries.filter((e) => e.kind === k).length;
          if (!count) return null;
          return (
            <button
              key={k}
              type="button"
              aria-pressed={active}
              onClick={() => setOn((s) => {
                const n = new Set(s);
                if (n.has(k)) n.delete(k);
                else n.add(k);
                return n;
              })}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold ${active ? "border-ink bg-ink text-white" : "border-line bg-white text-ink-2 hover:bg-surface-2"}`}
            >
              <span className="dot" style={{ background: KIND[k].color }} />
              {KIND[k].label} <span className={active ? "text-white/70" : "text-faint"}>{count}</span>
            </button>
          );
        })}
      </div>
      <div className="px-5 pb-6">
        {months.map((m) => (
          <section key={m.month}>
            <h3 className="label sticky top-[57px] bg-white/95 py-2.5 backdrop-blur-sm">{m.month}</h3>
            {m.items.map(({ e, i }) => {
              const k = KIND[e.kind] ?? KIND.note;
              return (
                <button key={e.id} type="button" className="row items-start" onClick={() => open(shown.map((x) => x.source), i)}>
                  <span className="mt-0.5" style={{ color: k.color }}>
                    <Icon name={k.icon} size={16} />
                  </span>
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="row-title truncate font-semibold">{e.title}</span>
                    {e.why && <span className="line-clamp-1 text-[13px] italic text-muted">{e.why}</span>}
                  </span>
                  <span className="shrink-0 text-[12.5px] text-muted tabular">{shortDate(e.date, today)}</span>
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </Sheet>
  );
}

// ---------- Share with a doctor ----------

type ShareRow = { token: string; providerId: number; providerName: string; createdAt: string; live: boolean; views: number; lastView: string | null };
type SharesPayload = { shares: ShareRow[]; providers: { id: number; name: string; openAsks: number }[]; defaultPolicy: Policy; today: string };

function ShareSheet({ clientName, onClose }: { clientName: string; onClose: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<SharesPayload | null>(null);
  const [providerId, setProviderId] = useState<number | null>(null);
  const [policy, setPolicy] = useState<Policy>({ status: true, treatment: true, coverage: false });
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<DoctorView | null>(null);
  const [sent, setSent] = useState<{ token: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyHint, setCopyHint] = useState("");
  const urlInput = useRef<HTMLInputElement>(null);

  const reload = async () => {
    const body = (await (await fetch("/api/shares")).json()) as SharesPayload;
    setData(body);
    setProviderId((p) => p ?? body.providers[0]?.id ?? null);
    setPolicy((p) => p ?? body.defaultPolicy);
  };
  useEffect(() => {
    reload();
  }, []);

  // Live preview, 150ms after any change.
  useEffect(() => {
    if (providerId == null) return;
    const t = setTimeout(async () => {
      const res = await fetch("/api/shares/preview", { method: "POST", headers: { "Content-Type": "application/json", "x-preview": "1" }, body: JSON.stringify({ providerId, policy, note }) });
      if (res.ok) setPreview(await res.json());
    }, 150);
    return () => clearTimeout(t);
  }, [providerId, policy, note]);

  const provider = data?.providers.find((p) => p.id === providerId);
  const shortName = provider?.name.split(/[ ,]/)[0] ?? "the office";
  const earlier = (data?.shares ?? []).filter((s) => s.providerId === providerId && s.token !== sent?.token).slice(-3).reverse();

  const send = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/shares", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerId, policy, note }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setSent({ token: body.token, url: `${window.location.origin}${body.url}` });
      toast("Secure link created");
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not create the link");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: string) => {
    await fetch(`/api/shares/${token}/revoke`, { method: "POST" });
    if (sent?.token === token) setSent(null);
    toast("Link revoked");
    reload();
  };

  const copy = async () => {
    if (!sent) return;
    try {
      await navigator.clipboard.writeText(sent.url);
      toast("Link copied");
    } catch {
      urlInput.current?.select();
      setCopyHint("Press Cmd+C to copy");
    }
  };

  const Switch = ({ k, title, sub, amber }: { k: keyof Policy; title: string; sub: string; amber?: boolean }) => {
    const warn = amber && policy[k];
    return (
      <label className={`flex cursor-pointer items-center gap-3 rounded-[12px] border px-3.5 py-3 ${warn ? "border-[#F3DDBF] bg-amber-soft" : "border-line"}`}>
        <span className="grid flex-1 gap-0.5">
          <span className="text-[14.5px] font-semibold">{title}</span>
          <span className={`text-[12.5px] ${amber ? "text-amber" : "text-muted"}`}>{sub}</span>
          {warn && preview?.coverage?.limit != null && <span className="text-[12.5px] font-semibold text-amber">Shares the ${preview.coverage.limit.toLocaleString("en-US")} limit</span>}
        </span>
        <span className={`switch ${amber ? "amber" : ""}`}>
          <input type="checkbox" checked={policy[k]} onChange={(e) => setPolicy({ ...policy, [k]: e.target.checked })} aria-label={title} />
          <span />
        </span>
      </label>
    );
  };

  return (
    <Sheet chip="Share" title="Share with a doctor" onClose={onClose} wide>
      <div className="grid gap-6 px-5 py-5 min-[761px]:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid content-start gap-4">
          <label className="grid gap-1.5">
            <span className="label">To</span>
            <select value={providerId ?? ""} onChange={(e) => { setProviderId(Number(e.target.value)); setSent(null); }} className="h-[42px] rounded-[11px] border border-line bg-white px-3 text-[14.5px] font-semibold">
              {data?.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.openAsks ? ` · ${p.openAsks} open ask${p.openAsks === 1 ? "" : "s"}` : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-2">
            <Switch k="status" title="Case status and what we need" sub="Stage, last movement, open asks" />
            <Switch k="treatment" title="Injuries and treatment" sub="Treatment status and upcoming visits, no documents" />
            <Switch k="coverage" title="Insurance" sub="Sensitive · off by default" amber />
          </div>

          <p className="flex items-center gap-2 text-[13px] text-muted">
            <Icon name="lock" size={14} /> Never shared: internal notes, case value, settlement talk, liens.
          </p>

          <label className="grid gap-1.5">
            <span className="label">Personal note</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Optional note to the office" className="rounded-[11px] border border-line px-3 py-2.5 text-[14.5px] outline-none focus:border-accent" />
          </label>

          <div className="grid gap-1.5">
            <button type="button" className="btn primary w-full" disabled={busy || providerId == null} onClick={send}>
              <Icon name="lock" size={16} /> {busy ? "Creating link…" : "Send secure link"}
            </button>
            <span className="text-center text-[12.5px] text-muted">Expires in 30 days · you can revoke it</span>
          </div>

          {sent && (
            <div className="grid gap-2 rounded-[12px] border border-[#BFE8D2] bg-green-soft p-3.5">
              <span className="text-[13.5px] font-semibold text-green">Secure link ready for {provider?.name}</span>
              <div className="flex gap-2">
                <input ref={urlInput} readOnly value={sent.url} aria-label="Secure link" onFocus={(e) => e.target.select()} className="h-[34px] min-w-0 flex-1 rounded-[9px] border border-line bg-white px-2.5 font-mono text-[12.5px]" />
                <button type="button" className="btn sm" onClick={copy}>
                  <Icon name="copy" size={13} /> Copy
                </button>
                <button type="button" className="btn sm" onClick={() => revoke(sent.token)}>
                  Revoke
                </button>
              </div>
              {copyHint && <span className="text-[12.5px] text-muted">{copyHint}</span>}
              <a href={sent.url} target="_blank" rel="noopener noreferrer" className="w-fit text-[13px] font-semibold text-accent">
                Open the doctor&apos;s page ↗
              </a>
            </div>
          )}

          {earlier.length > 0 && (
            <div className="grid gap-1">
              <span className="label">Earlier links to this office</span>
              {earlier.map((s) => (
                <div key={s.token} className="row text-[13.5px]">
                  <span className="flex-1">
                    Sent {fmtDate(s.createdAt, { month: "short", day: "numeric" })} ·{" "}
                    {!s.live ? <span className="text-muted">revoked or expired</span> : s.views ? <b className="text-green">opened {s.views}×</b> : <b className="text-amber">not opened</b>}
                  </span>
                  {s.live && (
                    <button type="button" className="btn sm" onClick={() => revoke(s.token)}>
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid content-start justify-items-center gap-2">
          <span className="text-[12.5px] text-muted">Live preview · exactly what {shortName} will see</span>
          <div className="relative h-[560px] w-[300px] rounded-[40px] bg-ink p-[10px] shadow-lg">
            <div className="absolute left-1/2 top-[10px] z-10 h-[22px] w-[110px] -translate-x-1/2 rounded-b-[14px] bg-ink" />
            <div className="h-full overflow-y-auto rounded-[31px] bg-[#F6F7F9] px-3 pb-3 pt-8 [zoom:0.86]">
              {preview ? <DoctorUpdate key={providerId ?? 0} view={preview} preview /> : <div className="grid h-full place-items-center"><span className="spinner" /></div>}
            </div>
          </div>
          <span className="text-[12px] text-faint">{clientName}&apos;s page, as of today</span>
        </div>
      </div>
    </Sheet>
  );
}
