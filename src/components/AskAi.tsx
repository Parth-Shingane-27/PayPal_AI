"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { IconSpark } from "./icons";

const SEEN_KEY = "askai-opened";
const noSubscribe = () => () => {};

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

function writeSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Storage blocked: the attention dot just shows again next visit.
  }
}

/**
 * The page's AI assistant, behind a launcher pinned to the bottom-right corner,
 * so it stays in sight however long the page is (a shop with many products, a
 * long ledger). The launcher opens a floating panel; on phones the panel fills
 * the screen. The chat stays mounted while closed, so a reply in progress and
 * the resumed conversation are never lost by hiding it.
 */
/** Opens the page's assistant from elsewhere on the page, e.g. an "Add with AI" button. */
export function openAskAi() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}
const OPEN_EVENT = "askai:open";

export function AskAi({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => show();
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  });
  // Server render assumes "seen" so the attention dot only appears client-side.
  const storedSeen = useSyncExternalStore(noSubscribe, readSeen, () => true);
  const [openedNow, setOpenedNow] = useState(false);
  const seen = storedSeen || openedNow;
  const closeRef = useRef<HTMLButtonElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      closeRef.current?.focus();
      wasOpen.current = true;
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") setOpen(false);
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
    if (wasOpen.current) launcherRef.current?.focus();
  }, [open]);

  function show() {
    setOpen(true);
    if (!seen) {
      setOpenedNow(true);
      writeSeen();
    }
  }

  return (
    <>
      {/* Keeps the last row of the page clear of the launcher. */}
      <div aria-hidden className="h-16" />

      <button
        ref={launcherRef}
        type="button"
        onClick={show}
        aria-expanded={open}
        aria-controls="ask-ai-panel"
        title={hint}
        className={`fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 flex max-w-[calc(100vw-2rem)] items-center gap-2.5 rounded-full bg-assist py-2.5 pr-5 pl-2.5 text-left font-semibold text-assist-on shadow-[0_10px_30px_-6px_color-mix(in_srgb,var(--assist)_60%,transparent)] ring-4 ring-assist/20 transition hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-assist ${open ? "hidden" : ""}`}
      >
        <span className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-assist-soft text-assist-ink">
          <IconSpark />
          {!seen && (
            <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-assist-soft opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-assist bg-assist-soft" />
            </span>
          )}
        </span>
        <span className="truncate">{label}</span>
      </button>

      <div
        id="ask-ai-panel"
        role="dialog"
        aria-label={label}
        className={`fixed inset-0 z-30 flex-col bg-sheet sm:inset-auto sm:right-4 sm:bottom-4 sm:h-[min(44rem,calc(100dvh-2rem))] sm:w-[min(30rem,calc(100vw-2rem))] sm:rounded-[10px] sm:border sm:border-rule sm:shadow-[var(--shadow-overlay)] ${open ? "flex" : "hidden"}`}
      >
        <header className="flex items-start gap-3 border-b border-rule border-t-4 border-t-assist px-4 py-3 sm:rounded-t-[10px]">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-assist text-assist-on">
            <IconSpark />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-ink">{label}</span>
            <span className="block text-sm text-ink-3">{hint}</span>
          </span>
          <button
            ref={closeRef}
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md px-2 py-1 text-sm font-medium text-accent hover:bg-accent-soft"
          >
            Close
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col [&>section]:min-h-0 [&>section]:flex-1 [&>section]:rounded-none [&>section]:border-0">
          {children}
        </div>
      </div>
    </>
  );
}
