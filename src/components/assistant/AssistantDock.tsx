"use client";

import { useEffect, useRef } from "react";
import { ChatPanel } from "../ChatPanel";
import { useI18n } from "../i18n/I18nProvider";
import { IconClose, IconSpark } from "../icons";
import type { MessageKey } from "@/lib/i18n/messages";
import { useAssistant } from "./AssistantContext";
import {
  applyDockToDocument,
  clampWidth,
  DOCK_MIN,
  defaultWidth,
  maxWidth,
  nextKeyboardWidth,
  setDockOpen,
  setDockWidth,
  setOverlayOpen,
  useDock,
  useOverlayOpen,
  useViewportWidth,
} from "./dock-store";

const Chevron = ({ dir }: { dir: "left" | "right" }) => (
  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={dir === "right" ? "m7.5 5 5 5-5 5" : "m12.5 5-5 5 5 5"} />
  </svg>
);

const iconBtn =
  "inline-flex min-h-10 min-w-10 cursor-pointer items-center justify-center rounded-md text-ink-2 hover:bg-sheet-2 hover:text-ink";

/**
 * The drag handle on the panel's left edge. Dragging changes the width live
 * through the CSS variable the page layout reads (no React render per pixel)
 * and saves it on release. It is also a keyboard-operable separator.
 */
function ResizeHandle({ chrome }: { chrome: number }) {
  const { t } = useI18n();
  const dock = useDock();
  const vw = useViewportWidth();
  const drag = useRef<{ startX: number; startW: number; last: number; raf: number | null } | null>(null);
  const current = dock.width ?? defaultWidth(vw);
  const max = maxWidth(vw, chrome);

  const widthNow = (el: HTMLElement) => el.closest("aside")?.getBoundingClientRect().width ?? current;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("dock.resize")}
      aria-valuenow={Math.round(current)}
      aria-valuemin={DOCK_MIN}
      aria-valuemax={max}
      tabIndex={0}
      title={t("dock.resizeHint")}
      className="group absolute inset-y-0 -left-2 z-10 hidden w-4 cursor-col-resize touch-none items-stretch justify-center outline-none lg:flex"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const startW = widthNow(e.currentTarget);
        drag.current = { startX: e.clientX, startW, last: startW, raf: null };
        document.documentElement.dataset.dockDragging = "";
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        d.last = clampWidth(d.startW + (d.startX - e.clientX), window.innerWidth, chrome);
        // One layout update per frame, however fast the pointer moves.
        d.raf ??= requestAnimationFrame(() => {
          d.raf = null;
          document.documentElement.style.setProperty("--dock-w", `${d.last}px`);
        });
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        delete document.documentElement.dataset.dockDragging;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        if (d) {
          if (d.raf !== null) cancelAnimationFrame(d.raf);
          setDockWidth(d.last);
        }
      }}
      onPointerCancel={() => {
        drag.current = null;
        delete document.documentElement.dataset.dockDragging;
        applyDockToDocument({ open: true, width: dock.width });
      }}
      onDoubleClick={() => setDockWidth(null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          setDockWidth(null);
          return;
        }
        const next = nextKeyboardWidth(widthNow(e.currentTarget), e.key, e.shiftKey, window.innerWidth, chrome);
        if (next !== null) {
          e.preventDefault();
          setDockWidth(next);
        }
      }}
    >
      <span className="h-full w-px bg-rule transition-colors group-hover:w-0.5 group-hover:bg-accent group-focus-visible:w-0.5 group-focus-visible:bg-accent" aria-hidden />
    </div>
  );
}

/**
 * The assistant side panel. From 1024px up it is a column beside the page that
 * can be dragged wider or narrower, or collapsed to a rail; below that it is a
 * sheet that opens over the page from a floating button. One conversation per
 * agent; which agent follows the page unless the person picks another.
 */
export function AssistantDock({ chrome }: { chrome: number }) {
  const { t } = useI18n();
  const a = useAssistant();
  const dock = useDock();
  const overlayOpen = useOverlayOpen();
  const asideRef = useRef<HTMLElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const wasOverlay = useRef(false);

  // Keep <html> in step with the saved state (the inline script handles first paint).
  useEffect(() => {
    applyDockToDocument(dock);
  }, [dock]);

  // The sheet: Escape closes it, focus moves into it on open and back to the launcher on close.
  useEffect(() => {
    if (!overlayOpen) {
      if (wasOverlay.current) launcherRef.current?.focus();
      wasOverlay.current = false;
      return;
    }
    wasOverlay.current = true;
    asideRef.current?.querySelector<HTMLElement>("textarea")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOverlayOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlayOpen]);

  const scope = a.scope;
  const showAgents = a.agents.length > 1;
  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        onClick={() => setOverlayOpen(true)}
        aria-expanded={overlayOpen}
        aria-controls="assistant-dock"
        className={`${overlayOpen ? "hidden" : "inline-flex"} fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 max-w-[calc(100vw-2rem)] items-center gap-2.5 rounded-full bg-assist py-2.5 pr-5 pl-2.5 text-left font-semibold text-assist-on shadow-[0_10px_30px_-6px_color-mix(in_srgb,var(--assist)_60%,transparent)] ring-4 ring-assist/20 transition hover:-translate-y-0.5 hover:brightness-110 lg:hidden`}
      >
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-assist-soft text-assist-ink">
          <IconSpark />
        </span>
        <span className="truncate">{t("dock.open")}</span>
      </button>

      {overlayOpen && <button type="button" className="fixed inset-0 z-40 bg-ink/40 lg:hidden" aria-label={t("dock.close")} onClick={() => setOverlayOpen(false)} />}

      <aside
        ref={asideRef}
        id="assistant-dock"
        aria-label={t("dock.title")}
        className={`${overlayOpen ? "flex" : "hidden lg:flex"} fixed inset-y-0 right-0 z-40 w-full flex-col bg-sheet shadow-[var(--shadow-overlay)] sm:w-[min(28rem,92vw)] lg:sticky lg:inset-auto lg:top-0 lg:z-auto lg:h-dvh lg:w-auto lg:border-l lg:border-rule lg:shadow-none`}
      >
        {dock.open && <ResizeHandle chrome={chrome} />}

        {/* Collapsed rail (from 1024px up) */}
        {!dock.open && (
          <button
            type="button"
            onClick={() => setDockOpen(true)}
            aria-expanded={false}
            aria-controls="assistant-dock"
            aria-label={t("dock.expand")}
            className="hidden h-full w-full cursor-pointer flex-col items-center gap-3 py-4 text-ink-2 hover:bg-sheet-2 hover:text-ink lg:flex"
          >
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-assist text-assist-on">
              <IconSpark />
            </span>
            <span className="text-sm font-medium [writing-mode:vertical-rl]">{t("dock.title")}</span>
            <Chevron dir="left" />
          </button>
        )}

        <div className={`${dock.open ? "flex" : "flex lg:hidden"} dock-body min-h-0 flex-1 flex-col`}>
          <header className="flex items-center gap-2.5 border-t-4 border-t-assist px-3 py-2.5">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-assist text-assist-on">
              <IconSpark />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate font-display text-lg leading-tight font-semibold tracking-[-0.01em]">{t("dock.title")}</h2>
              {a.contextLabel && <p className="truncate text-xs text-ink-3">{a.contextLabel}</p>}
            </div>
            <button type="button" className={`${iconBtn} hidden lg:inline-flex`} onClick={() => setDockOpen(false)} aria-expanded aria-controls="assistant-dock" aria-label={t("dock.collapse")} title={t("dock.collapse")}>
              <Chevron dir="right" />
            </button>
            <button type="button" className={`${iconBtn} lg:hidden`} onClick={() => setOverlayOpen(false)} aria-label={t("dock.close")}>
              <IconClose />
            </button>
          </header>

          {showAgents && (
            <div role="tablist" aria-label={t("dock.switcher")} className="flex flex-wrap gap-1 border-b border-rule px-3 pb-2">
              {a.agents.map((ag) => {
                const on = ag === a.active;
                return (
                  <button
                    key={ag}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    aria-controls="assistant-chat"
                    // A reply in progress belongs to this agent; switching would lose it from view.
                    disabled={a.busy && !on}
                    onClick={() => a.choose(ag)}
                    className={`inline-flex min-h-9 shrink-0 cursor-pointer items-center rounded-full px-3 text-sm whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? "bg-ink font-semibold text-sheet" : "text-ink-2 hover:bg-sheet-2 hover:text-ink"}`}
                  >
                    {t(`dock.agent.${ag}` as MessageKey)}
                  </button>
                );
              })}
            </div>
          )}

          <div id="assistant-chat" role={showAgents ? "tabpanel" : undefined} className="min-h-0 flex-1 border-t border-rule">
            <ChatPanel
              key={`${a.active}|${scope.productId ?? ""}|${scope.resumeKey ?? ""}`}
              agent={a.active}
              productId={scope.productId}
              resumeKey={scope.resumeKey}
              paypalClientId={a.paypalClientId}
              onResult={a.notifyResult}
              onBusyChange={a.setBusy}
            />
          </div>
        </div>
      </aside>
    </>
  );
}
