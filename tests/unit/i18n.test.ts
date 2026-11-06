import { describe, expect, it } from "vitest";
import { isUiLang, translator, UI_LANGS } from "@/lib/i18n/core";
import { DICTIONARIES } from "@/lib/i18n/messages";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe("interface translations", () => {
  const en = DICTIONARIES.en as Record<string, string>;

  it("has a dictionary for every offered language", () => {
    for (const l of UI_LANGS) expect(DICTIONARIES[l.code]).toBeDefined();
  });

  it("only translates keys that exist in English, with the same placeholders", () => {
    for (const [lang, dict] of Object.entries(DICTIONARIES)) {
      for (const [key, text] of Object.entries(dict as Record<string, string>)) {
        expect(en[key], `${lang}: unknown key ${key}`).toBeDefined();
        expect(placeholders(text), `${lang}: placeholders of ${key}`).toEqual(placeholders(en[key]!));
      }
    }
  });

  it("covers the navigation and chart words in every language", () => {
    for (const lang of ["hi", "ja", "de", "fr", "es", "it"] as const) {
      const d = DICTIONARIES[lang] as Record<string, string>;
      for (const key of ["nav.overview", "nav.messages", "nav.products", "col.status", "chart.reachedYou", "status.PAID", "lang.label"]) {
        expect(d[key], `${lang} is missing ${key}`).toBeTruthy();
      }
    }
  });

  it("fills placeholders and falls back to English", () => {
    const t = translator("de");
    expect(t("shell.sellsFrom", { country: "DE", currency: "EUR" })).toBe("Verkauft aus DE in EUR");
    // A key French does not translate falls back to the English text.
    const fr = DICTIONARIES.fr as Record<string, string>;
    const missing = Object.keys(en).find((k) => !(k in fr));
    if (missing) expect(translator("fr")(missing as never)).toBe(en[missing]);
  });

  it("recognises only offered language codes", () => {
    expect(isUiLang("ja")).toBe(true);
    expect(isUiLang("xx")).toBe(false);
    expect(isUiLang(undefined)).toBe(false);
  });
});
