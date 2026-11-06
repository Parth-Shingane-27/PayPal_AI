"use client";

import { useRouter } from "next/navigation";
import { api } from "./api";
import { useT } from "./i18n/I18nProvider";

export function LogoutButton() {
  const router = useRouter();
  const t = useT();
  return (
    <button
      className="inline-flex min-h-11 items-center rounded-md px-2 text-sm text-ink-2 hover:bg-sheet-2 hover:text-ink"
      onClick={async () => {
        await api("/api/auth/logout", { method: "POST" });
        router.push("/login");
        router.refresh();
      }}
    >
      {t("shell.signOut")}
    </button>
  );
}
