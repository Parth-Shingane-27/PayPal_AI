import { describe, expect, it } from "vitest";
import { identityFromCookie, legacyRedirect } from "@/lib/legacy-redirect";
import { buyerPath, isUuid, sellerPath } from "@/lib/routes";

const SELLER = "01a1b222-a0a1-73c8-b686-07974d538bd0";
const BUYER = "01a1b222-b1b2-7c3d-a4e5-0123456789ab";

/** A cookie shaped like the app's session: base64url(JSON payload).signature */
const cookie = (role: "SELLER" | "BUYER", id: string) => {
  const payload = Buffer.from(JSON.stringify({ role, id, market: null, exp: 9999999999 })).toString("base64url");
  return `theme=x; gc_session=${payload}.signature; other=1`;
};

describe("account paths", () => {
  it("builds seller and buyer addresses", () => {
    expect(sellerPath(SELLER)).toBe(`/seller/${SELLER}`);
    expect(sellerPath(SELLER, "ledger")).toBe(`/seller/${SELLER}/ledger`);
    expect(sellerPath(SELLER, "/products/abc")).toBe(`/seller/${SELLER}/products/abc`);
    expect(buyerPath(BUYER, "checkout/return")).toBe(`/buyer/${BUYER}/checkout/return`);
  });
  it("recognises ids", () => {
    expect(isUuid(SELLER)).toBe(true);
    expect(isUuid("ledger")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});

describe("legacy address redirects", () => {
  it("lets account addresses and unrelated paths through", () => {
    expect(legacyRedirect(`/seller/${SELLER}/ledger`, "", cookie("SELLER", SELLER))).toBeNull();
    expect(legacyRedirect(`/buyer/${BUYER}`, "", null)).toBeNull();
    expect(legacyRedirect("/login", "", null)).toBeNull();
    expect(legacyRedirect("/api/orders", "", null)).toBeNull();
  });

  it("moves old seller pages under the signed-in seller, keeping the query", () => {
    const c = cookie("SELLER", SELLER);
    expect(legacyRedirect("/seller", "", c)).toBe(`/seller/${SELLER}`);
    expect(legacyRedirect("/seller/ledger", "?tab=products&period=all_time", c)).toBe(`/seller/${SELLER}/ledger?tab=products&period=all_time`);
    expect(legacyRedirect("/seller/products/123", "", c)).toBe(`/seller/${SELLER}/products/123`);
  });

  it("moves old buyer pages under the signed-in buyer", () => {
    const c = cookie("BUYER", BUYER);
    expect(legacyRedirect("/buyer", "", c)).toBe(`/buyer/${BUYER}`);
    expect(legacyRedirect("/buyer/messages", "?c=9", c)).toBe(`/buyer/${BUYER}/messages?c=9`);
    expect(legacyRedirect("/shop", "", c)).toBe(`/buyer/${BUYER}/shop`);
    expect(legacyRedirect("/cart", "?cancelled=o1", c)).toBe(`/buyer/${BUYER}/cart?cancelled=o1`);
    expect(legacyRedirect("/orders", "", c)).toBe(`/buyer/${BUYER}/orders`);
    // A PayPal return URL saved before per-account links still lands in the right place.
    expect(legacyRedirect("/checkout/return", "?token=T&order=o1", c)).toBe(`/buyer/${BUYER}/checkout/return?token=T&order=o1`);
  });

  it("sends signed-out and wrong-role visitors to /login", () => {
    expect(legacyRedirect("/seller/ledger", "", null)).toBe("/login");
    expect(legacyRedirect("/shop", "", cookie("SELLER", SELLER))).toBe("/login");
    expect(legacyRedirect("/seller", "", cookie("BUYER", BUYER))).toBe("/login");
    expect(legacyRedirect("/seller", "", "gc_session=garbage")).toBe("/login");
  });

  it("reads the session cookie among others and ignores bad ids", () => {
    expect(identityFromCookie(cookie("BUYER", BUYER))).toEqual({ role: "BUYER", id: BUYER });
    expect(identityFromCookie(cookie("BUYER", "not-a-uuid"))).toBeNull();
    expect(identityFromCookie("a=b")).toBeNull();
  });
});
