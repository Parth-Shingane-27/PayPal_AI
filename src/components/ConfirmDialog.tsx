"use client";

import { useEffect, useId, useRef } from "react";

/**
 * A modal confirmation on the native <dialog>: the browser traps focus, Escape
 * cancels, and the page behind is inert. Cancel has initial focus, so Enter
 * never confirms by accident.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-[12px] border border-rule bg-sheet p-6 text-ink shadow-[var(--shadow-overlay)] backdrop:bg-black/45"
    >
      <h2 id={titleId} className="font-display text-xl font-semibold tracking-[-0.01em]">
        {title}
      </h2>
      <div className="mt-2 space-y-2 text-[0.95rem] leading-relaxed text-ink-2">{children}</div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          autoFocus
          disabled={busy}
          onClick={onCancel}
          className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-rule-strong px-4 text-sm font-medium text-ink-2 hover:bg-sheet-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="inline-flex min-h-11 cursor-pointer items-center rounded-md bg-accent px-4 text-sm font-semibold text-sheet hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
