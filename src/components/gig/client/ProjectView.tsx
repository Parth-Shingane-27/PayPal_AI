"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useId, useState } from "react";
import { api, type Money } from "../../api";
import { usePageAssistant } from "../../assistant/AssistantContext";
import { ConfirmDialog } from "../../ConfirmDialog";
import { useI18n } from "../../i18n/I18nProvider";
import { type MilestoneCaptureOutcome, PayPalButtons } from "../../PayPalButtons";
import { CountryStamp } from "../../ui";
import { AutoReleaseCountdown, MilestoneStamp } from "../MilestoneStamp";
import { ThreadPanel } from "../ThreadInbox";
import { useGigBase } from "../use-gig-base";
import { deliveryNote } from "./format";

/**
 * The client's project screen: the milestone plan, funding the next milestone
 * through PayPal (the money is then held), and the client's own decisions on a
 * delivery: Accept delivery (releases the money), Request revision, Open
 * dispute. Nothing here acts for the freelancer, and nothing is accepted
 * without the client's click and confirmation.
 */

export type ProjectMilestone = {
  milestone_id: string;
  position: number;
  title: string;
  amount: Money;
  state: string;
  due_date: string | null;
  revision_count: number;
  delivered_at: string | null;
  auto_release_at: string | null;
  released_at: string | null;
  dispute_reason: string | null;
};

export type ProjectContract = {
  contract_id: string;
  title: string;
  scope: string;
  status: "DRAFT" | "ACTIVE" | "COMPLETED" | "CANCELLED" | string;
  currency: string;
  total: Money;
  in_holding: Money;
  released: Money;
  awaiting_funding: Money;
  revisions_allowed: number;
  freelancer: { name: string; country: string };
  milestones: ProjectMilestone[];
  payments: { milestone_id: string; status: string }[];
  invoices: { invoice_id: string; number: string; milestone_id: string }[];
  thread: { thread_id: string; messages: number } | null;
};

export type MilestoneDetail = {
  history: { event: string; note: string | null; at: string }[];
  deliverables: { attachment_id: string; file_name: string; size_bytes: number; url: string }[];
};

const btn = "inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";
const fieldCls = "rounded-md border border-rule-strong bg-sheet px-3 py-2 text-sm placeholder:text-ink-3 focus:border-accent";

function fileSize(bytes: number, locale: string): string {
  const units = ["B", "KB", "MB"] as const;
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: u === 0 ? 0 : 1 }).format(v)} ${units[u]}`;
}

function NoteForm({ label, hint, submitLabel, busy, onSubmit, onCancel, tone }: { label: string; hint: string; submitLabel: string; busy: boolean; onSubmit: (note: string) => void; onCancel: () => void; tone: "neutral" | "alert" }) {
  const { t } = useI18n();
  const id = useId();
  const [note, setNote] = useState("");
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-rule bg-sheet p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (note.trim()) onSubmit(note.trim());
      }}
    >
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <p id={`${id}-hint`} className="text-sm text-ink-3">
        {hint}
      </p>
      <textarea id={id} aria-describedby={`${id}-hint`} rows={4} maxLength={2000} required value={note} onChange={(e) => setNote(e.target.value)} className={fieldCls} autoFocus />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className={`${btn} border border-rule-strong font-medium text-ink-2 hover:bg-sheet-2`}>
          {t("cl.common.cancel")}
        </button>
        <button type="submit" disabled={busy || !note.trim()} className={`${btn} ${tone === "alert" ? "bg-alert text-sheet" : "bg-ink text-sheet"}`}>
          {busy ? t("cl.common.sending") : submitLabel}
        </button>
      </div>
    </form>
  );
}

type Done = (message: string) => void;

/** The client's decisions on one milestone. */
function MilestoneActions({ m, contract, onDone, onError }: { m: ProjectMilestone; contract: ProjectContract; onDone: Done; onError: (msg: string) => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"revision" | "dispute" | null>(null);
  const [confirm, setConfirm] = useState<"accept" | "cancel" | null>(null);
  const [busy, setBusy] = useState(false);
  const used = m.revision_count;
  const allowed = contract.revisions_allowed;
  const revisionsLeft = used < allowed;

  async function run(action: "accept" | "revision" | "dispute" | "cancel", note?: string) {
    setBusy(true);
    try {
      await api(`/api/milestones/${m.milestone_id}/${action}`, { body: note === undefined ? {} : { note } });
      setMode(null);
      setConfirm(null);
      onDone(
        action === "accept"
          ? t("cl.ms.acceptedNotice", { n: m.position, amount: m.amount.display, name: contract.freelancer.name })
          : action === "revision"
            ? t("cl.ms.revisionNotice", { n: m.position })
            : action === "dispute"
              ? t("cl.ms.disputeNotice", { n: m.position })
              : t("cl.ms.cancelledNotice", { n: m.position }),
      );
    } catch (err) {
      setConfirm(null);
      onError(err instanceof Error ? err.message : t("cl.err.generic"));
    } finally {
      setBusy(false);
    }
  }

  const delivered = m.state === "DELIVERED";
  const disputed = m.state === "DISPUTED";
  const heldBeforeDelivery = m.state === "FUNDED" || m.state === "IN_PROGRESS" || m.state === "REVISION_REQUESTED";
  const canCancel = m.state === "AWAITING_FUNDING" && contract.status === "ACTIVE";

  if (!delivered && !disputed && !heldBeforeDelivery && !canCancel) return null;

  return (
    <div className="mt-3 flex flex-col gap-3">
      {delivered && (
        <>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => setConfirm("accept")} className={`${btn} bg-accent text-sheet`}>
              {t("cl.ms.accept")}
            </button>
            <button
              type="button"
              disabled={busy || !revisionsLeft}
              aria-expanded={mode === "revision"}
              onClick={() => setMode(mode === "revision" ? null : "revision")}
              className={`${btn} border border-rule-strong font-medium text-ink hover:border-accent hover:text-accent`}
            >
              {t("cl.ms.revision")}
            </button>
            <button
              type="button"
              disabled={busy}
              aria-expanded={mode === "dispute"}
              onClick={() => setMode(mode === "dispute" ? null : "dispute")}
              className={`${btn} border border-rule-strong font-medium text-ink-2 hover:border-alert hover:text-alert-ink`}
            >
              {t("cl.ms.dispute")}
            </button>
          </div>
          <p className="text-sm text-ink-3">
            {t("cl.ms.revisionsUsed", { used, allowed })}
            {!revisionsLeft && ` ${t("cl.ms.revisionsGone")}`}
          </p>
        </>
      )}
      {disputed && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy} onClick={() => setConfirm("accept")} className={`${btn} bg-accent text-sheet`}>
            {t("cl.ms.accept")}
          </button>
          <span className="text-sm text-ink-3">{t("cl.ms.acceptResolves")}</span>
        </div>
      )}
      {heldBeforeDelivery && mode !== "dispute" && (
        <button type="button" disabled={busy} onClick={() => setMode("dispute")} className="inline-flex min-h-11 w-fit items-center text-sm text-ink-3 underline-offset-2 hover:text-alert-ink hover:underline">
          {t("cl.ms.disputeEarly")}
        </button>
      )}
      {canCancel && (
        <button type="button" disabled={busy} onClick={() => setConfirm("cancel")} className="inline-flex min-h-11 w-fit items-center text-sm text-ink-3 underline-offset-2 hover:text-alert-ink hover:underline">
          {t("cl.ms.cancel")}
        </button>
      )}

      {mode === "revision" && (
        <NoteForm
          label={t("cl.ms.revisionLabel")}
          hint={t("cl.ms.revisionHint", { left: Math.max(0, allowed - used) })}
          submitLabel={t("cl.ms.revisionSend")}
          busy={busy}
          tone="neutral"
          onSubmit={(note) => run("revision", note)}
          onCancel={() => setMode(null)}
        />
      )}
      {mode === "dispute" && (
        <NoteForm
          label={t("cl.ms.disputeLabel")}
          hint={t("cl.ms.disputeHint")}
          submitLabel={t("cl.ms.disputeSend")}
          busy={busy}
          tone="alert"
          onSubmit={(note) => run("dispute", note)}
          onCancel={() => setMode(null)}
        />
      )}

      <ConfirmDialog
        open={confirm === "accept"}
        title={t("cl.ms.acceptTitle", { n: m.position })}
        confirmLabel={t("cl.ms.acceptConfirm", { amount: m.amount.display })}
        cancelLabel={t("cl.common.notYet")}
        busy={busy}
        onConfirm={() => run("accept")}
        onCancel={() => setConfirm(null)}
      >
        <p>{t("cl.ms.acceptBody", { amount: m.amount.display, name: contract.freelancer.name })}</p>
        <p className="font-semibold text-ink">{t("cl.ms.acceptFinal")}</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "cancel"}
        title={t("cl.ms.cancelTitle", { n: m.position })}
        confirmLabel={t("cl.ms.cancel")}
        cancelLabel={t("cl.common.keep")}
        busy={busy}
        onConfirm={() => run("cancel")}
        onCancel={() => setConfirm(null)}
      >
        <p>{t("cl.ms.cancelBody")}</p>
      </ConfirmDialog>
    </div>
  );
}

function MilestoneCard({ m, contract, detail, onDone, onError }: { m: ProjectMilestone; contract: ProjectContract; detail?: MilestoneDetail; onDone: Done; onError: (msg: string) => void }) {
  const { t, locale } = useI18n();
  const base = useGigBase();
  const day = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso));
  const note = deliveryNote(detail?.history);
  const invoice = contract.invoices.find((i) => i.milestone_id === m.milestone_id);
  const showDelivery = m.state === "DELIVERED" || m.state === "DISPUTED" || m.state === "ACCEPTED" || m.state === "REVISION_REQUESTED" || m.state === "REFUNDED";
  const highlight = m.state === "DELIVERED";
  return (
    <li id={`ms-${m.milestone_id}`} className={`scroll-mt-24 rounded-[10px] border p-4 md:p-5 ${highlight ? "border-accent bg-accent-soft/40" : "border-rule bg-sheet"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-[0.08em] text-ink-3 uppercase">{t("cl.ms.n", { n: m.position })}</p>
          <h3 className="font-display text-lg leading-snug font-semibold">{m.title}</h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-3">
            <MilestoneStamp state={m.state} />
            {m.due_date && <span>{t("cl.ms.due", { date: day(m.due_date) })}</span>}
            {m.released_at && <span>{t("cl.ms.releasedOn", { date: day(m.released_at) })}</span>}
          </p>
        </div>
        <p className="num font-display text-xl font-semibold whitespace-nowrap">{m.amount.display}</p>
      </div>

      {m.state === "DELIVERED" && <AutoReleaseCountdown at={m.auto_release_at} className="mt-2 block font-medium" />}
      {m.state === "DELIVERED" && <p className="mt-1 max-w-[70ch] text-sm text-ink-2">{t("cl.ms.reviewHint")}</p>}
      {m.state === "REVISION_REQUESTED" && <p className="mt-2 text-sm text-ink-2">{t("cl.ms.revisionWaiting", { name: contract.freelancer.name })}</p>}
      {(m.state === "FUNDED" || m.state === "IN_PROGRESS") && <p className="mt-2 text-sm text-ink-2">{t("cl.ms.heldWorking", { name: contract.freelancer.name })}</p>}
      {m.state === "DISPUTED" && (
        <div className="mt-2 rounded-md bg-alert-soft p-3 text-sm text-alert-ink">
          <p className="font-semibold">{t("cl.ms.disputedTitle")}</p>
          {m.dispute_reason && <p className="mt-1 whitespace-pre-line">{m.dispute_reason}</p>}
          <p className="mt-1">{t("cl.ms.disputedBody")}</p>
        </div>
      )}

      {showDelivery && detail && (note || detail.deliverables.length > 0) && (
        <div className="mt-3 flex flex-col gap-2 border-t border-dashed border-rule-strong pt-3">
          {note && (
            <blockquote className="border-l-2 border-accent pl-3 text-sm text-ink-2">
              <p className="text-xs font-semibold text-ink-3">{t("cl.ms.deliveryNote", { name: contract.freelancer.name })}</p>
              <p className="mt-1 whitespace-pre-line">{note}</p>
            </blockquote>
          )}
          {detail.deliverables.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold">{t("cl.ms.deliverables")}</h4>
              <ul className="mt-1 flex flex-col">
                {detail.deliverables.map((d) => (
                  <li key={d.attachment_id}>
                    <a href={d.url} download className="inline-flex min-h-11 items-center gap-2 text-sm text-accent hover:underline">
                      <span>{d.file_name}</span>
                      <span className="text-ink-3">({fileSize(d.size_bytes, locale)})</span>
                      <span className="sr-only">, {t("shared.th.download")}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {invoice && (
        <Link href={`${base}/invoices/${invoice.invoice_id}`} className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline">
          {t("cl.ms.invoice", { number: invoice.number })}
        </Link>
      )}

      <MilestoneActions m={m} contract={contract} onDone={onDone} onError={onError} />
    </li>
  );
}

function ProjectThread({ contractId, initial }: { contractId: string; initial: string | null }) {
  const { t } = useI18n();
  const [threadId, setThreadId] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (threadId) return <ThreadPanel threadId={threadId} role="CLIENT" compact />;
  return (
    <div className="flex flex-col items-start gap-2 rounded-[10px] border border-dashed border-rule-strong bg-sheet p-4">
      <p className="text-sm text-ink-3">{t("cl.proj.noThread")}</p>
      {error && (
        <p role="alert" className="text-sm text-alert-ink">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const r = await api<{ thread_id: string }>(`/api/contracts/${contractId}/thread`, { method: "POST" });
            setThreadId(r.thread_id);
          } catch (err) {
            setError(err instanceof Error ? err.message : t("cl.err.generic"));
          } finally {
            setBusy(false);
          }
        }}
        className={`${btn} bg-ink text-sheet`}
      >
        {t("cl.proj.startThread")}
      </button>
    </div>
  );
}

export function ProjectView({ contract, details, paypalClientId, paymentCancelled }: { contract: ProjectContract; details: Record<string, MilestoneDetail>; paypalClientId: string | null; paymentCancelled: boolean }) {
  const { t } = useI18n();
  const base = useGigBase();
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelPlan, setCancelPlan] = useState(false);
  const [busy, setBusy] = useState(false);

  usePageAssistant({ agent: "HIRING", contextLabel: contract.title });

  const next = contract.milestones.find((m) => m.state === "AWAITING_FUNDING");
  const canFund = next && (contract.status === "DRAFT" || contract.status === "ACTIVE");
  const nothingPaid = contract.status === "DRAFT" && !contract.payments.some((p) => p.status === "PENDING" || p.status === "COMPLETED");
  const live = contract.milestones.filter((m) => m.state !== "CANCELLED");
  const accepted = live.filter((m) => m.state === "ACCEPTED").length;

  const done = useCallback(
    (msg: string) => {
      setError(null);
      setNotice(msg);
      router.refresh();
    },
    [router],
  );
  const fail = useCallback((msg: string) => {
    setNotice(null);
    setError(msg);
  }, []);

  const onPaid = useCallback(
    (o: MilestoneCaptureOutcome) => {
      const n = contract.milestones.find((m) => m.milestone_id === o.milestone_id)?.position ?? 1;
      done(o.payment_status === "COMPLETED" ? t("cl.fund.paid", { n, amount: o.amount.display }) : t("cl.fund.pending", { n, amount: o.amount.display }));
    },
    [contract.milestones, done, t],
  );

  async function dropPlan() {
    setBusy(true);
    try {
      await api(`/api/contracts/${contract.contract_id}`, { method: "DELETE" });
      setCancelPlan(false);
      router.push(`${base}/projects`);
      router.refresh();
    } catch (err) {
      setCancelPlan(false);
      fail(err instanceof Error ? err.message : t("cl.err.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t("cl.proj.breadcrumb")}>
        <Link href={`${base}/projects`} className="inline-flex min-h-11 items-center text-sm text-accent hover:underline">
          {t("cl.proj.back")}
        </Link>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm text-ink-3">
            <CountryStamp country={contract.freelancer.country} />
            <span>{t("cl.proj.with", { name: contract.freelancer.name })}</span>
            <span>·</span>
            <span>{t(`cl.proj.status.${contract.status as "DRAFT"}`)}</span>
          </p>
          <h1 className="font-display mt-1 text-[1.8rem] leading-tight font-bold tracking-[-0.025em] md:text-[2.2rem]">{contract.title}</h1>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm bq-sm:grid-cols-4">
          <div>
            <dt className="text-ink-3">{t("cl.proj.total")}</dt>
            <dd className="num font-display text-lg font-semibold">{contract.total.display}</dd>
          </div>
          <div>
            <dt className="text-ink-3">{t("shared.led.col.inHolding")}</dt>
            <dd className="num font-display text-lg font-semibold">{contract.in_holding.display}</dd>
          </div>
          <div>
            <dt className="text-ink-3">{t("cl.proj.released")}</dt>
            <dd className="num font-display text-lg font-semibold">{contract.released.display}</dd>
          </div>
          <div>
            <dt className="text-ink-3">{t("cl.proj.progressShort")}</dt>
            <dd className="num font-display text-lg font-semibold">{t("cl.proj.ofTotal", { done: accepted, total: live.length })}</dd>
          </div>
        </dl>
      </header>

      {paymentCancelled && !notice && (
        <p role="status" className="rounded-md border border-gold-soft bg-gold-soft px-4 py-2.5 text-sm text-gold-ink">
          {t("cl.fund.cancelled")}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-md bg-positive-soft px-4 py-2.5 text-sm text-positive-ink">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-alert-soft px-4 py-2.5 text-sm text-alert-ink">
          {error}
        </p>
      )}

      <div className="grid gap-6 bq-lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          {canFund && next && (
            <section aria-labelledby="fund-title" className="overflow-hidden rounded-[12px] border border-rule bg-sheet shadow-[var(--shadow-overlay)]">
              <div className="grid bq-md:grid-cols-[minmax(0,1fr)_18rem]">
                <div className="p-5">
                  <h2 id="fund-title" className="font-display text-xl font-semibold">
                    {t("cl.fund.title", { n: next.position })}
                  </h2>
                  <p className="mt-1 text-sm text-ink-2">{next.title}</p>
                  <p className="num font-display mt-3 text-3xl leading-none font-bold tracking-[-0.03em]">{next.amount.display}</p>
                  <p className="mt-3 max-w-[60ch] text-sm text-ink-2">{t("cl.fund.held", { name: contract.freelancer.name })}</p>
                  <p className="mt-1 max-w-[60ch] text-xs text-ink-3">{t("cl.fund.onlyThis")}</p>
                </div>
                <div className="border-t border-dashed border-rule-strong bg-sheet-2 p-5 bq-md:border-t-0 bq-md:border-l">
                  <PayPalButtons clientId={paypalClientId} currency={contract.currency} contractId={contract.contract_id} onPaid={onPaid} />
                </div>
              </div>
            </section>
          )}

          <section aria-labelledby="ms-title">
            <h2 id="ms-title" className="font-display mb-3 text-xl font-semibold">
              {t("cl.proj.milestones")}
            </h2>
            <ol className="flex flex-col gap-4">
              {contract.milestones.map((m) => (
                <MilestoneCard key={m.milestone_id} m={m} contract={contract} detail={details[m.milestone_id]} onDone={done} onError={fail} />
              ))}
            </ol>
            {nothingPaid && (
              <button type="button" onClick={() => setCancelPlan(true)} className="mt-4 inline-flex min-h-11 items-center text-sm text-ink-3 underline-offset-2 hover:text-alert-ink hover:underline">
                {t("cl.proj.cancelPlan")}
              </button>
            )}
          </section>

          <details className="rounded-[10px] border border-rule bg-sheet p-4">
            <summary className="min-h-11 cursor-pointer py-2 font-medium">{t("cl.proj.scope")}</summary>
            <p className="mt-2 text-sm whitespace-pre-line text-ink-2">{contract.scope}</p>
            <p className="mt-2 text-sm text-ink-3">{t("cl.proj.revisionsAllowed", { n: contract.revisions_allowed })}</p>
          </details>
        </div>

        <section aria-labelledby="thread-title" className="flex min-w-0 flex-col gap-3">
          <h2 id="thread-title" className="font-display text-xl font-semibold">
            {t("cl.proj.thread")}
          </h2>
          <ProjectThread contractId={contract.contract_id} initial={contract.thread?.thread_id ?? null} />
        </section>
      </div>

      <ConfirmDialog
        open={cancelPlan}
        title={t("cl.proj.cancelPlanTitle")}
        confirmLabel={t("cl.proj.cancelPlan")}
        cancelLabel={t("cl.common.keep")}
        busy={busy}
        onConfirm={dropPlan}
        onCancel={() => setCancelPlan(false)}
      >
        <p>{t("cl.proj.cancelPlanBody")}</p>
      </ConfirmDialog>
    </div>
  );
}
