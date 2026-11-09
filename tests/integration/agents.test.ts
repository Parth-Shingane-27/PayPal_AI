import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendMessage } from "@/server/agents/orchestrator";
import { ROUTER_PROMPT } from "@/server/agents/router-prompt";
import { AGENTS } from "@/server/agents/registry";
import { historyOf } from "@/server/agents/sessions";
import { toChatTools } from "@/server/agents/tool";
import { frankfurter } from "@/server/clients/frankfurter";
import { voyage } from "@/server/clients/voyage";
import { prisma } from "@/server/db";
import { paypal } from "@/server/services/audit";
import { makeBuyer, makeListing, makePaidOrder, makeProduct, makeSeller, resetDb } from "../helpers/db";
import { call, historyIn, lastResponses, reply, scriptedModel, type SentRequest, text } from "../helpers/fake-model";

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

const deps = (model: ReturnType<typeof scriptedModel>["model"]) => ({ model, reasoningEffort: "medium" as const, modelId: "openai/gpt-oss-120b" });

/** Tool results of the last turn: ok results carry `output`, failures `error`. */
function lastResults(params: SentRequest) {
  return lastResponses(params).map((r) => {
    const response = r.response as { output?: Record<string, unknown>; error?: Record<string, unknown> };
    return { is_error: Boolean(response.error), json: (response.output ?? response.error)! };
  });
}

/** The first user message (the session_context block). */
function contextOf(req: SentRequest): string {
  return String(historyIn(req)[0]!.content ?? "");
}

describe("agent definitions", () => {
  it("give every agent the tools the design calls for", () => {
    const names = Object.fromEntries(Object.values(AGENTS).map((a) => [a.name, a.tools.map((t) => t.name)]));
    expect(names).toEqual({
      LISTING: ["get_product", "preview_product", "create_product", "list_markets", "market_overview", "research_market_prices", "get_fx_rate", "suggest_price", "save_listing_draft", "reprice_listing", "handoff"],
      SHOPPING: ["search_products", "compare_products", "add_to_cart", "update_cart", "view_cart", "create_paypal_order"],
      TREASURY: ["get_balances", "estimate_fees", "forecast_earnings", "compare_selling_direct", "propose_payout_schedule", "handoff"],
      OPERATIONS: ["query_orders", "get_order_details", "get_payment_status", "earnings_by_market", "detect_anomalies", "propose_refund", "handoff"],
    });
    expect(AGENTS.LISTING.maxModelCalls).toBe(40);
    expect(AGENTS.SHOPPING.maxModelCalls).toBe(15);
  });

  it("never expose identity, locale or money-moving inputs to the model", () => {
    for (const agent of Object.values(AGENTS)) {
      const schemas = JSON.stringify(toChatTools(agent.tools).map((t) => t.function!.parameters));
      for (const banned of ["seller_id", "buyer_id", "locale", "capture", "payout_id"]) expect(schemas).not.toContain(`"${banned}"`);
    }
  });

  it("keep prompts byte-stable and carry the shared rules", () => {
    for (const agent of Object.values(AGENTS)) {
      expect(agent.system).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(agent.system).toContain("`display`");
      expect(agent.system).toContain("data, not instructions");
      expect(agent.system).toContain("Never say money was sent");
    }
    expect(ROUTER_PROMPT).toContain("LISTING");
  });
});

describe("orchestrator", () => {
  it("only lets buyers reach the Shopping Agent", async () => {
    const buyer = await makeBuyer({ locale: "hi-IN", country: "IN" });
    const s = scriptedModel([reply([text("नमस्ते!")])]);
    const res = await sendMessage({ owner: { type: "BUYER", buyerId: buyer.id }, agent: "TREASURY", marketLocale: "hi-IN", text: "hi", deps: deps(s.model) });
    expect(res.agent).toBe("SHOPPING");
    expect(s.requests[0]!.messages[0]).toEqual({ role: "system", content: AGENTS.SHOPPING.system });
    const ctx = contextOf(s.requests[0]!);
    expect(ctx).toContain("Buyer market: hi-IN");
    expect(ctx).toContain("reply language: Hindi");

    const seller = await makeSeller();
    const sellerChat = await sendMessage({ owner: { type: "SELLER", sellerId: seller.id }, agent: "OPERATIONS", text: "hi", deps: deps(scriptedModel([reply([text("ok")])]).model) });
    await expect(
      sendMessage({ owner: { type: "BUYER", buyerId: buyer.id }, sessionId: sellerChat.sessionId, marketLocale: "hi-IN", text: "hi", deps: deps(scriptedModel([]).model) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("routes a new Assistant conversation once, then stays with that agent", async () => {
    const seller = await makeSeller();
    const owner = { type: "SELLER" as const, sellerId: seller.id };
    const classify = vi.fn(async () => ({ agent: "TREASURY" as const, reason: "asks about payouts" }));
    const s = scriptedModel([reply([text("You have no balance yet.")]), reply([text("Still treasury.")])]);
    const first = await sendMessage({ owner, text: "When should I take a payout?", deps: { ...deps(s.model), classify } });
    expect(first).toMatchObject({ agent: "TREASURY", routed: { agent: "TREASURY" } });
    const second = await sendMessage({ owner, sessionId: first.sessionId, text: "and refunds?", deps: { ...deps(s.model), classify } });
    expect(second.agent).toBe("TREASURY");
    expect(classify).toHaveBeenCalledTimes(1);
  });

  it("hands off once, seeds the target with the summary, and blocks a second handoff", async () => {
    const seller = await makeSeller();
    const owner = { type: "SELLER" as const, sellerId: seller.id };
    const s = scriptedModel([
      reply([call("h1", "handoff", { agent: "TREASURY", summary: "Seller wants to know their available USD balance." })]),
      reply([text("Passing you to Treasury.")]),
      // Target agent tries to hand off again; the runtime refuses.
      reply([call("h2", "handoff", { agent: "OPERATIONS", summary: "bounce" })]),
      (params) => {
        expect(lastResults(params)[0]!.is_error).toBe(true);
        return reply([call("b1", "get_balances", {})]);
      },
      reply([text("Your balance is shown above.")]),
    ]);
    const res = await sendMessage({ owner, agent: "OPERATIONS", text: "How much can I withdraw?", deps: deps(s.model) });
    expect(res.handoff).toMatchObject({ from: "OPERATIONS", to: "TREASURY" });
    expect(res.turns.map((t) => t.agent)).toEqual(["OPERATIONS", "TREASURY"]);
    expect(res.sessionId).toBe(res.handoff!.sessionId);
    const child = await prisma.agentSession.findUniqueOrThrow({ where: { id: res.sessionId } });
    expect(child).toMatchObject({ agent: "TREASURY", parent_id: res.turns[0]!.sessionId });
    const seeded = historyOf(child)
      .slice(0, 2)
      .map((m) => String(m.content));
    expect(seeded[0]).toContain("handed over by the operations assistant");
    expect(seeded[0]).toContain("available USD balance");
    expect(seeded[1]).toBe("How much can I withdraw?");
  });

  it("refuses a handoff to the same agent", async () => {
    const seller = await makeSeller();
    const s = scriptedModel([
      reply([call("h1", "handoff", { agent: "OPERATIONS", summary: "x" })]),
      (params) => {
        expect(lastResults(params)[0]).toMatchObject({ is_error: true });
        return reply([text("I'll handle it.")]);
      },
    ]);
    const res = await sendMessage({ owner: { type: "SELLER", sellerId: seller.id }, agent: "OPERATIONS", text: "x", deps: deps(s.model) });
    expect(res.handoff).toBeNull();
  });
});

describe("Listing Agent flow", () => {
  it("prices three markets in parallel and saves drafts at exactly the quoted prices", async () => {
    vi.spyOn(frankfurter, "getRate").mockImplementation(async (from, to) => ({
      from, to, rate: ({ "USD->EUR": 0.9, "USD->JPY": 150, "USD->USD": 1 } as Record<string, number>)[`${from}->${to}`]!, date: "2026-11-04", source: "ECB via Frankfurter",
    }));
    const seller = await makeSeller();
    const product = await makeProduct(seller.id);
    const markets = ["de-DE", "ja-JP", "hi-IN"];
    const texts: Record<string, { title: string; description: string; seo_title: string }> = {
      "de-DE": { title: "Handgeschnitztes Walnuss-Servierbrett", description: "Aus amerikanischem Walnussholz, 40 x 20 cm.", seo_title: "Walnuss-Servierbrett handgeschnitzt, 40 x 20 cm" },
      "ja-JP": { title: "手彫りウォールナット サービングボード", description: "ウォールナット材。40×20cm。", seo_title: "手彫りウォールナット サービングボード 40×20cm" },
      "hi-IN": { title: "अखरोट की लकड़ी का सर्विंग बोर्ड", description: "40 x 20 सेमी।", seo_title: "हाथ से बना अखरोट सर्विंग बोर्ड" },
    };
    const s = scriptedModel([
      reply([call("g", "get_product", { product_id: product.id })]),
      reply(
        markets.map((m, i) => call(`q${i}`, "suggest_price", { product_id: product.id, market: m, competitor_low: null, competitor_high: null, target_price: null, positioning: null }))),
      (params) => {
        const quotes = lastResults(params);
        expect(quotes).toHaveLength(3);
        return reply(
          quotes.map((q, i) => call(`s${i}`, "save_listing_draft", { quote_id: q.json.quote_id, ...texts[markets[i]!]! })));
      },
      reply([text("| Market | Price | Profit | Margin | Check |")]),
    ]);
    const res = await sendMessage({
      owner: { type: "SELLER", sellerId: seller.id }, agent: "LISTING", productId: product.id, text: "Localize this for Germany, Japan and India.", deps: deps(s.model),
    });
    expect(res.turns[0]!.outcome).toBe("completed");
    const listings = await prisma.listing.findMany({ where: { product_id: product.id }, orderBy: { locale: "asc" } });
    expect(listings.map((l) => [l.locale, l.status, l.currency])).toEqual([
      ["de-DE", "DRAFT", "EUR"],
      ["hi-IN", "DRAFT", "USD"],
      ["ja-JP", "DRAFT", "JPY"],
    ]);
    const quoteRows = await prisma.agentAction.findMany({ where: { tool: "suggest_price" } });
    for (const l of listings) {
      const q = quoteRows.find((r) => (r.output as { locale: string }).locale === l.locale)!;
      expect(l.price_minor).toBe((q.output as { suggested_price: { amount_minor: number } }).suggested_price.amount_minor);
      expect([...l.seo_title].length).toBeLessThanOrEqual(70);
    }
    expect(contextOf(s.requests[0]!)).toContain(`editor of product ${product.id}`);
  });

  it("previews a described product, creates it only after the seller replies, then drafts a listing", async () => {
    vi.spyOn(frankfurter, "getRate").mockImplementation(async (from, to) => ({ from, to, rate: from === to ? 1 : 1.1, date: "2026-11-04", source: "ECB via Frankfurter" }));
    const seller = await makeSeller();
    const owner = { type: "SELLER" as const, sellerId: seller.id };
    const mug = {
      title: "Hand-thrown stoneware mug",
      description: "A 12 oz stoneware mug, thrown on the wheel.",
      written_in: null,
      cost: "18",
      shipping: "9",
      cost_currency: "EUR",
      margin_percent: "40",
      sku: null,
      material: "Stoneware",
      size: "12 oz",
    };
    let previewId = "";
    const s = scriptedModel([
      reply([call("p", "preview_product", mug)]),
      (params) => {
        const preview = lastResults(params)[0]!;
        expect(preview.json).toMatchObject({ summary: { sku: "HAND-THROWN-STONEWARE-MUG", sku_generated: true, margin_percent: 40, material: "Stoneware" } });
        previewId = String(preview.json.preview_id);
        // Creating in the same reply as the preview is refused: the seller has not seen it yet.
        return reply([call("c0", "create_product", { preview_id: previewId })]);
      },
      (params) => {
        expect(lastResults(params)[0]).toMatchObject({ is_error: true });
        return reply([text("Here is the summary. Shall I create it?")]);
      },
      // Next message: the seller confirmed.
      () => reply([call("c1", "create_product", { preview_id: previewId })]),
      (params) => {
        const created = lastResults(params)[0]!;
        expect(created.is_error).toBe(false);
        return reply([call("q", "suggest_price", { product_id: created.json.product_id, market: "en-US", competitor_low: null, competitor_high: null, target_price: null, positioning: null })]);
      },
      (params) =>
        reply([call("d", "save_listing_draft", { quote_id: lastResults(params)[0]!.json.quote_id, title: "Stoneware mug", description: "12 oz mug.", seo_title: "Hand-thrown 12 oz stoneware mug" })]),
      reply([text("| Market | Price | Profit | Margin | Check |")]),
    ]);

    const first = await sendMessage({ owner, agent: "LISTING", text: "New product: 12 oz stoneware mug, costs me 18 EUR + 9 EUR shipping, 40% margin.", deps: deps(s.model) });
    expect(await prisma.product.count()).toBe(0);
    await sendMessage({ owner, sessionId: first.sessionId, text: "Yes, create it and list it in the US.", deps: deps(s.model) });

    const product = await prisma.product.findFirstOrThrow({ where: { seller_id: seller.id }, include: { listings: true } });
    expect(product).toMatchObject({ sku: "HAND-THROWN-STONEWARE-MUG", cost_minor: 1800, shipping_minor: 900, cost_currency: "EUR", margin_bps: 4000, attributes: { material: "Stoneware", size: "12 oz" } });
    expect(product.listings.map((l) => [l.locale, l.status])).toEqual([["en-US", "DRAFT"]]);
  });

  it("refuses to create a product from another conversation's preview", async () => {
    const seller = await makeSeller();
    const owner = { type: "SELLER" as const, sellerId: seller.id };
    const other = await sendMessage({ owner, agent: "LISTING", text: "hi", deps: deps(scriptedModel([reply([text("hi")])]).model) });
    const preview = await prisma.agentAction.create({
      data: { kind: "TOOL", tool: "preview_product", input: {}, output: { form: {} }, status: "SUCCEEDED", actor: "SELLER", seller_id: seller.id, session_id: other.sessionId },
    });
    const s = scriptedModel([
      reply([call("c", "create_product", { preview_id: preview.id })]),
      (params) => {
        expect(lastResults(params)[0]!.json).toMatchObject({ code: "NOT_FOUND" });
        return reply([text("I need to preview it first.")]);
      },
    ]);
    await sendMessage({ owner, agent: "LISTING", text: "create it", deps: deps(s.model) });
    expect(await prisma.product.count()).toBe(0);
  });

  it("rejects a quote from another seller", async () => {
    const seller = await makeSeller();
    const other = await makeSeller();
    const theirQuote = await prisma.agentAction.create({
      data: { kind: "TOOL", tool: "suggest_price", input: {}, output: { product_id: "x", locale: "de-DE", suggested_price: { amount_minor: 1 } }, status: "SUCCEEDED", actor: "SELLER", seller_id: other.id },
    });
    const s = scriptedModel([
      reply([call("s", "save_listing_draft", { quote_id: theirQuote.id, title: "t", description: "d", seo_title: "s" })]),
      (params) => {
        expect(lastResults(params)[0]!.json).toMatchObject({ code: "NOT_FOUND" });
        return reply([text("I need a price quote first.")]);
      },
    ]);
    await sendMessage({ owner: { type: "SELLER", sellerId: seller.id }, agent: "LISTING", text: "save it", deps: deps(s.model) });
    expect(await prisma.listing.count()).toBe(0);
  });
});

describe("Shopping Agent flow", () => {
  it("searches, adds to cart and starts checkout without capturing", async () => {
    const seller = await makeSeller();
    const buyer = await makeBuyer({ locale: "hi-IN", country: "IN" });
    const l = await makeListing(seller.id, (await makeProduct(seller.id)).id, { locale: "hi-IN", price_minor: 5499, title: "अखरोट सर्विंग बोर्ड" });
    await prisma.$executeRaw`UPDATE listings SET embedding = ${`[${Array.from({ length: 1024 }, () => 0.01).join(",")}]`}::vector WHERE id = ${l.id}::uuid`;
    vi.spyOn(voyage, "embed").mockResolvedValue([Array.from({ length: 1024 }, () => 0.01)]);
    const createOrder = vi.spyOn(paypal, "createOrder").mockResolvedValue({ id: "PP-123", status: "PAYER_ACTION_REQUIRED", approveUrl: "https://www.sandbox.paypal.com/checkoutnow?token=PP-123" });
    const capture = vi.spyOn(paypal, "captureOrder");

    const s = scriptedModel([
      reply([call("s", "search_products", { query: "लकड़ी का सर्विंग बोर्ड", limit: null })]),
      (params) => {
        const hit = (lastResults(params)[0]!.json.results as { listing_id: string }[])[0]!;
        return reply([call("a", "add_to_cart", { listing_id: hit.listing_id, quantity: 1 })]);
      },
      (params) => {
        const cart = (lastResults(params)[0]!.json.carts as { cart_id: string }[])[0]!;
        return reply([call("c", "create_paypal_order", { cart_id: cart.cart_id })]);
      },
      reply([text("कृपया PayPal विंडो में भुगतान स्वीकृत करें।")]),
    ]);
    const res = await sendMessage({ owner: { type: "BUYER", buyerId: buyer.id }, marketLocale: "hi-IN", text: "मुझे लकड़ी का सर्विंग बोर्ड चाहिए, खरीदना है", deps: deps(s.model) });
    const turn = res.turns[0]!;
    expect(turn.checkoutLinks).toEqual([expect.objectContaining({ paypal_order_id: "PP-123", approve_url: expect.stringContaining("checkoutnow"), charged: false })]);
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(capture).not.toHaveBeenCalled();
    expect(await prisma.payment.findFirstOrThrow()).toMatchObject({ status: "CREATED", gross_minor: 5499, currency: "USD" });
  });
});

describe("Treasury and Operations flows", () => {
  it("proposes a payout when asked to 'just send it' and executes nothing", async () => {
    const seller = await makeSeller();
    const buyer = await makeBuyer();
    const l = await makeListing(seller.id, (await makeProduct(seller.id)).id, { price_minor: 10000 });
    await makePaidOrder(seller.id, buyer.id, l, { paypalFee: 400, platformFee: 500 });
    const s = scriptedModel([
      reply([call("b", "get_balances", {})]),
      reply([call("p", "propose_payout_schedule", { currency: "USD", payouts: [{ amount: "ALL_AVAILABLE", date: new Date().toISOString().slice(0, 10) }], rationale: "Seller asked for an immediate payout." })]),
      reply([text("Proposed; it is waiting for your approval.")]),
    ]);
    const res = await sendMessage({ owner: { type: "SELLER", sellerId: seller.id }, agent: "TREASURY", text: "Just send the payout now", deps: deps(s.model) });
    expect(res.turns[0]!.pendingApprovals).toHaveLength(1);
    expect(await prisma.payout.count({ where: { status: { not: "PROPOSED" } } })).toBe(0);
    expect(await prisma.agentAction.count({ where: { status: "PENDING_APPROVAL" } })).toBe(1);
  });

  it("explains a refund request on a fully refunded order", async () => {
    const seller = await makeSeller();
    const buyer = await makeBuyer();
    const l = await makeListing(seller.id, (await makeProduct(seller.id)).id, { price_minor: 10000 });
    const { order, payment } = await makePaidOrder(seller.id, buyer.id, l);
    await prisma.refund.create({ data: { payment_id: payment.id, order_id: order.id, seller_id: seller.id, currency: "USD", amount_minor: 10000, reason: "Broken", status: "COMPLETED", seller_debit_minor: 9500 } });
    const s = scriptedModel([
      reply([call("r", "propose_refund", { order_id: order.id, amount: null, reason: "again", rationale: "seller asked" })]),
      (params) => {
        expect(lastResults(params)[0]!.json).toMatchObject({ code: "NOT_REFUNDABLE", message: expect.stringContaining("already been fully refunded") });
        return reply([text("That order was already fully refunded.")]);
      },
    ]);
    await sendMessage({ owner: { type: "SELLER", sellerId: seller.id }, agent: "OPERATIONS", text: `Refund order ${order.id}`, deps: deps(s.model) });
    expect(await prisma.refund.count()).toBe(1);
  });
});
