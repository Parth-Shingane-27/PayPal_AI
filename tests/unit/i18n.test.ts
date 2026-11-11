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

  it("covers the navigation words in every language", () => {
    for (const lang of ["hi", "ja", "de", "fr", "es", "it"] as const) {
      const d = DICTIONARIES[lang] as Record<string, string>;
      for (const key of ["nav.overview", "nav.messages", "nav.approvals", "fl.nav.services", "cl.nav.projects", "status.PAID", "lang.label"]) {
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

describe("GlobalGig translations", () => {
  it("translate every GlobalGig key into every language, with the same placeholders", async () => {
    const { GIG_EN, GIG } = await import("@/lib/i18n/messages-gig");
    const parts = [
      [GIG_EN, GIG],
      await import("@/lib/i18n/messages-gig-shared").then((m) => [m.GIG_SHARED_EN, m.GIG_SHARED] as const),
      await import("@/lib/i18n/messages-gig-freelancer").then((m) => [m.GIG_FREELANCER_EN, m.GIG_FREELANCER] as const),
      await import("@/lib/i18n/messages-gig-client").then((m) => [m.GIG_CLIENT_EN, m.GIG_CLIENT] as const),
    ] as const;
    for (const [en, langs] of parts) {
      for (const [lang, dict] of Object.entries(langs as Record<string, Record<string, string>>)) {
        for (const [key, text] of Object.entries(en as Record<string, string>)) {
          expect(dict[key], `${lang} is missing ${key}`).toBeTruthy();
          expect(placeholders(dict[key]!), `${lang}: placeholders of ${key}`).toEqual(placeholders(text));
        }
      }
    }
  });
});
