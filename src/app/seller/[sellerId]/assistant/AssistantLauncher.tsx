"use client";

import { useEffect } from "react";
import { openAssistant, usePageAssistant } from "@/components/assistant/AssistantContext";
import type { DockAgent } from "@/components/assistant/route-context";
import { useI18n } from "@/components/i18n/I18nProvider";
import { IconBox, IconCoins, IconSpark, IconTruck } from "@/components/icons";
import type { MessageKey } from "@/lib/i18n/messages";

const SPECIALISTS: { agent: Extract<DockAgent, "LISTING" | "TREASURY" | "OPERATIONS">; Icon: typeof IconBox }[] = [
  { agent: "LISTING", Icon: IconBox },
  { agent: "TREASURY", Icon: IconCoins },
  { agent: "OPERATIONS", Icon: IconTruck },
];

/** Opens the assistant panel as the page loads, and offers a way to start with a specific specialist. */
export function AssistantLauncher() {
  const { t } = useI18n();
  usePageAssistant({ agent: "ASSISTANT" });
  useEffect(() => {
    openAssistant({ agent: "ASSISTANT" });
  }, []);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <button
          type="button"
          onClick={() => openAssistant({ agent: "ASSISTANT" })}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md bg-accent px-5 font-semibold text-sheet hover:brightness-95"
        >
          <IconSpark className="h-4 w-4" />
          {t("asst.open")}
        </button>
      </div>
      <ul className="grid gap-4 cq-md:grid-cols-3">
        {SPECIALISTS.map(({ agent, Icon }) => (
          <li key={agent} className="flex flex-col gap-3 rounded-[10px] border border-rule bg-sheet p-4 md:p-5">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-sheet-2 text-ink-2">
              <Icon className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-display text-lg font-semibold">{t(`dock.agent.${agent}` as MessageKey)}</h2>
              <p className="mt-1 text-ink-3">{t(`asst.${agent}` as MessageKey)}</p>
            </div>
            <button
              type="button"
              onClick={() => openAssistant({ agent })}
              className="mt-auto inline-flex min-h-11 w-fit cursor-pointer items-center rounded-md border border-rule-strong px-4 text-sm font-medium text-ink-2 hover:bg-sheet-2 hover:text-ink"
            >
              {t("asst.ask", { agent: t(`dock.agent.${agent}` as MessageKey) })}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
