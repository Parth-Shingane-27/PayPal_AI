import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contrast checks on the real design tokens in globals.css, for both themes.
 * Text needs 4.5:1 on its surface (WCAG AA); chart marks need 3:1.
 */
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1]!, m[2]!]));
}

const themes = { light: block(":root"), dark: block(':root[data-theme="dark"]') } as const;

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe.each(Object.entries(themes))("%s theme tokens", (_name, t) => {
  it("keeps body and secondary text readable on the page and card surfaces (4.5:1)", () => {
    for (const surface of ["paper", "sheet", "sheet-2"]) {
      for (const ink of ["ink", "ink-2", "ink-3"]) {
        expect(contrast(t[ink]!, t[surface]!), `${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps each chart colour distinguishable from the card surface (3:1)", () => {
    for (let i = 1; i <= 5; i++) expect(contrast(t[`series-${i}`]!, t.sheet!), `series-${i}`).toBeGreaterThanOrEqual(3);
  });

  it("has all five chart slots, and none is gold or green", () => {
    for (let i = 1; i <= 5; i++) {
      const hex = t[`series-${i}`];
      expect(hex, `series-${i}`).toMatch(/^#[0-9a-f]{6}$/i);
      const [r, g, b] = [1, 3, 5].map((k) => parseInt(hex!.slice(k, k + 2), 16)) as [number, number, number];
      // Green dominant: green channel clearly above both red and blue.
      expect(g > r + 20 && g > b + 20, `series-${i} ${hex} reads green`).toBe(false);
      // Gold: red and green high, blue low.
      expect(r > 170 && g > 130 && b < 90, `series-${i} ${hex} reads gold`).toBe(false);
    }
  });
});
