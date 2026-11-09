import { describe, expect, it } from "vitest";
import { clampWidth, CONTENT_MIN, DOCK_FLOOR, DOCK_MIN, defaultWidth, maxWidth, nextKeyboardWidth } from "@/components/assistant/dock-store";

const SELLER_CHROME = 240; // the 15rem sidebar

describe("defaultWidth", () => {
  it("is a quarter of the screen", () => {
    expect(defaultWidth(1440)).toBe(360);
    expect(defaultWidth(2000)).toBe(500);
    expect(defaultWidth(1920)).toBe(480);
  });
  it("never goes below the usable floor on a small laptop", () => {
    expect(defaultWidth(1024)).toBe(DOCK_FLOOR);
    expect(defaultWidth(1100)).toBe(DOCK_FLOOR);
  });
});

describe("maxWidth and clampWidth", () => {
  it("allows up to half the screen when there is room", () => {
    expect(maxWidth(1440, SELLER_CHROME)).toBe(720);
    expect(maxWidth(1920, SELLER_CHROME)).toBe(960);
  });

  it("keeps the page content from being squeezed below its minimum", () => {
    // 1100 - 240 sidebar - 480 content leaves 380, less than half the screen.
    expect(maxWidth(1100, SELLER_CHROME)).toBe(1100 - SELLER_CHROME - CONTENT_MIN);
    // Buyers have no sidebar, so the same screen allows more.
    expect(maxWidth(1100, 0)).toBe(550);
  });

  it("never offers a maximum below the minimum width, however small the screen", () => {
    expect(maxWidth(800, SELLER_CHROME)).toBe(DOCK_MIN);
  });

  it("clamps a dragged width between the minimum and the maximum", () => {
    expect(clampWidth(100, 1440, SELLER_CHROME)).toBe(DOCK_MIN);
    expect(clampWidth(9999, 1440, SELLER_CHROME)).toBe(720);
    expect(clampWidth(400.4, 1440, SELLER_CHROME)).toBe(400);
  });
});

describe("nextKeyboardWidth", () => {
  const w = 360;
  it("widens with Left and narrows with Right, because the handle is on the panel's left edge", () => {
    expect(nextKeyboardWidth(w, "ArrowLeft", false, 1440, SELLER_CHROME)).toBe(376);
    expect(nextKeyboardWidth(w, "ArrowRight", false, 1440, SELLER_CHROME)).toBe(344);
  });
  it("moves in bigger steps with Shift", () => {
    expect(nextKeyboardWidth(w, "ArrowLeft", true, 1440, SELLER_CHROME)).toBe(408);
    expect(nextKeyboardWidth(w, "ArrowRight", true, 1440, SELLER_CHROME)).toBe(312);
  });
  it("stops at the limits", () => {
    expect(nextKeyboardWidth(DOCK_MIN, "ArrowRight", false, 1440, SELLER_CHROME)).toBe(DOCK_MIN);
    expect(nextKeyboardWidth(720, "ArrowLeft", false, 1440, SELLER_CHROME)).toBe(720);
  });
  it("jumps to the minimum with Home and the maximum with End", () => {
    expect(nextKeyboardWidth(w, "Home", false, 1440, SELLER_CHROME)).toBe(DOCK_MIN);
    expect(nextKeyboardWidth(w, "End", false, 1440, SELLER_CHROME)).toBe(720);
  });
  it("ignores other keys", () => {
    expect(nextKeyboardWidth(w, "a", false, 1440, SELLER_CHROME)).toBeNull();
    expect(nextKeyboardWidth(w, "ArrowUp", false, 1440, SELLER_CHROME)).toBeNull();
  });
});
