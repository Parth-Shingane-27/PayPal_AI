"use client";

import { useEffect, useState } from "react";
import { ActivityTimeline, type ActivityRow } from "@/components/ActivityTimeline";
import { api } from "@/components/api";
import { errText, Notice } from "@/components/gig/freelancer/shared";
import { useI18n } from "@/components/i18n/I18nProvider";

export function ActivityView() {
  const { t } = useI18n();
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ activity: ActivityRow[] }>("/api/freelancer/activity?limit=300").then(
      (r) => setRows(r.activity),
      (e: unknown) => setError(errText(e, t("fl.error"))),
    );
  }, [t]);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!rows) return <p className="text-sm text-ink-3">{t("fl.loading")}</p>;
  return <ActivityTimeline rows={rows} empty={t("fl.act.empty")} />;
}
