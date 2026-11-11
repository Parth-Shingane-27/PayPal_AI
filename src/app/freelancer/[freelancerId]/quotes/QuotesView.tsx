"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { api, decimalOf, type Money } from "@/components/api";
import { usePageAssistant } from "@/components/assistant/AssistantContext";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { dateText, errText, field, h1Cls, h2Cls, labelCls, MARKET_CURRENCY, Notice, primaryBtn, secondaryBtn, Skeleton } from "@/components/gig/freelancer/shared";
import { useI18n } from "@/components/i18n/I18nProvider";
import { MarketStamp } from "@/components/ui";
import type { MessageKey } from "@/lib/i18n/messages";

type QuoteStatus = "REQUESTED" | "SENT" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "WITHDRAWN";
type Quote = {
  quote_id: string;
  status: QuoteStatus;
  market: string;
  request_message: string;
  total: Money | null;
  delivery_days: number | null;
  revisions: number | null;
  scope: string | null;
  message: string | null;
  requested_at: string;
  sent_at: string | null;
  expires_at: string | null;
  client?: { name: string };
};

const STATUS_CLS: Record<QuoteStatus, string> = {
  REQUESTED: "bg-gold-soft text-gold-ink",
  SENT: "bg-accent-soft text-ink",
  ACCEPTED: "bg-positive-soft text-positive-ink",
  DECLINED: "bg-sheet-2 text-ink-2",
  EXPIRED: "bg-sheet-2 text-ink-3",
  WITHDRAWN: "bg-sheet-2 text-ink-3",
};

function PriceForm({ q, onSent, onCancel }: { q: Quote; onSent: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const id = useId();
  const currency = q.total?.currency ?? MARKET_CURRENCY[q.market] ?? "";
  const [form, setForm] = useState({
    total: q.total ? decimalOf(q.total) : "",
    delivery_days: q.delivery_days ? String(q.delivery_days) : "",
    revisions: q.revisions !== null ? String(q.revisions) : "1",
    scope: q.scope ?? "",
    message: q.message ?? "",
    valid_days: "14",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/quotes/${q.quote_id}`, {
        method: "PUT",
        body: {
          total: form.total.trim(),
          delivery_days: Number(form.delivery_days),
          revisions: Number(form.revisions),
          scope: form.scope,
          message: form.message.trim() ? form.message : null,
          valid_days: Number(form.valid_days),
        },
      });
      onSent();
    } catch (err) {
      setError(errText(err, t("fl.q.sendFailed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={send} aria-labelledby={`${id}-h`} className="mt-3 flex flex-col gap-3 rounded-md border border-rule bg-sheet-2/50 p-3">
      <h4 id={`${id}-h`} className="font-semibold">
        {q.status === "SENT" ? t("fl.q.revise") : t("fl.q.sendPrice")}
      </h4>
      <div className="grid gap-3 cq-sm:grid-cols-2 cq-lg:grid-cols-4">
        <label className={labelCls}>
          {t("fl.q.total", { currency })}
          <input className={`${field} num`} inputMode="decimal" required pattern="\d+(\.\d+)?" value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} />
        </label>
        <label className={labelCls}>
          {t("fl.svc.deliveryDays")}
          <input className={`${field} num`} type="number" min={1} max={365} required value={form.delivery_days} onChange={(e) => setForm({ ...form, delivery_days: e.target.value })} />
        </label>
        <label className={labelCls}>
          {t("fl.svc.revisions")}
          <input className={`${field} num`} type="number" min={0} max={20} required value={form.revisions} onChange={(e) => setForm({ ...form, revisions: e.target.value })} />
        </label>
        <label className={labelCls}>
          {t("fl.q.validDays")}
          <input className={`${field} num`} type="number" min={1} max={60} required value={form.valid_days} onChange={(e) => setForm({ ...form, valid_days: e.target.value })} />
        </label>
      </div>
      <label className={labelCls}>
        {t("fl.svc.scope")}
        <textarea className={`${field} py-2`} rows={3} required minLength={10} maxLength={4000} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} />
      </label>
      <label className={labelCls}>
        {t("fl.q.message")}
        <textarea className={`${field} py-2`} rows={2} maxLength={4000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
      </label>
      <p className="text-xs text-ink-3">{t("fl.q.formNote")}</p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={primaryBtn} disabled={busy}>
          {busy ? t("fl.q.sending") : q.status === "SENT" ? t("fl.q.sendRevised") : t("fl.q.send")}
        </button>
        <button type="button" className={secondaryBtn} disabled={busy} onClick={onCancel}>
          {t("form.cancel")}
        </button>
      </div>
    </form>
  );
}

function QuoteCard({ q, open, onOpen, onClose, onChanged, onDecline }: { q: Quote; open: boolean; onOpen: () => void; onClose: () => void; onChanged: () => void; onDecline: () => void }) {
  const { t, locale } = useI18n();
  const canPrice = q.status === "REQUESTED" || q.status === "SENT";
  return (
    <li className="rounded-[10px] border border-rule bg-sheet p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-ink">{q.client?.name ?? t("fl.q.client")}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-ink-3">
            <MarketStamp locale={q.market} />
            <span>{t("fl.q.requestedOn", { date: dateText(q.requested_at, locale) })}</span>
          </p>
        </div>
        <span className={`rounded-[3px] px-2 py-0.5 text-xs font-semibold ${STATUS_CLS[q.status]}`}>{t(`fl.q.status.${q.status}` as MessageKey)}</span>
      </div>
      <blockquote lang={q.market} className="mt-3 border-l-2 border-rule-strong pl-3 text-[0.95rem] whitespace-pre-wrap text-ink-2">
        {q.request_message}
      </blockquote>
      {q.total && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm cq-sm:grid-cols-4">
          <div>
            <dt className="text-ink-3">{t("fl.q.price")}</dt>
            <dd className="num font-semibold">{q.total.display}</dd>
          </div>
          <div>
            <dt className="text-ink-3">{t("fl.svc.deliveryDays")}</dt>
            <dd className="num">{q.delivery_days}</dd>
          </div>
          <div>
            <dt className="text-ink-3">{t("fl.svc.revisions")}</dt>
            <dd className="num">{q.revisions}</dd>
          </div>
          {q.expires_at && (
            <div>
              <dt className="text-ink-3">{t("fl.q.validUntil")}</dt>
              <dd>{dateText(q.expires_at, locale)}</dd>
            </div>
          )}
        </dl>
      )}
      {q.scope && !open && <p className="mt-2 line-clamp-3 text-sm text-ink-2">{q.scope}</p>}
      {canPrice && !open && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={primaryBtn} onClick={onOpen}>
            {q.status === "SENT" ? t("fl.q.revise") : t("fl.q.sendPrice")}
          </button>
          <button type="button" className={secondaryBtn} onClick={onDecline}>
            {t("fl.q.decline")}
          </button>
        </div>
      )}
      {open && <PriceForm q={q} onCancel={onClose} onSent={onChanged} />}
    </li>
  );
}

export function QuotesView() {
  const { t } = useI18n();
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [declining, setDeclining] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api<{ quotes: Quote[] }>("/api/quotes").then(
        (r) => {
          setQuotes(r.quotes);
          setError(null);
        },
        (e: unknown) => setError(errText(e, t("fl.error"))),
      ),
    [t],
  );
  useEffect(() => {
    void load();
  }, [load]);
  usePageAssistant({ agent: "PROJECTS", onResult: () => void load() });

  async function decline() {
    if (!declining) return;
    setBusy(true);
    try {
      await api(`/api/quotes/${declining.quote_id}`, { method: "DELETE" });
      setNotice(t("fl.q.declined"));
      await load();
    } catch (e) {
      setError(errText(e, t("fl.error")));
    } finally {
      setBusy(false);
      setDeclining(null);
    }
  }

  const groups: { key: string; title: string; empty: string; items: Quote[] }[] = [
    { key: "requested", title: t("fl.q.waiting"), empty: t("fl.q.noneWaiting"), items: (quotes ?? []).filter((q) => q.status === "REQUESTED") },
    { key: "sent", title: t("fl.q.sent"), empty: t("fl.q.noneSent"), items: (quotes ?? []).filter((q) => q.status === "SENT") },
  ];
  const closed = (quotes ?? []).filter((q) => q.status !== "REQUESTED" && q.status !== "SENT");

  const card = (q: Quote) => (
    <QuoteCard
      key={q.quote_id}
      q={q}
      open={open === q.quote_id}
      onOpen={() => setOpen(q.quote_id)}
      onClose={() => setOpen(null)}
      onDecline={() => setDeclining(q)}
      onChanged={() => {
        setOpen(null);
        setNotice(t("fl.q.sentOk"));
        void load();
      }}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="max-w-2xl">
        <h1 className={h1Cls}>{t("fl.nav.quotes")}</h1>
        <p className="mt-1 text-ink-3">{t("fl.q.intro")}</p>
      </header>
      {notice && <Notice tone="ok">{notice}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {!quotes && !error && <Skeleton />}
      {quotes &&
        groups.map((g) => (
          <section key={g.key} aria-labelledby={`q-${g.key}`}>
            <h2 id={`q-${g.key}`} className={`${h2Cls} mb-3`}>
              {g.title} <span className="num text-ink-3">({g.items.length})</span>
            </h2>
            {g.items.length === 0 ? <p className="text-sm text-ink-3">{g.empty}</p> : <ul className="flex flex-col gap-3">{g.items.map(card)}</ul>}
          </section>
        ))}
      {closed.length > 0 && (
        <details className="rounded-[10px] border border-rule bg-sheet">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 font-medium">
            {t("fl.q.closed")} <span className="num ml-1 text-ink-3">({closed.length})</span>
          </summary>
          <ul className="flex flex-col gap-3 p-3">{closed.map(card)}</ul>
        </details>
      )}

      <ConfirmDialog
        open={declining !== null}
        title={t("fl.q.declineTitle")}
        confirmLabel={busy ? t("fl.working") : t("fl.q.decline")}
        cancelLabel={t("form.cancel")}
        busy={busy}
        onConfirm={() => void decline()}
        onCancel={() => setDeclining(null)}
      >
        <p>{t("fl.q.declineBody", { client: declining?.client?.name ?? t("fl.q.client") })}</p>
      </ConfirmDialog>
    </div>
  );
}
