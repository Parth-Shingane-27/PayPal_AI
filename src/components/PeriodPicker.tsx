import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/messages";
import { DASHBOARD_PERIODS, type DashboardPeriod } from "@/lib/periods";

/** Segmented period links; plain navigation so the server re-renders the figures. */
export async function PeriodPicker({ current, basePath }: { current: DashboardPeriod; basePath: string }) {
  const t = await getT();
  return (
    <nav aria-label={t("period.label")} className="inline-flex rounded-md border border-rule bg-sheet p-0.5">
      {DASHBOARD_PERIODS.map((p) => {
        const active = p.key === current;
        return (
          <Link
            key={p.key}
            href={`${basePath}?period=${p.key}`}
            aria-current={active ? "true" : undefined}
            scroll={false}
            className={`inline-flex min-h-10 items-center rounded-[5px] px-3 text-sm ${active ? "bg-ink font-semibold text-sheet" : "text-ink-2 hover:bg-sheet-2 hover:text-ink"}`}
          >
            {t(`period.${p.key}` as MessageKey)}
          </Link>
        );
      })}
    </nav>
  );
}
