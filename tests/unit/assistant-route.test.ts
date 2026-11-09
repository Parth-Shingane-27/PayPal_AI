import { describe, expect, it } from "vitest";
import { AGENTS_FOR, chatStorageKey, defaultAgentFor, productIdFor, subPath } from "@/components/assistant/route-context";

const S = "01a1b236-510d-736c-a260-e22beec1e533";
const P = "f61d6857-5e73-436b-a4a3-868ee894fdcf";

describe("subPath", () => {
  it("returns what follows the account id", () => {
    expect(subPath(`/seller/${S}`)).toBe("");
    expect(subPath(`/seller/${S}/`)).toBe("");
    expect(subPath(`/seller/${S}/treasury?period=last_30_days`)).toBe("treasury");
    expect(subPath(`/seller/${S}/products/${P}`)).toBe(`products/${P}`);
    expect(subPath(`/buyer/${S}/shop`)).toBe("shop");
    expect(subPath("/login")).toBe("");
  });
});

describe("defaultAgentFor", () => {
  it("follows the seller's page", () => {
    expect(defaultAgentFor(`/seller/${S}/treasury`, "SELLER")).toBe("TREASURY");
    expect(defaultAgentFor(`/seller/${S}/operations`, "SELLER")).toBe("OPERATIONS");
    expect(defaultAgentFor(`/seller/${S}/products`, "SELLER")).toBe("LISTING");
    expect(defaultAgentFor(`/seller/${S}/products/${P}`, "SELLER")).toBe("LISTING");
  });
  it("falls back to the routing assistant on the other seller pages", () => {
    for (const sub of ["", "ledger", "messages", "approvals", "activity", "assistant"]) {
      expect(defaultAgentFor(`/seller/${S}/${sub}`, "SELLER"), sub).toBe("ASSISTANT");
    }
  });
  it("gives buyers the shopping assistant everywhere", () => {
    for (const sub of ["", "shop", "cart", "orders", "messages"]) expect(defaultAgentFor(`/buyer/${S}/${sub}`, "BUYER"), sub).toBe("SHOPPING");
  });
  it("only ever picks an agent that role may use", () => {
    for (const sub of ["", "treasury", "operations", "products", "shop"]) {
      expect(AGENTS_FOR.SELLER).toContain(defaultAgentFor(`/seller/${S}/${sub}`, "SELLER"));
      expect(AGENTS_FOR.BUYER).toContain(defaultAgentFor(`/buyer/${S}/${sub}`, "BUYER"));
    }
  });
});

describe("productIdFor", () => {
  it("finds the product on its editor page only", () => {
    expect(productIdFor(`/seller/${S}/products/${P}`)).toBe(P);
    expect(productIdFor(`/seller/${S}/products`)).toBeUndefined();
    expect(productIdFor(`/seller/${S}/treasury`)).toBeUndefined();
  });
});

describe("chatStorageKey", () => {
  it("matches the keys the earlier chat panels used, so saved conversations are found again", () => {
    expect(chatStorageKey("TREASURY")).toBe("globalcart.chat.TREASURY.-.-");
    expect(chatStorageKey("OPERATIONS")).toBe("globalcart.chat.OPERATIONS.-.-");
    expect(chatStorageKey("ASSISTANT")).toBe("globalcart.chat.ASSISTANT.-.-");
    expect(chatStorageKey("LISTING", P)).toBe(`globalcart.chat.LISTING.${P}.-`);
    expect(chatStorageKey("LISTING", undefined, "new-product")).toBe("globalcart.chat.LISTING.-.new-product");
    expect(chatStorageKey("SHOPPING", undefined, "hi-IN")).toBe("globalcart.chat.SHOPPING.-.hi-IN");
  });
});
