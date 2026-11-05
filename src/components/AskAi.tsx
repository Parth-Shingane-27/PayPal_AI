"use client";

import { useState } from "react";

/**
 * Folds an AI chat away under one button, so each page leads with its plain
 * controls. The chat stays mounted while folded, so a reply in progress and
 * the resumed conversation are never lost by hiding it.
 */
export function AskAi({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-lg border border-violet-200 bg-violet-50/60">
      <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="text-lg" aria-hidden>
          ✨
        </span>
        <span className="flex-1">
          <span className="block font-medium text-violet-900">{label}</span>
          <span className="block text-xs text-violet-700">{hint}</span>
        </span>
        <span className="text-sm text-violet-700">{open ? "Hide ▲" : "Open ▼"}</span>
      </button>
      <div className={open ? "border-t border-violet-200 p-3" : "hidden"}>{children}</div>
    </section>
  );
}
