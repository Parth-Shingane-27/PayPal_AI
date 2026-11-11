/**
 * Saved grid layouts (column order, width, visibility, sort) in localStorage.
 * Versioned and corruption-tolerant: anything unreadable is ignored.
 */

const VERSION = 1;
type Saved<T> = { v: number; state: T };

export function serializeGridState<T>(state: T): string {
  return JSON.stringify({ v: VERSION, state } satisfies Saved<T>);
}

export function parseGridState<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Saved<T>>;
    if (parsed?.v !== VERSION || !Array.isArray(parsed.state)) return null;
    return parsed.state;
  } catch {
    return null;
  }
}

export function loadGridState<T>(key: string): T | null {
  try {
    return parseGridState<T>(localStorage.getItem(`gg-grid:${key}`));
  } catch {
    return null;
  }
}

export function saveGridState<T>(key: string, state: T): void {
  try {
    localStorage.setItem(`gg-grid:${key}`, serializeGridState(state));
  } catch {
    // Storage full or blocked: the layout simply isn't remembered.
  }
}

export function clearGridState(key: string): void {
  try {
    localStorage.removeItem(`gg-grid:${key}`);
  } catch {
    // ignore
  }
}
