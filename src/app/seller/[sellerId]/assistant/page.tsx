import { getT } from "@/lib/i18n/server";
import { AssistantLauncher } from "./AssistantLauncher";

export const metadata = { title: "Assistant" };

export default async function AssistantPage() {
  const t = await getT();
  return (
    <div className="flex flex-col gap-6">
      <header className="max-w-2xl">
        <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em]">{t("dock.title")}</h1>
        <p className="mt-1 text-ink-3">{t("asst.intro")}</p>
      </header>
      <AssistantLauncher />
    </div>
  );
}
