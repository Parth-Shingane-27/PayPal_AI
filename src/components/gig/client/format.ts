/** Small display helpers for the client pages (no money: amounts are always the API's display strings). */

const names = new Map<string, Intl.DisplayNames | null>();

/** A language code ("hi", "ta") as a name in the viewer's language, or the code itself. */
export function languageName(code: string, locale: string): string {
  let dn = names.get(locale);
  if (dn === undefined) {
    try {
      dn = new Intl.DisplayNames([locale], { type: "language" });
    } catch {
      dn = null;
    }
    names.set(locale, dn);
  }
  try {
    return dn?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** The milestone's delivery note: the note on its latest DELIVER event. */
export function deliveryNote(history: { event: string; note: string | null }[] | undefined): string | null {
  if (!history) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]!;
    if (h.event === "DELIVER") return h.note;
  }
  return null;
}
