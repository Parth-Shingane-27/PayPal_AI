import { DICTIONARIES, type MessageKey } from "./messages";

/** Interface languages. The choice is a cookie, so server and client render the same text. */
export const UI_LANGS = [
  { code: "en", name: "English", locale: "en-GB" },
  { code: "hi", name: "हिन्दी", locale: "hi-IN" },
  { code: "ja", name: "日本語", locale: "ja-JP" },
  { code: "de", name: "Deutsch", locale: "de-DE" },
  { code: "fr", name: "Français", locale: "fr-FR" },
  { code: "es", name: "Español", locale: "es-ES" },
  { code: "it", name: "Italiano", locale: "it-IT" },
] as const;
export type UiLang = (typeof UI_LANGS)[number]["code"];
export const LANG_COOKIE = "gc-lang";

export function isUiLang(v: string | undefined | null): v is UiLang {
  return UI_LANGS.some((l) => l.code === v);
}

export function localeOf(lang: UiLang): string {
  return UI_LANGS.find((l) => l.code === lang)?.locale ?? "en-GB";
}

export type Vars = Record<string, string | number>;
export type Translate = (key: MessageKey, vars?: Vars) => string;

/** Looks up a message, falling back to English, and fills {placeholders}. */
export function translator(lang: UiLang): Translate {
  const dict = DICTIONARIES[lang];
  const en = DICTIONARIES.en;
  return (key, vars) => {
    let text: string = dict[key] ?? en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v));
    return text;
  };
}
