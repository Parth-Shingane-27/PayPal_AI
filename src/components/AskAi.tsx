"use client";

import { useState } from "react";
import { IconSpark } from "./icons";

/**
 * Folds an AI chat away under one button, so each page leads with its plain
 * controls. The chat stays mounted while folded, so a reply in progress and
 * the resumed conversation are never lost by hiding it.
 */
export function AskAi({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-[10px] border border-rule bg-sheet">
      <button className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
          <IconSpark />
        </span>
        <span className="flex-1">
          <span className="block font-semibold text-ink">{label}</span>
          <span className="block text-sm text-ink-3">{hint}</span>
        </span>
        <span className="text-sm font-medium text-accent">{open ? "Hide" : "Open"}</span>
      </button>
      <div className={open ? "border-t border-rule p-3" : "hidden"}>{children}</div>
    </section>
  );
}
