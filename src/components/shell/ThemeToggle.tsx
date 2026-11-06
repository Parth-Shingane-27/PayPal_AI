"use client";

import { useSyncExternalStore } from "react";
import { IconMoon, IconSun } from "../icons";

type Theme = "light" | "dark";
const KEY = "gc-theme-v2";
const listeners = new Set<() => void>();

function current(): Theme {
  const set = document.documentElement.dataset.theme;
  return set === "dark" ? "dark" : "light";
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  for (const l of listeners) l();
}

/** Subscribe to the effective theme (for components that must pass literal colours). */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, current, () => "light");
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const theme = useTheme();
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm text-ink-2 hover:bg-sheet-2 hover:text-ink"
      aria-label={`Switch to ${next} theme`}
    >
      {theme === "dark" ? <IconSun /> : <IconMoon />}
      {!compact && <span>{theme === "dark" ? "Light theme" : "Dark theme"}</span>}
    </button>
  );
}
