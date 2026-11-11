"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api, type Money } from "../../api";
import { usePageAssistant } from "../../assistant/AssistantContext";
import { useI18n } from "../../i18n/I18nProvider";
import { IconMessages, IconSearch } from "../../icons";
import { CountryStamp } from "../../ui";
import { useGigBase } from "../use-gig-base";
import { languageName } from "./format";
import { PlanEditor } from "./PlanEditor";

/**
 * Client search over the published services in their market (GET /api/find?q=),
 * side-by-side comparison of up to four (GET /api/find?ids=), and per service:
 * ask the freelancer, request a quote, or hire a package with a milestone plan.
 */

type Tier = "BASIC" | "STANDARD" | "PREMIUM";

export type FindResult = {
  service_page_id: string;
  freelancer_id: string;
  freelancer: string;
  based_in: string;
  headline: string;
  title: string;
  summary: string;
  pricing: "PACKAGES" | "HOURLY" | string;
  from_price: Money | null;
  hourly_rate: Money | null;
  rating: number | null;
  rating_count: number;
};

type Compared = {
  service_page_id: string;
  freelancer: { name: string; based_in: string; time_zone: string; languages: string[]; skills: string[]; availability: string; milestones_delivered_and_accepted: number };
  title: string;
  description: string;
  rating: number | null;
  rating_count: number;
  pricing: string;
  hourly_rate: Money | null;
  packages: { tier: Tier; scope: string; delivery_days: number; revisions: number; price: Money | null }[];
};

type Brief = { brief_id: string; title: string; status: string };

const MAX_COMPARE = 4;
const fieldCls = "rounded-md border border-rule-strong bg-sheet px-3 py-2 text-sm placeholder:text-ink-3 focus:border-accent";

function Rating({ rating, count }: { rating: number | null; count: number }) {
  const { t } = useI18n();
  if (rating === null) return <span className="text-ink-3">{t("cl.find.noRating")}</span>;
  return (
    <span className="num" title={t("shop.ratings", { n: count })}>
      {t("shop.rating", { r: rating.toFixed(1) })} <span className="text-ink-3">({count})</span>
    </span>
  );
}

function priceLine(t: ReturnType<typeof useI18n>["t"], r: { pricing: string; from_price: Money | null; hourly_rate: Money | null }): string | null {
  if (r.pricing === "HOURLY" && r.hourly_rate) return t("cl.find.hourly", { price: r.hourly_rate.display });
  if (r.from_price) return t("land.from", { price: r.from_price.display });
  if (r.hourly_rate) return t("cl.find.hourly", { price: r.hourly_rate.display });
  return null;
}

function AskForm({ result }: { result: FindResult }) {
  const { t } = useI18n();
  const base = useGigBase();
  const id = useId();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  if (sent) {
    return (
      <p role="status" className="text-sm text-positive-ink">
        {t("shop.sent")}{" "}
        <Link href={`${base}/messages?c=${sent}`} className="font-medium text-accent underline">
          {t("shop.openConv")}
        </Link>
      </p>
    );
  }
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const r = await api<{ id: string }>("/api/threads", { body: { service_page_id: result.service_page_id, body } });
          setSent(r.id);
          window.dispatchEvent(new Event("gc:unread-changed"));
        } catch (err) {
          setError(err instanceof Error ? err.message : t("msg.failed"));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor={id} className="text-sm font-medium">
        {t("cl.find.askLabel", { name: result.freelancer })}
      </label>
      <textarea id={id} rows={3} value={body} maxLength={4000} required onChange={(e) => setBody(e.target.value)} placeholder={t("cl.find.askPh")} className={fieldCls} />
      <p className="text-xs text-ink-3">{t("cl.find.askNote")}</p>
      {error && (
        <p role="alert" className="text-sm text-alert-ink">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy || !body.trim()} className="min-h-11 rounded-md bg-ink px-3 text-sm font-semibold text-sheet disabled:opacity-50">
        {busy ? t("shop.sending") : t("shop.send")}
      </button>
    </form>
  );
}

function QuoteForm({ result, briefs }: { result: FindResult; briefs: Brief[] | null }) {
  const { t } = useI18n();
  const base = useGigBase();
  const id = useId();
  const [message, setMessage] = useState("");
  const [briefId, setBriefId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"new" | "again" | null>(null);
  if (done) {
    return (
      <p role="status" className="text-sm text-positive-ink">
        {done === "again" ? t("cl.find.quoteAgain") : t("cl.find.quoteSent", { name: result.freelancer })}{" "}
        <Link href={`${base}/quotes`} className="font-medium text-accent underline">
          {t("cl.find.seeQuotes")}
        </Link>
      </p>
    );
  }
  const open = (briefs ?? []).filter((b) => b.status !== "CLOSED");
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const r = await api<{ already_requested?: boolean }>("/api/quotes", { body: { service_page_id: result.service_page_id, brief_id: briefId || null, message } });
          setDone(r.already_requested ? "again" : "new");
        } catch (err) {
          setError(err instanceof Error ? err.message : t("cl.err.generic"));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("cl.find.quoteBrief")}</span>
        <select value={briefId} onChange={(e) => setBriefId(e.target.value)} className={`min-h-11 ${fieldCls}`} disabled={briefs === null}>
          <option value="">{briefs === null ? t("cl.common.loading") : t("cl.find.noBrief")}</option>
          {open.map((b) => (
            <option key={b.brief_id} value={b.brief_id}>
              {b.title}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={id} className="text-sm font-medium">
        {t("cl.find.quoteMsg")}
      </label>
      <textarea id={id} rows={4} value={message} maxLength={4000} required onChange={(e) => setMessage(e.target.value)} placeholder={t("cl.find.quotePh")} className={fieldCls} />
      <p className="text-xs text-ink-3">{t("cl.find.quoteNote")}</p>
      {error && (
        <p role="alert" className="text-sm text-alert-ink">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy || !message.trim()} className="min-h-11 rounded-md bg-ink px-3 text-sm font-semibold text-sheet disabled:opacity-50">
        {busy ? t("shop.sending") : t("cl.find.quoteSend")}
      </button>
    </form>
  );
}

function PackagePicker({ packages, value, onChange, name }: { packages: Compared["packages"]; value: Tier | null; onChange: (tier: Tier) => void; name: string }) {
  const { t } = useI18n();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{t("cl.find.pickTier")}</legend>
      {packages.map((p) => (
        <label
          key={p.tier}
          className={`flex cursor-pointer gap-3 rounded-md border p-3 text-sm ${value === p.tier ? "border-accent bg-accent-soft" : "border-rule-strong bg-sheet hover:border-accent/70"} ${p.price ? "" : "cursor-not-allowed opacity-50"}`}
        >
          <input type="radio" name={name} value={p.tier} checked={value === p.tier} disabled={!p.price} onChange={() => onChange(p.tier)} className="mt-1 h-4 w-4 accent-[var(--color-accent)]" />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold">{t(`cl.tier.${p.tier}`)}</span>
              <span className="num font-display text-base font-semibold">{p.price?.display ?? t("cl.find.noPrice")}</span>
            </span>
            <span className="mt-0.5 block text-ink-3">{t("cl.find.pkgFacts", { days: p.delivery_days, revisions: p.revisions })}</span>
            <span className="mt-1 block whitespace-pre-line text-ink-2">{p.scope}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function HirePanel({ result }: { result: FindResult }) {
  const { t } = useI18n();
  const base = useGigBase();
  const router = useRouter();
  const name = useId();
  const [service, setService] = useState<Compared | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tier, setTier] = useState<Tier | null>(null);
  useEffect(() => {
    let alive = true;
    api<{ services: Compared[] }>(`/api/find?ids=${result.service_page_id}`)
      .then((r) => alive && setService(r.services[0] ?? null))
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : t("cl.err.generic")));
    return () => {
      alive = false;
    };
  }, [result.service_page_id, t]);
  if (error) {
    return (
      <p role="alert" className="text-sm text-alert-ink">
        {error}
      </p>
    );
  }
  if (!service) return <p className="text-sm text-ink-3">{t("cl.common.loading")}</p>;
  if (service.packages.length === 0) return <p className="text-sm text-ink-3">{t("cl.find.noPackages")}</p>;
  const chosen = service.packages.find((p) => p.tier === tier);
  return (
    <div className="flex flex-col gap-3">
      <PackagePicker packages={service.packages} value={tier} onChange={setTier} name={name} />
      {chosen?.price && (
        <PlanEditor
          key={chosen.tier}
          total={chosen.price}
          source={{ service_page_id: service.service_page_id, tier: chosen.tier }}
          onCreated={(contractId) => router.push(`${base}/projects/${contractId}`)}
          onCancel={() => setTier(null)}
        />
      )}
    </div>
  );
}

type Action = "ask" | "quote" | "hire";

function ResultCard({
  r,
  open,
  onOpen,
  compared,
  compareFull,
  onCompare,
  briefs,
  wantBriefs,
}: {
  r: FindResult;
  open: Action | null;
  onOpen: (a: Action | null) => void;
  compared: boolean;
  compareFull: boolean;
  onCompare: (on: boolean) => void;
  briefs: Brief[] | null;
  wantBriefs: () => void;
}) {
  const { t } = useI18n();
  const price = priceLine(t, r);
  const actionBtn = (a: Action, label: string, primary = false) => (
    <button
      type="button"
      aria-expanded={open === a}
      onClick={() => {
        if (a === "quote") wantBriefs();
        onOpen(open === a ? null : a);
      }}
      className={
        primary
          ? `inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold ${open === a ? "bg-ink text-sheet" : "bg-accent text-sheet"}`
          : `inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 text-sm font-medium ${open === a ? "border-ink bg-ink text-sheet" : "border-rule-strong hover:border-accent hover:text-accent"}`
      }
    >
      {a === "ask" && <IconMessages className="h-4 w-4" />}
      {label}
    </button>
  );
  return (
    <li id={`svc-${r.service_page_id}`} className="flex scroll-mt-24 flex-col rounded-[10px] border border-rule bg-sheet p-4 transition-colors hover:border-accent/70">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
            <CountryStamp country={r.based_in} />
            <span className="font-semibold text-ink">{r.freelancer}</span>
            <span className="text-ink-3">·</span>
            <Rating rating={r.rating} count={r.rating_count} />
          </p>
          <p className="mt-1 text-sm text-ink-3">{r.headline}</p>
          <h2 className="font-display mt-2 text-lg leading-snug font-semibold">{r.title}</h2>
        </div>
        {price && <p className="num font-display text-xl font-semibold whitespace-nowrap">{price}</p>}
      </div>
      <p className="mt-2 text-sm text-ink-2">{r.summary}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {actionBtn("hire", t("cl.find.hire"), true)}
        {actionBtn("quote", t("cl.find.quote"))}
        {actionBtn("ask", t("cl.find.ask"))}
        <label className="ml-auto inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={compared} disabled={!compared && compareFull} onChange={(e) => onCompare(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
          {t("cl.find.compare")}
        </label>
      </div>
      {open && (
        <div className="mt-3 border-t border-dashed border-rule-strong pt-3">
          {open === "ask" && <AskForm result={r} />}
          {open === "quote" && <QuoteForm result={r} briefs={briefs} />}
          {open === "hire" && <HirePanel result={r} />}
        </div>
      )}
    </li>
  );
}

function CompareTable({ ids, hireable, onHire, onClose }: { ids: string[]; hireable: string[]; onHire: (id: string) => void; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [services, setServices] = useState<Compared[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = ids.join(",");
  useEffect(() => {
    let alive = true;
    api<{ services: Compared[] }>(`/api/find?ids=${key}`)
      .then((r) => {
        if (!alive) return;
        setServices(r.services);
        setError(null);
      })
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : t("cl.err.generic")));
    return () => {
      alive = false;
    };
  }, [key, t]);
  const tiers: Tier[] = ["BASIC", "STANDARD", "PREMIUM"];
  const headCls = "py-2 pr-3 text-left align-top text-xs font-semibold tracking-[0.04em] text-ink-3 uppercase";
  return (
    <section aria-labelledby="compare-title" className="rounded-[10px] border border-rule bg-sheet p-4 md:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="compare-title" className="font-display text-xl font-semibold">
          {t("cl.find.compareTitle", { n: ids.length })}
        </h2>
        <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-ink-3 hover:text-ink hover:underline">
          {t("cl.find.compareClose")}
        </button>
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-alert-soft p-3 text-sm text-alert-ink">
          {error}
        </p>
      )}
      {!services && !error && <div className="h-40 animate-pulse rounded-md bg-sheet-2" aria-hidden />}
      {services && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <caption className="sr-only">{t("cl.find.compareTitle", { n: services.length })}</caption>
            <thead>
              <tr className="border-b border-rule-strong">
                <td />
                {services.map((s) => (
                  <th key={s.service_page_id} scope="col" className="min-w-[12rem] py-2 pr-3 text-left align-top">
                    <span className="flex items-center gap-2">
                      <CountryStamp country={s.freelancer.based_in} />
                      <span className="font-semibold">{s.freelancer.name}</span>
                    </span>
                    <span className="mt-1 block font-normal text-ink-2">{s.title}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier) => (
                <tr key={tier} className="border-b border-rule">
                  <th scope="row" className={headCls}>
                    {t(`cl.tier.${tier}`)}
                  </th>
                  {services.map((s) => {
                    const p = s.packages.find((x) => x.tier === tier);
                    return (
                      <td key={s.service_page_id} className="py-2 pr-3 align-top">
                        {p ? (
                          <>
                            <span className="num block font-semibold">{p.price?.display ?? t("cl.find.noPrice")}</span>
                            <span className="block text-ink-3">{t("cl.find.pkgFacts", { days: p.delivery_days, revisions: p.revisions })}</span>
                            <span className="mt-1 block text-ink-2">{p.scope}</span>
                          </>
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-b border-rule">
                <th scope="row" className={headCls}>
                  {t("cl.find.hourlyRate")}
                </th>
                {services.map((s) => (
                  <td key={s.service_page_id} className="num py-2 pr-3 align-top">
                    {s.hourly_rate ? t("cl.find.hourly", { price: s.hourly_rate.display }) : "—"}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-rule">
                <th scope="row" className={headCls}>
                  {t("cl.find.languages")}
                </th>
                {services.map((s) => (
                  <td key={s.service_page_id} className="py-2 pr-3 align-top">
                    {s.freelancer.languages.map((l) => languageName(l, locale)).join(", ")}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-rule">
                <th scope="row" className={headCls}>
                  {t("cl.find.timeZone")}
                </th>
                {services.map((s) => (
                  <td key={s.service_page_id} className="py-2 pr-3 align-top">
                    {s.freelancer.time_zone}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-rule">
                <th scope="row" className={headCls}>
                  {t("cl.find.rating")}
                </th>
                {services.map((s) => (
                  <td key={s.service_page_id} className="py-2 pr-3 align-top">
                    <Rating rating={s.rating} count={s.rating_count} />
                  </td>
                ))}
              </tr>
              <tr className="border-b border-rule">
                <th scope="row" className={headCls}>
                  {t("cl.find.track")}
                </th>
                {services.map((s) => (
                  <td key={s.service_page_id} className="num py-2 pr-3 align-top">
                    {t("cl.find.accepted", { n: s.freelancer.milestones_delivered_and_accepted })}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-rule">
                <th scope="row" className={headCls}>
                  {t("cl.find.availability")}
                </th>
                {services.map((s) => (
                  <td key={s.service_page_id} className="py-2 pr-3 align-top">
                    {["AVAILABLE", "LIMITED", "UNAVAILABLE"].includes(s.freelancer.availability) ? t(`cl.avail.${s.freelancer.availability as "AVAILABLE"}`) : s.freelancer.availability}
                  </td>
                ))}
              </tr>
              <tr>
                <td />
                {services.map((s) => (
                  <td key={s.service_page_id} className="py-3 pr-3">
                    {hireable.includes(s.service_page_id) && (
                      <button type="button" onClick={() => onHire(s.service_page_id)} className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-semibold text-sheet">
                        {t("cl.find.hire")}
                      </button>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function FindServices({ market, initialQuery }: { market: string; initialQuery: string }) {
  const { t } = useI18n();
  const inputId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<FindResult[] | null>(null);
  const [mode, setMode] = useState<"semantic" | "keyword" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; action: Action } | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [briefs, setBriefs] = useState<Brief[] | null>(null);
  const briefsAsked = useRef(false);

  usePageAssistant({ agent: "HIRING", resumeKey: market });

  const search = useCallback(
    async (q: string) => {
      const text = q.trim();
      if (!text) return;
      setBusy(true);
      setError(null);
      try {
        const r = await api<{ mode: "semantic" | "keyword"; results: FindResult[] }>(`/api/find?q=${encodeURIComponent(text)}`);
        setResults(r.results);
        setMode(r.mode);
        setOpen(null);
        const url = new URL(window.location.href);
        url.searchParams.set("q", text);
        window.history.replaceState(null, "", url);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("cl.err.generic"));
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  const first = useRef(initialQuery);
  useEffect(() => {
    if (first.current) void search(first.current);
    first.current = "";
  }, [search]);

  const wantBriefs = useCallback(() => {
    if (briefsAsked.current) return;
    briefsAsked.current = true;
    api<{ briefs: Brief[] }>("/api/briefs")
      .then((r) => setBriefs(r.briefs))
      .catch(() => setBriefs([]));
  }, []);

  const hireFromCompare = (id: string) => {
    setOpen({ id, action: "hire" });
    window.requestAnimationFrame(() => document.getElementById(`svc-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em] md:text-[2.4rem]">{t("cl.find.title")}</h1>
        <p className="mt-1 max-w-[65ch] text-ink-3">{t("cl.find.intro")}</p>
      </header>

      <form
        role="search"
        className="flex flex-col gap-2 bq-sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void search(query);
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          {t("cl.find.label")}
        </label>
        <div className="relative flex-1">
          <IconSearch className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <input
            id={inputId}
            type="search"
            value={query}
            maxLength={300}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("cl.find.placeholder")}
            className="min-h-12 w-full rounded-md border border-rule-strong bg-sheet py-2 pr-3 pl-9 text-base placeholder:text-ink-3 focus:border-accent"
          />
        </div>
        <button type="submit" disabled={busy || !query.trim()} className="min-h-12 rounded-md bg-accent px-6 font-semibold text-sheet disabled:opacity-50">
          {busy ? t("cl.find.searching") : t("cl.find.search")}
        </button>
      </form>

      {error && (
        <p role="alert" className="rounded-md bg-alert-soft p-3 text-sm text-alert-ink">
          {error}
        </p>
      )}

      {compare.length > 0 && (
        <div className="sticky top-14 z-20 flex flex-wrap items-center gap-3 rounded-md border border-rule bg-sheet/95 px-4 py-2 shadow-[var(--shadow-overlay)] backdrop-blur" role="region" aria-label={t("cl.find.compare")}>
          <span className="text-sm">{t("cl.find.selected", { n: compare.length, max: MAX_COMPARE })}</span>
          <button
            type="button"
            disabled={compare.length < 2}
            onClick={() => setShowCompare(true)}
            className="inline-flex min-h-11 items-center rounded-md bg-ink px-4 text-sm font-semibold text-sheet disabled:opacity-50"
          >
            {t("cl.find.compareN", { n: compare.length })}
          </button>
          <button type="button" onClick={() => (setCompare([]), setShowCompare(false))} className="inline-flex min-h-11 items-center px-2 text-sm text-ink-3 hover:text-ink hover:underline">
            {t("cl.find.clear")}
          </button>
          {compare.length < 2 && <span className="text-xs text-ink-3">{t("cl.find.pickTwo")}</span>}
        </div>
      )}

      {showCompare && compare.length >= 2 && <CompareTable ids={compare} hireable={(results ?? []).map((r) => r.service_page_id)} onHire={hireFromCompare} onClose={() => setShowCompare(false)} />}

      {results === null && !busy && <p className="text-ink-3">{t("cl.find.start")}</p>}
      {busy && results === null && <div className="h-48 animate-pulse rounded-[10px] border border-rule bg-sheet-2" aria-hidden />}

      {results && (
        <section aria-labelledby="results-title" aria-busy={busy}>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="results-title" className="font-display text-xl font-semibold" aria-live="polite">
              {t("cl.find.results", { n: results.length })}
            </h2>
            {mode === "keyword" && <p className="text-xs text-ink-3">{t("cl.find.keywordMode")}</p>}
          </div>
          {results.length === 0 ? (
            <p className="text-ink-3">{t("cl.find.none")}</p>
          ) : (
            <ul className="grid gap-4 bq-lg:grid-cols-2">
              {results.map((r) => (
                <ResultCard
                  key={r.service_page_id}
                  r={r}
                  open={open?.id === r.service_page_id ? open.action : null}
                  onOpen={(a) => setOpen(a ? { id: r.service_page_id, action: a } : null)}
                  compared={compare.includes(r.service_page_id)}
                  compareFull={compare.length >= MAX_COMPARE}
                  onCompare={(on) => setCompare((c) => (on ? (c.includes(r.service_page_id) || c.length >= MAX_COMPARE ? c : [...c, r.service_page_id]) : c.filter((x) => x !== r.service_page_id)))}
                  briefs={briefs}
                  wantBriefs={wantBriefs}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
