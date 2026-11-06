"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/components/api";
import { LanguagePicker, useI18n } from "@/components/i18n/I18nProvider";
import { CountryStamp } from "@/components/ui";
import type { MessageKey } from "@/lib/i18n/messages";

type Account = { id: string; name: string; country: string; locale: string; currency?: string };

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [accounts, setAccounts] = useState<{ sellers: Account[]; buyers: Account[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    api<{ sellers: Account[]; buyers: Account[] }>("/api/auth/demo-users")
      .then(setAccounts)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load accounts."));
  }, []);

  async function login(role: "SELLER" | "BUYER", id: string) {
    setPending(id);
    try {
      const res = await api<{ redirect: string }>("/api/auth/demo", { body: { role, id } });
      router.push(res.redirect);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed.");
      setPending(null);
    }
  }

  const list = (role: "SELLER" | "BUYER", items: Account[]) => (
    <ul className="divide-y divide-dashed divide-rule-strong">
      {items.map((a) => (
        <li key={a.id}>
          <button
            className="flex min-h-14 w-full items-center gap-3 px-1 py-2.5 text-left hover:bg-sheet-2 disabled:opacity-60"
            onClick={() => login(role, a.id)}
            disabled={pending !== null}
          >
            <CountryStamp country={a.country} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-ink">{a.name}</span>
              <span className="block text-sm text-ink-3">
                {role === "SELLER" ? t("login.sellsIn", { currency: a.currency ?? "", lang: t(`langname.${a.locale.slice(0, 2)}` as MessageKey) }) : t("login.shopsIn", { lang: t(`langname.${a.locale.slice(0, 2)}` as MessageKey) })}
              </span>
            </span>
            <span className="text-sm font-medium text-accent">{pending === a.id ? t("login.signingIn") : t("login.signIn")}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col justify-center gap-8 px-4 py-10">
      <header className="max-w-2xl">
        <div className="flex items-center justify-between gap-3">
          <p className="font-display text-sm font-semibold text-accent-ink">{t("login.eyebrow")}</p>
          <LanguagePicker />
        </div>
        <h1 className="mt-1 font-display text-[2.4rem] leading-[1.05] font-bold tracking-[-0.03em] text-ink md:text-[3.2rem]">
          {t("login.title")}
        </h1>
        <p className="mt-3 text-lg text-ink-2">{t("login.sub")}</p>
      </header>
      {error && (
        <p role="alert" className="rounded-md bg-alert-soft p-3 text-sm text-alert-ink">
          {error}
        </p>
      )}
      {!accounts && !error && <p className="text-ink-3">{t("login.loading")}</p>}
      {accounts && (
        <div className="grid gap-6 md:grid-cols-2">
          <section aria-labelledby="sellers" className="rounded-[10px] border border-rule bg-sheet p-4 md:p-5">
            <h2 id="sellers" className="font-display text-xl font-semibold">
              {t("login.makers")}
            </h2>
            <p className="mb-2 text-sm text-ink-3">{t("login.makersSub")}</p>
            {list("SELLER", accounts.sellers)}
          </section>
          <section aria-labelledby="buyers" className="rounded-[10px] border border-rule bg-sheet p-4 md:p-5">
            <h2 id="buyers" className="font-display text-xl font-semibold">
              {t("login.buyers")}
            </h2>
            <p className="mb-2 text-sm text-ink-3">{t("login.buyersSub")}</p>
            {list("BUYER", accounts.buyers)}
          </section>
        </div>
      )}
      <p className="text-sm text-ink-3">{t("login.note")}</p>
    </main>
  );
}
