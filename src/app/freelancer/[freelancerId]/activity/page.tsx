import { getT } from "@/lib/i18n/server";
import { ActivityView } from "./ActivityView";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("nav.activity") };
}

export default async function ActivityPage() {
  const t = await getT();
  return (
    <div className="flex flex-col gap-4">
      <header className="max-w-2xl">
        <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em]">{t("nav.activity")}</h1>
        <p className="mt-1 text-ink-3">{t("fl.act.intro")}</p>
      </header>
      <ActivityView />
    </div>
  );
}
