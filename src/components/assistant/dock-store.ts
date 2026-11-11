import { useSyncExternalStore } from "react";

/**
 * State of the assistant side panel: open or collapsed to a rail, and its
 * width. Saved in the browser (`gg-dock-v1`) and mirrored onto <html> as the
 * `data-dock` attribute and the `--dock-w` CSS variable, which the page layout
 * reads. The inline script in app/layout.tsx applies the same saved state
 * before first paint; keep the key and shape in step with it.
 */

export const DOCK_KEY = "gg-dock-v1";
/** Narrowest the panel can be dragged to. */
export const DOCK_MIN = 280;
/** Width of the collapsed rail (3rem). */
export const DOCK_RAIL = 48;
/** The default quarter-of-the-screen width never goes below this (20rem), so the panel stays usable on a small laptop. */
export const DOCK_FLOOR = 320;
/** The page content is never squeezed below this by the panel. */
export const CONTENT_MIN = 480;
/** From this screen width the panel is a column beside the page; below it, an overlay sheet. */
export const PUSH_FROM = 1024;

export type DockState = { open: boolean; /** Pixels, or null for the default quarter of the screen. */ width: number | null };

/** A quarter of the screen, with a floor. */
export function defaultWidth(viewport: number): number {
  return Math.max(DOCK_FLOOR, Math.round(viewport * 0.25));
}

/** Half the screen at most, and never so wide that the content (beside `chrome` px of sidebar) drops below CONTENT_MIN. */
export function maxWidth(viewport: number, chrome: number): number {
  return Math.max(DOCK_MIN, Math.min(Math.round(viewport * 0.5), viewport - chrome - CONTENT_MIN));
}

export function clampWidth(width: number, viewport: number, chrome: number): number {
  return Math.round(Math.min(maxWidth(viewport, chrome), Math.max(DOCK_MIN, width)));
}

/**
 * Width after a key press on the resize handle, or null for a key it does not use.
 * The handle is on the panel's left edge, so Left widens the panel and Right narrows it.
 */
export function nextKeyboardWidth(current: number, key: string, shift: boolean, viewport: number, chrome: number): number | null {
  const step = shift ? 48 : 16;
  switch (key) {
    case "ArrowLeft":
      return clampWidth(current + step, viewport, chrome);
    case "ArrowRight":
      return clampWidth(current - step, viewport, chrome);
    case "Home":
      return DOCK_MIN;
    case "End":
      return maxWidth(viewport, chrome);
    default:
      return null;
  }
}

const SERVER_STATE: DockState = { open: true, width: null };
const listeners = new Set<() => void>();
let cached: DockState | null = null;

function read(): DockState {
  try {
    const raw = JSON.parse(localStorage.getItem(DOCK_KEY) ?? "null") as Partial<DockState> | null;
    return { open: raw?.open !== false, width: typeof raw?.width === "number" && Number.isFinite(raw.width) ? raw.width : null };
  } catch {
    return SERVER_STATE;
  }
}

/** Mirrors the state onto <html>, where the layout's CSS reads it. */
export function applyDockToDocument(s: DockState): void {
  const root = document.documentElement;
  if (s.open) delete root.dataset.dock;
  else root.dataset.dock = "closed";
  if (s.open && s.width !== null) root.style.setProperty("--dock-w", `${s.width}px`);
  else root.style.removeProperty("--dock-w");
}

function getSnapshot(): DockState {
  return (cached ??= read());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function commit(next: DockState): void {
  cached = next;
  try {
    localStorage.setItem(DOCK_KEY, JSON.stringify(next));
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  applyDockToDocument(next);
  for (const l of listeners) l();
}

export function setDockOpen(open: boolean): void {
  commit({ ...getSnapshot(), open });
}

/** A width within a couple of pixels of the default is stored as "the default", so it keeps tracking a quarter of the screen. */
export function setDockWidth(width: number | null, viewport = window.innerWidth): void {
  const isDefault = width === null || Math.abs(width - defaultWidth(viewport)) <= 2;
  commit({ ...getSnapshot(), width: isDefault ? null : Math.round(width) });
}

export function useDock(): DockState {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_STATE);
}

// --- The overlay sheet used below PUSH_FROM (not saved: it starts closed on every page) ---------------

let overlay = false;
const overlayListeners = new Set<() => void>();

export function setOverlayOpen(open: boolean): void {
  if (overlay === open) return;
  overlay = open;
  for (const l of overlayListeners) l();
}

export function useOverlayOpen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      overlayListeners.add(cb);
      return () => {
        overlayListeners.delete(cb);
      };
    },
    () => overlay,
    () => false,
  );
}

/** True from PUSH_FROM up, where the panel sits beside the page instead of over it. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(`(min-width: ${PUSH_FROM}px)`);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(`(min-width: ${PUSH_FROM}px)`).matches,
    () => true,
  );
}

/** The screen width, for the resize handle's limits. 1440 on the server. */
export function useViewportWidth(): number {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("resize", cb);
      return () => window.removeEventListener("resize", cb);
    },
    () => window.innerWidth,
    () => 1440,
  );
}
