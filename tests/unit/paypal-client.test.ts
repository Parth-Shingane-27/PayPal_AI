import { describe, expect, it, vi } from "vitest";
import { type CallContext, PayPalApiError, PayPalClient, type PayPalCallRecord } from "@/server/clients/paypal";
import { AppError } from "@/server/errors";

const ctx: CallContext = { actor: "SYSTEM" };
const config = () => ({
  PAYPAL_ENV: "sandbox" as const,
  PAYPAL_CLIENT_ID: "id",
  PAYPAL_CLIENT_SECRET: "secret",
  PAYPAL_BRAND_NAME: "GlobalCart",
  baseUrl: "https://api.test",
});

type Route = (url: string, init: RequestInit) => Response | Promise<Response>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const token = (n = 1) => json(200, { access_token: `tok${n}`, expires_in: 3600 });

/** A fetch stub that answers the token endpoint and delegates everything else. */
function stub(api: Route) {
  let tokens = 0;
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init: init ?? {} });
    if (u.endsWith("/v1/oauth2/token")) return token(++tokens);
    return api(u, init ?? {});
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls, tokenCount: () => tokens };
}

function client(fetch: typeof globalThis.fetch, extra: { now?: () => number; records?: PayPalCallRecord[] } = {}) {
  return new PayPalClient({
    config,
    fetch,
    sleep: async () => {},
    now: extra.now,
    record: async (_ctx, r) => {
      extra.records?.push(r);
    },
  });
}

const header = (init: RequestInit, name: string) => (init.headers as Record<string, string>)[name];

const capturedOrder = (captureOverrides: Record<string, unknown> = {}) => ({
  id: "PP-ORDER",
  status: "COMPLETED",
  purchase_units: [
    {
      reference_id: "order-1",
      shipping: { name: { full_name: "Ava" } },
      payments: {
        captures: [
          {
            id: "CAP-1",
            status: "COMPLETED",
            amount: { currency_code: "USD", value: "49.99" },
            seller_receivable_breakdown: {
              gross_amount: { currency_code: "USD", value: "49.99" },
              paypal_fee: { currency_code: "USD", value: "2.23" },
              net_amount: { currency_code: "USD", value: "47.76" },
            },
            ...captureOverrides,
          },
        ],
      },
    },
  ],
});

describe("PayPal OAuth", () => {
  it("caches the token until a minute before expiry", async () => {
    let now = 0;
    const s = stub(() => json(200, capturedOrder()));
    const c = client(s.fetch, { now: () => now });
    await c.getOrder(ctx, "A");
    await c.getOrder(ctx, "A");
    expect(s.tokenCount()).toBe(1);
    now = 3600_000 - 59_000; // inside the last minute
    await c.getOrder(ctx, "A");
    expect(s.tokenCount()).toBe(2);
  });

  it("refreshes once on 401 and retries", async () => {
    let n = 0;
    const s = stub((_u, init) => {
      n++;
      if (n === 1) return json(401, { name: "AUTHENTICATION_FAILURE" });
      expect(header(init, "Authorization")).toBe("Bearer tok2");
      return json(200, capturedOrder());
    });
    const order = await client(s.fetch).getOrder(ctx, "A");
    expect(order.id).toBe("PP-ORDER");
    expect(s.tokenCount()).toBe(2);
  });

  it("does not loop on repeated 401s", async () => {
    const s = stub(() => json(401, { name: "AUTHENTICATION_FAILURE" }));
    await expect(client(s.fetch).getOrder(ctx, "A")).rejects.toBeInstanceOf(PayPalApiError);
    expect(s.tokenCount()).toBe(2);
  });
});

describe("PayPal retries", () => {
  it("retries GETs on 503", async () => {
    let n = 0;
    const s = stub(() => (++n < 3 ? json(503, {}) : json(200, capturedOrder())));
    await client(s.fetch).getOrder(ctx, "A");
    expect(n).toBe(3);
  });

  it("retries writes that carry a request id, with the same id", async () => {
    const ids: (string | undefined)[] = [];
    let n = 0;
    const s = stub((_u, init) => {
      ids.push(header(init, "PayPal-Request-Id"));
      return ++n < 2 ? json(500, {}) : json(201, capturedOrder());
    });
    await client(s.fetch).captureOrder(ctx, "PP-ORDER", "req-1");
    expect(ids).toEqual(["req-1", "req-1"]);
  });

  it("does not retry a 4xx", async () => {
    let n = 0;
    const s = stub(() => {
      n++;
      return json(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_NOT_APPROVED" }] });
    });
    await expect(client(s.fetch).captureOrder(ctx, "PP", "req")).rejects.toMatchObject({ issues: ["ORDER_NOT_APPROVED"] });
    expect(n).toBe(1);
  });

  it("records failures and successes for the audit log", async () => {
    const records: PayPalCallRecord[] = [];
    const s = stub(() => json(404, { name: "RESOURCE_NOT_FOUND" }));
    await expect(client(s.fetch, { records }).getOrder(ctx, "X")).rejects.toThrow(/404/);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ operation: "orders.get", httpStatus: 404 });
    expect(records[0]!.error).toMatch(/RESOURCE_NOT_FOUND/);
  });
});

describe("PayPal orders", () => {
  it("creates an order with the required shape and returns the payer-action link", async () => {
    let body: Record<string, unknown> = {};
    let init: RequestInit = {};
    const s = stub((_u, i) => {
      init = i;
      body = JSON.parse(String(i.body));
      return json(201, {
        id: "PP-1",
        status: "PAYER_ACTION_REQUIRED",
        links: [
          { href: "https://api.test/v2/checkout/orders/PP-1", rel: "self" },
          { href: "https://www.sandbox.paypal.com/checkoutnow?token=PP-1", rel: "payer-action" },
        ],
      });
    });
    const res = await client(s.fetch).createOrder(ctx, {
      orderId: "order-1",
      invoiceId: "order-1-uuid",
      currency: "JPY",
      items: [{ name: "Board", sku: "WB", quantity: 2, unitMinor: 7980 }],
      totalMinor: 15960,
      locale: "hi-IN",
      returnUrl: "https://app/return",
      cancelUrl: "https://app/cancel",
    });
    expect(res.approveUrl).toContain("checkoutnow");
    expect(header(init, "PayPal-Request-Id")).toBe("order-1-uuid");
    expect(header(init, "Prefer")).toBe("return=representation");
    expect(body).toMatchObject({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: "order-1",
          custom_id: "order-1",
          invoice_id: "order-1-uuid",
          amount: { currency_code: "JPY", value: "15960", breakdown: { item_total: { currency_code: "JPY", value: "15960" } } },
          items: [{ name: "Board", sku: "WB", quantity: "2", unit_amount: { value: "7980" }, category: "PHYSICAL_GOODS" }],
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "GlobalCart",
            locale: "en-IN",
            user_action: "PAY_NOW",
            shipping_preference: "GET_FROM_FILE",
            return_url: "https://app/return",
            cancel_url: "https://app/cancel",
          },
        },
      },
    });
  });

  it("refuses an order whose items do not add up", async () => {
    const s = stub(() => json(201, {}));
    await expect(
      client(s.fetch).createOrder(ctx, {
        orderId: "o", invoiceId: "o-1", currency: "USD", totalMinor: 100,
        items: [{ name: "x", sku: "x", quantity: 1, unitMinor: 99 }],
        locale: "en-US", returnUrl: "r", cancelUrl: "c",
      }),
    ).rejects.toThrow(/does not match/);
  });

  it("parses a capture and its PayPal fee", async () => {
    const s = stub(() => json(201, capturedOrder()));
    const cap = await client(s.fetch).captureOrder(ctx, "PP-ORDER", "req");
    expect(cap).toMatchObject({ captureId: "CAP-1", grossMinor: 4999, paypalFeeMinor: 223, currency: "USD", alreadyCaptured: false });
  });

  it("ignores a PayPal fee in a different currency", async () => {
    const s = stub(() =>
      json(
        201,
        capturedOrder({
          seller_receivable_breakdown: {
            gross_amount: { currency_code: "USD", value: "49.99" },
            paypal_fee: { currency_code: "EUR", value: "2.00" },
          },
        }),
      ),
    );
    const cap = await client(s.fetch).captureOrder(ctx, "PP-ORDER", "req");
    expect(cap.paypalFeeMinor).toBeNull();
  });

  it("reports a currency conversion when PayPal converted the receivable", async () => {
    const s = stub(() =>
      json(
        201,
        capturedOrder({
          amount: { currency_code: "JPY", value: "7980" },
          seller_receivable_breakdown: {
            gross_amount: { currency_code: "JPY", value: "7980" },
            paypal_fee: { currency_code: "JPY", value: "318" },
            net_amount: { currency_code: "JPY", value: "7662" },
            receivable_amount: { currency_code: "USD", value: "47.10" },
            exchange_rate: { source_currency: "JPY", target_currency: "USD", value: "0.00614723" },
          },
        }),
      ),
    );
    const cap = await client(s.fetch).captureOrder(ctx, "PP-ORDER", "req");
    expect(cap.paypalFeeMinor).toBe(318);
    expect(cap.conversion).toEqual({ netMinor: 7662, receivableCurrency: "USD", receivableMinor: 4710, rate: 0.00614723 });
  });

  it("reads the existing capture on ORDER_ALREADY_CAPTURED", async () => {
    const s = stub((u) =>
      u.endsWith("/capture")
        ? json(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_ALREADY_CAPTURED" }] })
        : json(200, capturedOrder()),
    );
    const cap = await client(s.fetch).captureOrder(ctx, "PP-ORDER", "req");
    expect(cap).toMatchObject({ captureId: "CAP-1", alreadyCaptured: true, grossMinor: 4999 });
  });

  it("turns INSTRUMENT_DECLINED into a restartable PAYMENT_DECLINED", async () => {
    const s = stub(() => json(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INSTRUMENT_DECLINED" }] }));
    const err = await client(s.fetch).captureOrder(ctx, "PP-ORDER", "req").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: "PAYMENT_DECLINED", details: { restart: true } });
  });
});

describe("PayPal refunds and payouts", () => {
  it("refunds with the request id and reads the returned fee", async () => {
    let init: RequestInit = {};
    const s = stub((_u, i) => {
      init = i;
      return json(201, {
        id: "R-1",
        status: "COMPLETED",
        seller_payable_breakdown: { paypal_fee: { currency_code: "EUR", value: "0.50" } },
      });
    });
    const r = await client(s.fetch).refundCapture(ctx, { captureId: "CAP", amountMinor: 1000, currency: "EUR", requestId: "ref-1", note: "sorry" });
    expect(r).toEqual({ refundId: "R-1", status: "COMPLETED", paypalFeeReturnedMinor: 50 });
    expect(header(init, "PayPal-Request-Id")).toBe("ref-1");
    expect(JSON.parse(String(init.body))).toMatchObject({ amount: { value: "10.00", currency_code: "EUR" } });
  });

  it("treats a returned fee in another currency as zero", async () => {
    const s = stub(() =>
      json(201, { id: "R", status: "PENDING", seller_payable_breakdown: { paypal_fee: { currency_code: "USD", value: "1.00" } } }),
    );
    const r = await client(s.fetch).refundCapture(ctx, { captureId: "C", amountMinor: 500, currency: "EUR", requestId: "x", note: "n" });
    expect(r.paypalFeeReturnedMinor).toBe(0);
  });

  it("creates a payout batch with sender_batch_id as the request id", async () => {
    let init: RequestInit = {};
    const s = stub((_u, i) => {
      init = i;
      return json(201, { batch_header: { payout_batch_id: "B-1", batch_status: "PENDING" } });
    });
    const res = await client(s.fetch).createPayout(ctx, {
      senderBatchId: "payout-1", receiver: "s@x.test", amountMinor: 12345, currency: "USD", note: "n", senderItemId: "payout-1",
    });
    expect(res).toMatchObject({ batchId: "B-1", status: "PENDING", feeMinor: null });
    expect(header(init, "PayPal-Request-Id")).toBe("payout-1");
    expect(JSON.parse(String(init.body))).toMatchObject({
      sender_batch_header: { sender_batch_id: "payout-1" },
      items: [{ recipient_type: "EMAIL", receiver: "s@x.test", amount: { currency: "USD", value: "123.45" }, sender_item_id: "payout-1" }],
    });
  });

  it("reads batch fees only in the payout currency", async () => {
    const s = stub(() =>
      json(200, {
        batch_header: { payout_batch_id: "B", batch_status: "SUCCESS", fees: { currency: "USD", value: "0.25" } },
        items: [{ payout_item_id: "I", payout_batch_id: "B", payout_item: {}, transaction_status: "SUCCESS" }],
      }),
    );
    const c = client(s.fetch);
    expect(await c.getPayoutBatch(ctx, "B", "USD")).toMatchObject({ status: "SUCCESS", feeMinor: 25, itemStatus: "SUCCESS" });
    expect((await c.getPayoutBatch(ctx, "B", "EUR")).feeMinor).toBeNull();
  });

  it("verifies webhook signatures", async () => {
    const s = stub(() => json(200, { verification_status: "FAILURE" }));
    const ok = await client(s.fetch).verifyWebhookSignature(ctx, {
      webhookId: "W", authAlgo: "SHA256withRSA", certUrl: "https://c", transmissionId: "t", transmissionSig: "s", transmissionTime: "now", event: { id: "E" },
    });
    expect(ok).toBe(false);
  });
});
