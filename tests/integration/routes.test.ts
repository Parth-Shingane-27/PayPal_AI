import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as approvePOST } from "@/app/api/approvals/[id]/approve/route";
import { GET as approvalsGET } from "@/app/api/approvals/route";
import { POST as demoPOST } from "@/app/api/auth/demo/route";
import { POST as chatPOST } from "@/app/api/chat/route";
import { GET as sessionGET } from "@/app/api/chat/sessions/[id]/route";
import { POST as capturePOST } from "@/app/api/checkout/capture/route";
import { POST as checkoutPOST } from "@/app/api/checkout/route";
import { POST as publishPOST } from "@/app/api/listings/[id]/publish/route";
import { POST as marketPOST } from "@/app/api/me/market/route";
import { GET as ordersGET } from "@/app/api/orders/route";
import { GET as productGET } from "@/app/api/products/[id]/route";
import { POST as productsPOST } from "@/app/api/products/route";
import { SESSION_COOKIE, signSession, verifySession } from "@/server/auth";
import { prisma } from "@/server/db";
import { addToCart } from "@/server/services/cart";
import { paypal } from "@/server/services/audit";
import { proposeRefund } from "@/server/services/refunds";
import { makeBuyer, makeListing, makePaidOrder, makeProduct, makeSeller, resetDb, sellerAudit } from "../helpers/db";
import { call, reply, text } from "../helpers/fake-model";

// The chat route uses the live model client; replace it with a scripted one.
const script = vi.hoisted(() => ({ steps: [] as unknown[], requests: [] as unknown[] }));
vi.mock("@/server/agents/model", async (orig) => {
  const actual = await orig<typeof import("@/server/agents/model")>();
  return {
    ...actual,
    liveModel: {
      async chat(params: unknown) {
        script.requests.push(params);
        const step = script.steps.shift();
        if (!step) throw new Error("no scripted step");
        return step;
      },
    },
  };
});
vi.mock("@/server/config", async (orig) => {
  const actual = await orig<typeof import("@/server/config")>();
  return {
    ...actual,
    groqConfig: () => ({
      GROQ_API_KEY: "test",
      GROQ_MODEL: "openai/gpt-oss-20b",
      GROQ_REASONING_EFFORT: "low" as const,
      GROQ_AGENT_MODEL: "openai/gpt-oss-120b",
      GROQ_AGENT_REASONING_EFFORT: "medium" as const,
    }),
  };
});

beforeEach(async () => {
  await resetDb();
  script.steps.length = 0;
  script.requests.length = 0;
  vi.restoreAllMocks();
});

const BASE = "http://localhost:3000";
const cookie = (role: "SELLER" | "BUYER", id: string, market: string | null = null) => `${SESSION_COOKIE}=${signSession({ role, id, market })}`;

function req(method: string, path: string, opts: { cookie?: string; body?: unknown; origin?: string } = {}) {
  const headers: Record<string, string> = { host: "localhost:3000" };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.origin) headers.origin = opts.origin;
  return new Request(`${BASE}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function readSse(res: Response) {
  const raw = await res.text();
  return raw
    .split("\n\n")
    .filter(Boolean)
    .map((chunk) => {
      const event = /^event: (.+)$/m.exec(chunk)![1]!;
      const data = JSON.parse(/^data: (.+)$/m.exec(chunk)![1]!);
      return { event, data };
    });
}

describe("auth", () => {
  it("signs and verifies sessions, rejecting tampering and expiry", () => {
    const id = "0190c0de-0000-7000-8000-000000000001";
    const token = signSession({ role: "SELLER", id, market: null });
    expect(verifySession(token)).toMatchObject({ role: "SELLER", id });
    const [data, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ role: "BUYER", id, market: null, exp: 9e9 })).toString("base64url");
    expect(verifySession(`${forged}.${sig}`)).toBeNull();
    expect(verifySession(`${data}.${sig}x`)).toBeNull();
    expect(verifySession(token, Date.now() + 8 * 24 * 3600 * 1000)).toBeNull();
  });

  it("demo login sets a signed cookie, and is off in production unless enabled", async () => {
    const seller = await makeSeller();
    const res = await demoPOST(req("POST", "/api/auth/demo", { body: { role: "SELLER", id: seller.id } }), undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_LOGIN", "false");
    expect((await demoPOST(req("POST", "/api/auth/demo", { body: { role: "SELLER", id: seller.id } }), undefined)).status).toBe(403);
    vi.unstubAllEnvs();
  });

  it("returns 401 without a session and 403 for the wrong role", async () => {
    const buyer = await makeBuyer();
    expect((await approvalsGET(req("GET", "/api/approvals"), undefined)).status).toBe(401);
    expect((await approvalsGET(req("GET", "/api/approvals", { cookie: cookie("BUYER", buyer.id) }), undefined)).status).toBe(403);
  });

  it("refuses cross-site mutations", async () => {
    const seller = await makeSeller();
    const res = await productsPOST(req("POST", "/api/products", { cookie: cookie("SELLER", seller.id), body: {}, origin: "https://evil.example" }), undefined);
    expect(res.status).toBe(403);
  });

  it("lets a buyer switch market through the signed cookie", async () => {
    const buyer = await makeBuyer();
    const res = await marketPOST(req("POST", "/api/me/market", { cookie: cookie("BUYER", buyer.id), body: { locale: "ja-JP" } }), undefined);
    const set = res.headers.get("set-cookie")!;
    const token = decodeURIComponent(/gc_session=([^;]+)/.exec(set)![1]!);
    expect(verifySession(token)).toMatchObject({ market: "ja-JP" });
  });
});

describe("seller routes", () => {
  it("creates a product, reads it back, and hides it from other sellers", async () => {
    const seller = await makeSeller();
    const other = await makeSeller();
    const body = { sku: "NEW-1", title: "Mug", description: "Stoneware mug", source_locale: "en-US", cost: "5.00", cost_currency: "USD", shipping: "3", margin_percent: "30", attributes: { capacity_ml: 350 } };
    const created = await productsPOST(req("POST", "/api/products", { cookie: cookie("SELLER", seller.id), body }), undefined);
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const mine = await productGET(req("GET", `/api/products/${id}`, { cookie: cookie("SELLER", seller.id) }), params(id));
    expect(((await mine.json()) as { product: { cost: { display: string } } }).product.cost.display).toBe("$5.00");
    expect((await productGET(req("GET", `/api/products/${id}`, { cookie: cookie("SELLER", other.id) }), params(id))).status).toBe(404);
    expect((await productGET(req("GET", "/api/products/not-a-uuid", { cookie: cookie("SELLER", seller.id) }), params("not-a-uuid"))).status).toBe(404);
    const bad = await productsPOST(req("POST", "/api/products", { cookie: cookie("SELLER", seller.id), body: { ...body, sku: "X", cost: "5.001" } }), undefined);
    expect(bad.status).toBe(400);
  });

  it("publishes a draft (the seller's approval click)", async () => {
    const seller = await makeSeller();
    const l = await makeListing(seller.id, (await makeProduct(seller.id)).id, { status: "DRAFT" });
    const res = await publishPOST(req("POST", `/api/listings/${l.id}/publish`, { cookie: cookie("SELLER", seller.id) }), params(l.id));
    expect(await res.json()).toEqual({ id: l.id, status: "PUBLISHED" });
  });

  it("approves through the route, and a second click is harmless", async () => {
    const seller = await makeSeller();
    const buyer = await makeBuyer();
    const l = await makeListing(seller.id, (await makeProduct(seller.id)).id);
    const { order } = await makePaidOrder(seller.id, buyer.id, l);
    const action = { id: crypto.randomUUID(), tool: "propose_refund", input: {} };
    await proposeRefund(seller.id, { orderId: order.id, amount: "5.00", reason: "r", rationale: "because" }, sellerAudit(seller.id), action);
    const refund = vi.spyOn(paypal, "refundCapture").mockResolvedValue({ refundId: "R-1", status: "COMPLETED", paypalFeeReturnedMinor: 0 });

    const list = (await (await approvalsGET(req("GET", "/api/approvals", { cookie: cookie("SELLER", seller.id) }), undefined)).json()) as { approvals: { id: string; rationale: string; refund: { amount: { display: string } } }[] };
    expect(list.approvals[0]).toMatchObject({ id: action.id, rationale: "because", refund: { amount: { display: "$5.00" } } });

    const first = await approvePOST(req("POST", `/api/approvals/${action.id}/approve`, { cookie: cookie("SELLER", seller.id) }), params(action.id));
    const second = await approvePOST(req("POST", `/api/approvals/${action.id}/approve`, { cookie: cookie("SELLER", seller.id) }), params(action.id));
    expect(await first.json()).toMatchObject({ status: "EXECUTED", already_decided: false });
    expect(await second.json()).toMatchObject({ status: "EXECUTED", already_decided: true });
    expect(refund).toHaveBeenCalledTimes(1);

    const mallory = await makeSeller();
    expect((await approvePOST(req("POST", `/api/approvals/${action.id}/approve`, { cookie: cookie("SELLER", mallory.id) }), params(action.id))).status).toBe(404);
  });
});

describe("buyer checkout routes", () => {
  it("creates the PayPal order, captures after approval, and lists the order", async () => {
    const seller = await makeSeller();
    const buyer = await makeBuyer();
    const l = await makeListing(seller.id, (await makeProduct(seller.id)).id, { price_minor: 4999 });
    const { carts } = await addToCart(buyer.id, "en-US", l.id, 1);
    vi.spyOn(paypal, "createOrder").mockResolvedValue({ id: "PP-R1", status: "PAYER_ACTION_REQUIRED", approveUrl: "https://sandbox/approve" });
    vi.spyOn(paypal, "captureOrder").mockResolvedValue({ paypalOrderId: "PP-R1", captureId: "CAP-R1", status: "COMPLETED", currency: "USD", grossMinor: 4999, paypalFeeMinor: 223, alreadyCaptured: false });

    const started = await checkoutPOST(req("POST", "/api/checkout", { cookie: cookie("BUYER", buyer.id), body: { cart_id: carts[0]!.cart_id } }), undefined);
    expect(await started.json()).toMatchObject({ paypal_order_id: "PP-R1", approve_url: "https://sandbox/approve" });
    const captured = await capturePOST(req("POST", "/api/checkout/capture", { cookie: cookie("BUYER", buyer.id), body: { paypal_order_id: "PP-R1" } }), undefined);
    expect(await captured.json()).toMatchObject({ order_status: "PAID", payment_status: "COMPLETED" });

    const mallory = await makeBuyer();
    expect((await capturePOST(req("POST", "/api/checkout/capture", { cookie: cookie("BUYER", mallory.id), body: { paypal_order_id: "PP-R1" } }), undefined)).status).toBe(404);
    const orders = (await (await ordersGET(req("GET", "/api/orders", { cookie: cookie("BUYER", buyer.id) }), undefined)).json()) as { orders: { status: string }[] };
    expect(orders.orders.map((o) => o.status)).toEqual(["PAID"]);
  });

  it("reports a declined instrument so the UI restarts PayPal", async () => {
    const seller = await makeSeller();
    const buyer = await makeBuyer();
    const l = await makeListing(seller.id, (await makeProduct(seller.id)).id);
    const { carts } = await addToCart(buyer.id, "en-US", l.id, 1);
    vi.spyOn(paypal, "createOrder").mockResolvedValue({ id: "PP-D", status: "PAYER_ACTION_REQUIRED", approveUrl: "u" });
    const { AppError } = await import("@/server/errors");
    vi.spyOn(paypal, "captureOrder").mockRejectedValue(new AppError("PAYMENT_DECLINED", "declined", { restart: true }));
    await checkoutPOST(req("POST", "/api/checkout", { cookie: cookie("BUYER", buyer.id), body: { cart_id: carts[0]!.cart_id } }), undefined);
    const res = await capturePOST(req("POST", "/api/checkout/capture", { cookie: cookie("BUYER", buyer.id), body: { paypal_order_id: "PP-D" } }), undefined);
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: { code: "PAYMENT_DECLINED", details: { restart: true } } });
  });
});

describe("chat over SSE", () => {
  it("streams tool progress and the final result; buyers stay on Shopping", async () => {
    const buyer = await makeBuyer();
    script.steps.push(reply([call("v", "view_cart", {})]), reply([text("Your cart is empty.")]));
    const res = await chatPOST(req("POST", "/api/chat", { cookie: cookie("BUYER", buyer.id, "en-US"), body: { text: "What's in my cart?", agent: "TREASURY" } }));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = await readSse(res);
    expect(events.map((e) => e.event)).toEqual(["session", "model_call", "tool_started", "tool_finished", "model_call", "result"]);
    const result = events.at(-1)!.data as { agent: string; turns: { reply: string }[]; sessionId: string };
    expect(result).toMatchObject({ agent: "SHOPPING", turns: [{ reply: "Your cart is empty." }] });

    const transcript = await sessionGET(req("GET", `/api/chat/sessions/${result.sessionId}`, { cookie: cookie("BUYER", buyer.id) }), params(result.sessionId));
    const body = (await transcript.json()) as { transcript: { role: string }[]; activity: { tool: string }[] };
    expect(body.transcript.map((t) => t.role)).toEqual(["user", "tool", "assistant"]);
    expect(body.activity.map((a) => a.tool).sort()).toEqual(["model.run", "view_cart"]);
    const other = await makeBuyer();
    expect((await sessionGET(req("GET", `/api/chat/sessions/${result.sessionId}`, { cookie: cookie("BUYER", other.id) }), params(result.sessionId))).status).toBe(404);
  });

  it("validates input before streaming", async () => {
    const seller = await makeSeller();
    expect((await chatPOST(req("POST", "/api/chat", { body: { text: "hi" } }))).status).toBe(401);
    const res = await chatPOST(req("POST", "/api/chat", { cookie: cookie("SELLER", seller.id), body: { text: "x".repeat(4001), agent: "TREASURY" } }));
    expect(res.status).toBe(400);
  });

  it("streams a readable error event when the conversation is busy", async () => {
    const seller = await makeSeller();
    const session = await prisma.agentSession.create({ data: { agent: "TREASURY", actor: "SELLER", seller_id: seller.id, locale: "en-US", status: "RUNNING", run_started_at: new Date() } });
    const res = await chatPOST(req("POST", "/api/chat", { cookie: cookie("SELLER", seller.id), body: { text: "hi", session_id: session.id } }));
    const events = await readSse(res);
    expect(events.at(-1)).toMatchObject({ event: "error", data: { code: "CONFLICT" } });
  });
});
