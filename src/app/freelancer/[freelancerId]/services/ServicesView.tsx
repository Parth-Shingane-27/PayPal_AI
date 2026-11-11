"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/components/api";
import { openAssistant, usePageAssistant } from "@/components/assistant/AssistantContext";
import { BodyPortal } from "@/components/BodyPortal";
import { errText, field, h1Cls, labelCls, MARKETS, Notice, primaryBtn, secondaryBtn } from "@/components/gig/freelancer/shared";
import { useI18n } from "@/components/i18n/I18nProvider";
import { IconClose, IconSpark } from "@/components/icons";
import type { MessageKey } from "@/lib/i18n/messages";
import { useBase } from "@/lib/use-base";

type Service = {
  service_id: string;
  code: string;
  title: string;
  category: string;
  pricing_model: "PACKAGES" | "HOURLY";
  markets: { market: string; status: "DRAFT" | "PUBLISHED" | "ARCHIVED" }[];
};

const TIERS = ["BASIC", "STANDARD", "PREMIUM"] as const;
type Tier = (typeof TIERS)[number];
type PackageForm = { tier: Tier; scope: string; delivery_days: string; revisions: string; estimated_hours: string };
const emptyPackage = (tier: Tier): PackageForm => ({ tier, scope: "", delivery_days: "", revisions: "1", estimated_hours: "" });

/** 11 market slots: filled = published, dashed = draft, faint = no page yet. */
function Coverage({ markets }: { markets: Service["markets"] }) {
  const { t } = useI18n();
  const by = new Map(markets.map((m) => [m.market, m.status]));
  return (
    <ul className="flex flex-wrap gap-1" aria-label={t("fl.svc.markets")}>
      {MARKETS.map((m) => {
        const s = by.get(m);
        const country = m.slice(3);
        const state = !s ? t("fl.svc.noPage") : t(`pe.status.${s}` as MessageKey);
        const cls = !s ? "border-rule text-ink-3/60" : s === "PUBLISHED" ? "border-accent bg-accent text-sheet" : s === "DRAFT" ? "border-dashed border-gold-ink text-gold-ink" : "border-rule text-ink-3 line-through";
        return (
          <li key={m}>
            <span title={`${t(`country.${country}` as MessageKey)} (${t(`langname.${m.slice(0, 2)}` as MessageKey)}): ${state}`} className={`inline-flex h-6 min-w-8 items-center justify-center rounded-[3px] border-[1.5px] px-1 text-[11px] font-bold tracking-wide ${cls}`}>
              {country}
              <span className="sr-only">: {state}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ServiceCard({ s }: { s: Service }) {
  const { t } = useI18n();
  const base = useBase();
  const live = s.markets.filter((m) => m.status === "PUBLISHED").length;
  const drafts = s.markets.filter((m) => m.status === "DRAFT").length;
  return (
    <li className="relative flex flex-col gap-3 rounded-[10px] border border-rule bg-sheet p-4 transition-colors focus-within:border-accent hover:border-accent/60">
      <div>
        <h2 className="font-display text-lg leading-snug font-semibold">
          <Link href={`${base}/services/${s.service_id}`} className="after:absolute after:inset-0 hover:text-accent">
            {s.title}
          </Link>
        </h2>
        <p className="mt-0.5 text-sm text-ink-3">
          {s.category}, <span className="num">{s.code}</span>, {s.pricing_model === "HOURLY" ? t("fl.svc.hourly") : t("fl.svc.packages")}
        </p>
      </div>
      <div>
        <p className="mb-1.5 text-sm text-ink-2">
          {t("fl.svc.liveOf", { n: live, m: MARKETS.length })}
          {drafts > 0 && <span className="text-gold-ink">, {t("prod.draftsToReview", { n: drafts })}</span>}
        </p>
        <Coverage markets={s.markets} />
      </div>
      <span className="relative z-10 mt-auto text-sm font-medium text-accent">{drafts > 0 ? t("prod.reviewDrafts") : t("pe.edit")}</span>
    </li>
  );
}

function NewServiceDrawer({ onClose, onCreated, onAskAi }: { onClose: () => void; onCreated: (id: string) => void; onAskAi: () => void }) {
  const { t } = useI18n();
  const id = useId();
  const first = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ code: "", title: "", description: "", source_locale: "en-US", category: "", pricing_model: "PACKAGES" as "PACKAGES" | "HOURLY" });
  const [packages, setPackages] = useState<PackageForm[]>([emptyPackage("BASIC")]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setPkg = (i: number, patch: Partial<PackageForm>) => setPackages((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const nextTier = TIERS.find((tier) => !packages.some((p) => p.tier === tier));

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ service_id: string }>("/api/services", {
        body: {
          ...form,
          packages:
            form.pricing_model === "PACKAGES"
              ? packages.map((p) => ({ tier: p.tier, scope: p.scope, delivery_days: Number(p.delivery_days), revisions: Number(p.revisions), estimated_hours: Number(p.estimated_hours) }))
              : [],
        },
      });
      onCreated(r.service_id);
    } catch (err) {
      setError(errText(err, t("fl.svc.addFailed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BodyPortal>
      <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <button type="button" className="absolute inset-0 bg-ink/35" aria-label={t("drawer.close")} onClick={onClose} />
        <form onSubmit={create} className="absolute inset-y-0 right-0 flex w-[min(34rem,100vw)] flex-col overflow-y-auto bg-sheet shadow-[var(--shadow-overlay)]">
          <header className="flex items-center justify-between border-b border-rule p-5">
            <h2 id={`${id}-title`} className="font-display text-xl font-semibold">
              {t("fl.svc.add")}
            </h2>
            <button type="button" onClick={onClose} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-sheet-2">
              <IconClose />
              <span className="sr-only">{t("drawer.close")}</span>
            </button>
          </header>
          <div className="flex flex-col gap-4 p-5">
            <button type="button" onClick={onAskAi} className="flex items-center gap-3 rounded-md border border-assist/40 bg-assist-soft p-3 text-left text-sm text-assist-ink hover:border-assist">
              <IconSpark />
              <span>
                <span className="block font-semibold">{t("fl.svc.aiTitle")}</span>
                {t("fl.svc.aiBody")}
              </span>
            </button>
            <p className="text-sm text-ink-3">{t("fl.svc.formIntro")}</p>
            <label className={labelCls}>
              {t("fl.svc.title")}
              <input ref={first} className={field} required minLength={3} maxLength={140} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </label>
            <label className={labelCls}>
              {t("pe.description")}
              <textarea className={`${field} py-2`} required minLength={10} maxLength={5000} rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className={labelCls}>
                {t("fl.svc.code")}
                <input className={field} required maxLength={40} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
              </label>
              <label className={labelCls}>
                {t("fl.svc.category")}
                <input className={field} required minLength={2} maxLength={60} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              </label>
              <label className={labelCls}>
                {t("form.writtenIn")}
                <select className={field} value={form.source_locale} onChange={(e) => setForm({ ...form, source_locale: e.target.value })}>
                  {MARKETS.map((l) => (
                    <option key={l} value={l}>
                      {t(`langname.${l.slice(0, 2)}` as MessageKey)} ({l.slice(3)})
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelCls}>
                {t("fl.svc.pricingModel")}
                <select className={field} value={form.pricing_model} onChange={(e) => setForm({ ...form, pricing_model: e.target.value as "PACKAGES" | "HOURLY" })}>
                  <option value="PACKAGES">{t("fl.svc.packages")}</option>
                  <option value="HOURLY">{t("fl.svc.hourly")}</option>
                </select>
              </label>
            </div>

            {form.pricing_model === "HOURLY" ? (
              <p className="rounded-md bg-sheet-2 px-3 py-2 text-sm text-ink-2">{t("fl.svc.hourlyNote")}</p>
            ) : (
              <fieldset className="flex flex-col gap-3">
                <legend className="mb-1 text-sm font-medium text-ink">{t("fl.svc.packagesLegend")}</legend>
                {packages.map((p, i) => (
                  <div key={p.tier} className="flex flex-col gap-3 rounded-md border border-rule p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{t(`fl.tier.${p.tier}` as MessageKey)}</span>
                      {packages.length > 1 && (
                        <button type="button" className="min-h-10 rounded-md px-2 text-sm text-ink-3 hover:bg-sheet-2 hover:text-ink" onClick={() => setPackages((ps) => ps.filter((_, j) => j !== i))}>
                          {t("fl.svc.removePackage")}
                        </button>
                      )}
                    </div>
                    <label className={labelCls}>
                      {t("fl.svc.scope")}
                      <textarea className={`${field} py-2`} rows={2} required minLength={3} maxLength={500} value={p.scope} onChange={(e) => setPkg(i, { scope: e.target.value })} />
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <label className={labelCls}>
                        {t("fl.svc.deliveryDays")}
                        <input className={`${field} num`} type="number" min={1} max={365} required value={p.delivery_days} onChange={(e) => setPkg(i, { delivery_days: e.target.value })} />
                      </label>
                      <label className={labelCls}>
                        {t("fl.svc.revisions")}
                        <input className={`${field} num`} type="number" min={0} max={20} required value={p.revisions} onChange={(e) => setPkg(i, { revisions: e.target.value })} />
                      </label>
                      <label className={labelCls}>
                        {t("fl.svc.hours")}
                        <input className={`${field} num`} type="number" min={1} max={1000} required value={p.estimated_hours} onChange={(e) => setPkg(i, { estimated_hours: e.target.value })} />
                      </label>
                    </div>
                  </div>
                ))}
                {nextTier && (
                  <button type="button" className={`${secondaryBtn} w-fit`} onClick={() => setPackages((ps) => [...ps, emptyPackage(nextTier)])}>
                    {t("fl.svc.addPackage", { tier: t(`fl.tier.${nextTier}` as MessageKey) })}
                  </button>
                )}
                <p className="text-xs text-ink-3">{t("fl.svc.floorNote")}</p>
              </fieldset>
            )}
            {error && <Notice tone="error">{error}</Notice>}
          </div>
          <footer className="mt-auto flex gap-3 border-t border-rule p-5">
            <button type="submit" disabled={busy} className={`${primaryBtn} flex-1`}>
              {busy ? t("form.busy") : t("fl.svc.submit")}
            </button>
            <button type="button" onClick={onClose} className={secondaryBtn}>
              {t("form.cancel")}
            </button>
          </footer>
        </form>
      </div>
    </BodyPortal>
  );
}

export function ServicesView() {
  const { t } = useI18n();
  const base = useBase();
  const router = useRouter();
  const [services, setServices] = useState<Service[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [tick, setTick] = useState(0);
  // The panel opens on the Profile agent in its "new service" conversation; reload after it replies (it may have added a service).
  usePageAssistant({ agent: "PROFILE", resumeKey: "new-service", onResult: () => setTick((n) => n + 1) });

  useEffect(() => {
    api<{ services: Service[] }>("/api/services").then(
      (r) => setServices(r.services),
      (e: unknown) => setError(errText(e, t("fl.error"))),
    );
  }, [tick, t]);

  const live = (services ?? []).reduce((s, x) => s + x.markets.filter((m) => m.status === "PUBLISHED").length, 0);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className={h1Cls}>{t("fl.nav.services")}</h1>
          <p className="mt-1 text-ink-3">{services ? t("fl.svc.summary", { n: services.length, live }) : t("fl.loading")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => openAssistant({ agent: "PROFILE" })} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-assist px-5 font-semibold text-assist-on hover:brightness-110">
            <IconSpark /> {t("fl.svc.addAi")}
          </button>
          <button type="button" onClick={() => setAdding(true)} className="min-h-11 rounded-md border border-rule-strong px-5 font-semibold text-ink hover:bg-sheet-2">
            {t("fl.svc.add")}
          </button>
        </div>
      </header>

      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-3" aria-label={t("prod.key")}>
        <li className="inline-flex items-center gap-1.5">
          <span className="h-3 w-4 rounded-[2px] bg-accent" aria-hidden /> {t("pe.status.PUBLISHED")}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="h-3 w-4 rounded-[2px] border-[1.5px] border-dashed border-gold-ink" aria-hidden /> {t("pe.status.DRAFT")}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="h-3 w-4 rounded-[2px] border-[1.5px] border-rule" aria-hidden /> {t("fl.svc.noPage")}
        </li>
      </ul>

      {error && <Notice tone="error">{error}</Notice>}
      {services && services.length === 0 && (
        <div className="rounded-[10px] border border-dashed border-rule-strong p-8 text-center">
          <p className="font-display text-lg">{t("fl.svc.emptyTitle")}</p>
          <p className="mt-1 text-sm text-ink-3">{t("fl.svc.emptyBody")}</p>
        </div>
      )}
      {!services && !error && (
        <ul className="grid gap-4 cq-md:grid-cols-2 cq-xl:grid-cols-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-48 animate-pulse rounded-[10px] border border-rule bg-sheet-2" />
          ))}
        </ul>
      )}
      {services && services.length > 0 && (
        <ul className="grid gap-4 cq-md:grid-cols-2 cq-xl:grid-cols-3">
          {services.map((s) => (
            <ServiceCard key={s.service_id} s={s} />
          ))}
        </ul>
      )}

      {adding && (
        <NewServiceDrawer
          onClose={() => setAdding(false)}
          onAskAi={() => {
            setAdding(false);
            openAssistant({ agent: "PROFILE" });
          }}
          onCreated={(id) => {
            setAdding(false);
            setTick((n) => n + 1);
            router.push(`${base}/services/${id}`);
          }}
        />
      )}
    </div>
  );
}
