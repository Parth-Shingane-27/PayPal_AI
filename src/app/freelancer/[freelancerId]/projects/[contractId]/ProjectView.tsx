"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api, ApiError, type Money } from "@/components/api";
import { usePageAssistant } from "@/components/assistant/AssistantContext";
import { AutoReleaseCountdown, isHoldingState, MilestoneStamp } from "@/components/gig/MilestoneStamp";
import { ThreadPanel } from "@/components/gig/ThreadInbox";
import { dateText, errText, field, h1Cls, h2Cls, Notice, primaryBtn, secondaryBtn, Skeleton } from "@/components/gig/freelancer/shared";
import { useI18n } from "@/components/i18n/I18nProvider";
import { IconBack } from "@/components/icons";
import { CountryStamp, MarketStamp } from "@/components/ui";
import type { MessageKey } from "@/lib/i18n/messages";
import { useBase } from "@/lib/use-base";

type Milestone = {
  milestone_id: string;
  position: number;
  title: string;
  amount: Money;
  state: string;
  due_date: string | null;
  revision_count: number;
  funded_at: string | null;
  delivered_at: string | null;
  auto_release_at: string | null;
  released_at: string | null;
  release_kind: string | null;
  dispute_reason: string | null;
};
type Payment = {
  milestone_id: string;
  status: string;
  gross: Money;
  paypal_fee: Money | null;
  platform_fee: Money | null;
  fx_cost: Money | null;
  fees_are_estimates: boolean;
  net_to_freelancer: Money | null;
  captured_at: string | null;
  released_at: string | null;
  failure_reason: string | null;
};
type Refund = { refund_id: string; milestone_id: string; amount: Money; status: string; reason: string; from_holding: boolean; freelancer_debit: Money | null; at: string };
type Contract = {
  contract_id: string;
  title: string;
  scope: string | null;
  status: string;
  market: string;
  total: Money;
  in_holding: Money;
  released: Money;
  awaiting_funding: Money;
  revisions_allowed: number;
  client: { name: string; country: string };
  milestones: Milestone[];
  created_at: string;
  payments: Payment[];
  refunds: Refund[];
  invoices: { invoice_id: string; number: string; milestone_id: string }[];
  thread: { thread_id: string; messages: number } | null;
};
type Detail = {
  history: { event: string; from: string | null; to: string; by: string; note: string | null; at: string }[];
  deliverables: { attachment_id: string; file_name: string; size_bytes: number; url: string }[];
};
type SharedFile = { id: string; file_name: string; size_bytes: number };

const CAN_DELIVER = new Set(["FUNDED", "IN_PROGRESS", "REVISION_REQUESTED"]);

/** Every file already shared in the project thread, newest first. */
async function threadFiles(threadId: string): Promise<SharedFile[]> {
  const th = await api<{ messages: { attachments?: SharedFile[] }[] }>(`/api/threads/${threadId}`);
  return th.messages.flatMap((m) => m.attachments ?? []).reverse();
}

async function uploadToThread(threadId: string, file: File): Promise<SharedFile> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/threads/${threadId}/attachments`, { method: "POST", body: form });
  const data = (await res.json().catch(() => ({}))) as { attachment_id: string; file_name: string; size_bytes: number; error?: { code: string; message: string } };
  if (!res.ok) throw new ApiError(data.error?.message ?? `Request failed (${res.status})`, data.error?.code ?? "HTTP_ERROR", res.status);
  return { id: data.attachment_id, file_name: data.file_name, size_bytes: data.size_bytes };
}

const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Deliver form: a note, files from the project thread (or uploaded into it now), then the freelancer's click on Deliver. */
function DeliverForm({ m, ensureThread, onDone, onCancel }: { m: Milestone; ensureThread: () => Promise<string>; onDone: (msg: string) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<SharedFile[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"upload" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    ensureThread()
      .then(threadFiles)
      .then(
        (f) => alive && setFiles(f),
        () => alive && setFiles([]),
      );
    return () => {
      alive = false;
    };
  }, [ensureThread]);

  async function upload(list: FileList | null) {
    if (!list || list.length === 0) return;
    setBusy("upload");
    setError(null);
    try {
      const threadId = await ensureThread();
      for (const f of Array.from(list)) {
        if (f.size > MAX_FILE_BYTES) {
          setError(t("shared.th.tooLarge", { name: f.name }));
          continue;
        }
        const up = await uploadToThread(threadId, f);
        setFiles((cur) => [up, ...(cur ?? [])]);
        setChosen((c) => new Set(c).add(up.id));
      }
    } catch (e) {
      setError(errText(e, t("fl.proj.uploadFailed")));
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function deliver(e: React.FormEvent) {
    e.preventDefault();
    setBusy("send");
    setError(null);
    try {
      await api(`/api/milestones/${m.milestone_id}/deliver`, { body: { note: note.trim() || null, attachment_ids: [...chosen] } });
      onDone(t("fl.proj.delivered"));
    } catch (err) {
      setError(errText(err, t("fl.proj.actionFailed")));
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={deliver} aria-labelledby={`${id}-h`} className="mt-3 flex flex-col gap-3 rounded-md border border-rule bg-sheet-2/50 p-3">
      <h4 id={`${id}-h`} className="font-semibold">
        {t("fl.proj.deliverTitle", { title: m.title })}
      </h4>
      <label className="flex flex-col gap-1 text-sm text-ink-2">
        {t("fl.proj.note")}
        <textarea className={`${field} py-2`} rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <fieldset>
        <legend className="mb-1 text-sm text-ink-2">{t("fl.proj.files")}</legend>
        {files === null ? (
          <p className="text-sm text-ink-3">{t("fl.loading")}</p>
        ) : files.length === 0 ? (
          <p className="text-sm text-ink-3">{t("fl.proj.noFiles")}</p>
        ) : (
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {files.map((f) => (
              <li key={f.id}>
                <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded px-1 text-sm hover:bg-sheet">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--accent)]"
                    checked={chosen.has(f.id)}
                    onChange={(e) =>
                      setChosen((c) => {
                        const next = new Set(c);
                        if (e.target.checked) next.add(f.id);
                        else next.delete(f.id);
                        return next;
                      })
                    }
                  />
                  <span className="truncate">{f.file_name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <label className={`${secondaryBtn} mt-2 w-fit focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--focus)]`}>
          <input ref={fileInput} type="file" multiple className="sr-only" disabled={busy !== null} onChange={(e) => void upload(e.target.files)} />
          {busy === "upload" ? t("shared.th.uploading") : t("fl.proj.upload")}
        </label>
      </fieldset>
      <p className="text-xs text-ink-3">{t("fl.proj.deliverNote")}</p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={primaryBtn} disabled={busy !== null}>
          {busy === "send" ? t("fl.working") : t("fl.proj.deliver")}
        </button>
        <button type="button" className={secondaryBtn} disabled={busy !== null} onClick={onCancel}>
          {t("form.cancel")}
        </button>
      </div>
    </form>
  );
}

function MilestoneDetails({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const [d, setD] = useState<Detail | null>(null);
  useEffect(() => {
    void api<Detail>(`/api/milestones/${id}`).then(setD, () => setD({ history: [], deliverables: [] }));
  }, [id]);
  if (!d) return <p className="text-sm text-ink-3">{t("fl.loading")}</p>;
  return (
    <div className="grid gap-4 cq-md:grid-cols-2">
      <div>
        <h4 className="text-sm font-semibold">{t("fl.proj.deliverables")}</h4>
        {d.deliverables.length === 0 ? (
          <p className="text-sm text-ink-3">{t("fl.proj.noDeliverables")}</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {d.deliverables.map((f) => (
              <li key={f.attachment_id}>
                <a href={f.url} download={f.file_name} className="text-accent hover:underline">
                  {f.file_name}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h4 className="text-sm font-semibold">{t("fl.proj.history")}</h4>
        <ol className="mt-1 flex flex-col gap-1.5 text-sm">
          {d.history.map((h, i) => (
            <li key={i}>
              <span className="text-ink-3">{dateText(h.at, locale, true)}</span> · <MilestoneStamp state={h.to} />
              {h.note && <p className="mt-0.5 text-ink-2 whitespace-pre-wrap">{h.note}</p>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function MilestoneRow({ m, c, ensureThread, onChanged }: { m: Milestone; c: Contract; ensureThread: () => Promise<string>; onChanged: (msg: string) => void }) {
  const { t, locale } = useI18n();
  const base = useBase();
  const [delivering, setDelivering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pay = c.payments.find((p) => p.milestone_id === m.milestone_id && p.status === "COMPLETED");
  const invoice = c.invoices.find((i) => i.milestone_id === m.milestone_id);
  const holding = isHoldingState(m.state);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/milestones/${m.milestone_id}/start`, { method: "POST" });
      onChanged(t("fl.proj.started"));
    } catch (e) {
      setError(errText(e, t("fl.proj.actionFailed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-[10px] border border-rule bg-sheet p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-ink">
            {m.position}. {m.title}
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-3">
            <MilestoneStamp state={m.state} />
            {m.due_date && <span>{t("fl.proj.due", { date: dateText(m.due_date, locale) })}</span>}
            {m.revision_count > 0 && <span>{t("fl.proj.revisionsOf", { n: m.revision_count, max: c.revisions_allowed })}</span>}
          </p>
          {m.state === "DELIVERED" && <AutoReleaseCountdown at={m.auto_release_at} className="mt-1 block" />}
          {m.state === "DISPUTED" && m.dispute_reason && <p className="mt-1 text-sm text-alert-ink">{t("fl.proj.disputeReason", { reason: m.dispute_reason })}</p>}
        </div>
        <p className="num font-display text-[1.4rem] leading-none font-semibold">{m.amount.display}</p>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-rule pt-3 text-sm cq-md:grid-cols-4">
        <div>
          <dt className="text-ink-3">{t("fl.ov.inHolding")}</dt>
          <dd className="num font-semibold">{holding && pay ? pay.gross.display : "–"}</dd>
        </div>
        <div>
          <dt className="text-ink-3">{t("fl.proj.releasedToYou")}</dt>
          <dd className="num font-semibold">{m.state === "ACCEPTED" && pay?.net_to_freelancer ? pay.net_to_freelancer.display : "–"}</dd>
        </div>
        <div>
          <dt className="text-ink-3">{t("fl.proj.fees")}</dt>
          <dd className="num text-ink-2">
            {pay ? [pay.paypal_fee, pay.platform_fee, pay.fx_cost].filter((x): x is Money => x !== null).map((x) => x.display).join(" + ") || "–" : "–"}
            {pay?.fees_are_estimates && <span className="text-xs text-ink-3"> ({t("cell.est")})</span>}
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">{t("shared.led.col.invoice")}</dt>
          <dd>
            {invoice ? (
              <Link href={`${base}/invoices/${invoice.invoice_id}`} className="num text-accent hover:underline">
                {invoice.number}
              </Link>
            ) : (
              "–"
            )}
          </dd>
        </div>
      </dl>

      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {!delivering && (m.state === "FUNDED" || CAN_DELIVER.has(m.state)) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {m.state === "FUNDED" && (
            <button type="button" className={secondaryBtn} disabled={busy} onClick={() => void start()}>
              {busy ? t("fl.working") : t("fl.proj.start")}
            </button>
          )}
          {CAN_DELIVER.has(m.state) && (
            <button type="button" className={primaryBtn} disabled={busy} onClick={() => setDelivering(true)}>
              {t("fl.proj.deliver")}
            </button>
          )}
        </div>
      )}
      {m.state === "DELIVERED" && <p className="mt-3 text-sm text-ink-3">{t("fl.proj.waitingClient")}</p>}
      {m.state === "AWAITING_FUNDING" && <p className="mt-3 text-sm text-ink-3">{t("fl.proj.waitingFunding")}</p>}
      {delivering && (
        <DeliverForm
          m={m}
          ensureThread={ensureThread}
          onCancel={() => setDelivering(false)}
          onDone={(msg) => {
            setDelivering(false);
            onChanged(msg);
          }}
        />
      )}
      <details className="mt-3">
        <summary className="inline-flex min-h-10 cursor-pointer items-center text-sm font-medium text-accent">{t("fl.proj.details")}</summary>
        <div className="mt-2">
          <MilestoneDetails id={m.milestone_id} />
        </div>
      </details>
    </li>
  );
}

export function ProjectView({ contractId }: { contractId: string }) {
  const { t, locale } = useI18n();
  const base = useBase();
  const [c, setC] = useState<Contract | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const load = useCallback(
    () =>
      api<Contract>(`/api/contracts/${contractId}`).then(
        (d) => {
          setC(d);
          setError(null);
          if (d.thread) setThreadId(d.thread.thread_id);
        },
        (e: unknown) => setError(errText(e, t("fl.error"))),
      ),
    [contractId, t],
  );
  useEffect(() => {
    void load();
  }, [load]);
  usePageAssistant({ agent: "PROFILE", contextLabel: c?.title, onResult: () => void load() });

  const threadRef = useRef<string | null>(null);
  useEffect(() => {
    threadRef.current = threadId;
  }, [threadId]);
  const ensureThread = useCallback(async () => {
    if (threadRef.current) return threadRef.current;
    const r = await api<{ thread_id: string }>(`/api/contracts/${contractId}/thread`, { method: "POST" });
    threadRef.current = r.thread_id;
    setThreadId(r.thread_id);
    return r.thread_id;
  }, [contractId]);

  async function openThread() {
    setOpening(true);
    try {
      await ensureThread();
    } catch (e) {
      setError(errText(e, t("fl.error")));
    } finally {
      setOpening(false);
    }
  }

  const back = (
    <Link href={`${base}/projects`} className="inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-medium text-accent hover:underline">
      <IconBack className="h-4 w-4" />
      {t("fl.nav.projects")}
    </Link>
  );
  if (!c)
    return (
      <div className="flex flex-col gap-4">
        {back}
        {error ? <Notice tone="error">{error}</Notice> : <Skeleton h="h-64" />}
      </div>
    );

  const history = [
    ...c.payments.map((p) => ({ key: `p-${p.milestone_id}-${p.captured_at ?? p.status}`, at: p.captured_at, kind: "payment" as const, p })),
    ...c.refunds.map((r) => ({ key: `r-${r.refund_id}`, at: r.at, kind: "refund" as const, r })),
  ].sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  const msTitle = (id: string) => {
    const m = c.milestones.find((x) => x.milestone_id === id);
    return m ? `${m.position}. ${m.title}` : "";
  };

  return (
    <div className="flex flex-col gap-6">
      {back}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-2xl">
          <h1 className={h1Cls}>{c.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-3">
            <span>{c.client.name}</span>
            <CountryStamp country={c.client.country} />
            <MarketStamp locale={c.market} />
            <span className="rounded-[3px] bg-sheet-2 px-2 py-0.5 text-xs font-semibold text-ink-2">{t(`fl.contract.${c.status}` as MessageKey)}</span>
            <span>{t("fl.proj.since", { date: dateText(c.created_at, locale) })}</span>
          </p>
        </div>
      </header>
      {notice && <Notice tone="ok">{notice}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      <dl className="grid gap-px overflow-hidden rounded-[10px] border border-rule bg-rule cq-sm:grid-cols-2 cq-lg:grid-cols-4">
        {[
          [t("fl.proj.total"), c.total.display],
          [t("fl.ov.inHolding"), c.in_holding.display],
          [t("fl.proj.released"), c.released.display],
          [t("fl.proj.notFunded"), c.awaiting_funding.display],
        ].map(([k, v]) => (
          <div key={k} className="bg-sheet px-4 py-3">
            <dt className="text-sm text-ink-3">{k}</dt>
            <dd className="num mt-0.5 font-display text-xl font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="-mt-3 text-xs text-ink-3">{t("fl.proj.amountsNote")}</p>

      {c.scope && (
        <details className="rounded-[10px] border border-rule bg-sheet px-4 py-2">
          <summary className="flex min-h-10 cursor-pointer items-center font-medium">{t("fl.svc.scope")}</summary>
          <p className="pb-2 whitespace-pre-wrap text-ink-2">{c.scope}</p>
        </details>
      )}

      <div className="grid gap-6 cq-xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section aria-labelledby="ms-title" className="min-w-0">
          <h2 id="ms-title" className={`${h2Cls} mb-3`}>
            {t("fl.proj.milestones")}
          </h2>
          <ul className="flex flex-col gap-3">
            {c.milestones.map((m) => (
              <MilestoneRow
                key={`${m.milestone_id}-${m.state}`}
                m={m}
                c={c}
                ensureThread={ensureThread}
                onChanged={(msg) => {
                  setNotice(msg);
                  void load();
                }}
              />
            ))}
          </ul>
        </section>
        <section aria-labelledby="thread-title" className="flex min-w-0 flex-col gap-3">
          <h2 id="thread-title" className={h2Cls}>
            {t("fl.proj.thread")}
          </h2>
          {threadId ? (
            <ThreadPanel threadId={threadId} role="FREELANCER" compact />
          ) : (
            <div className="rounded-[10px] border border-dashed border-rule-strong p-5">
              <p className="text-sm text-ink-3">{t("fl.proj.noThread")}</p>
              <button type="button" className={`${secondaryBtn} mt-3`} disabled={opening} onClick={() => void openThread()}>
                {t("fl.proj.openThread")}
              </button>
            </div>
          )}
        </section>
      </div>

      <section aria-labelledby="money-title" className="rounded-[10px] border border-rule bg-sheet p-4 md:p-5">
        <h2 id="money-title" className={h2Cls}>
          {t("fl.proj.moneyHistory")}
        </h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-ink-3">{t("fl.proj.noMoney")}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="border-b border-rule text-xs text-ink-3">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t("col.date")}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t("shared.led.col.milestone")}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t("fl.proj.what")}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {t("shared.led.col.amount")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.key} className="border-b border-rule align-top last:border-0">
                    <td className="py-2 pr-3 whitespace-nowrap text-ink-3">{dateText(h.at, locale)}</td>
                    <td className="py-2 pr-3">{msTitle(h.kind === "payment" ? h.p.milestone_id : h.r.milestone_id)}</td>
                    <td className="py-2 pr-3">
                      {h.kind === "payment" ? (
                        <>
                          {t(`fl.pay.${h.p.status}` as MessageKey)}
                          {h.p.released_at && <span className="block text-xs text-ink-3">{t("fl.proj.releasedOn", { date: dateText(h.p.released_at, locale) })}</span>}
                          {h.p.failure_reason && <span className="block text-xs text-alert-ink">{h.p.failure_reason}</span>}
                        </>
                      ) : (
                        <>
                          {t("fl.proj.refund", { status: t(`fl.refund.${h.r.status}` as MessageKey) })}
                          <span className="block text-xs text-ink-3">
                            {h.r.from_holding ? t("fl.appr.fromHolding") : h.r.freelancer_debit ? t("fl.appr.debit", { amount: h.r.freelancer_debit.display }) : ""}
                          </span>
                          <span className="block text-xs text-ink-3">{h.r.reason}</span>
                        </>
                      )}
                    </td>
                    <td className={`num py-2 text-right ${h.kind === "refund" ? "text-alert-ink" : ""}`}>{h.kind === "payment" ? h.p.gross.display : h.r.amount.display}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
