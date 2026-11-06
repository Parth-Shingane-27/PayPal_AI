"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useMemo, useTransition } from "react";
import { LANG_COOKIE, localeOf, translator, type Translate, UI_LANGS, type UiLang } from "@/lib/i18n/core";

type Ctx = { lang: UiLang; locale: string; t: Translate };
const I18nContext = createContext<Ctx>({ lang: "en", locale: "en-GB", t: translator("en") });

export function I18nProvider({ lang, children }: { lang: UiLang; children: React.ReactNode }) {
  const value = useMemo<Ctx>(() => ({ lang, locale: localeOf(lang), t: translator(lang) }), [lang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useT = () => useContext(I18nContext).t;
export const useI18n = () => useContext(I18nContext);

/** Language picker shown at the top of every screen. Saves a cookie and re-renders on the server. */
export function LanguagePicker({ compact = false }: { compact?: boolean }) {
  const { lang, t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className={compact ? "sr-only" : "text-ink-3"}>{t("lang.label")}</span>
      <select
        value={lang}
        disabled={pending}
        aria-label={t("lang.label")}
        onChange={(e) => {
          document.cookie = `${LANG_COOKIE}=${e.target.value}; path=/; max-age=31536000; samesite=lax`;
          document.documentElement.lang = e.target.value;
          start(() => router.refresh());
        }}
        className="min-h-10 rounded-md border border-rule bg-sheet px-2 text-ink hover:border-rule-strong disabled:opacity-60"
      >
        {UI_LANGS.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
