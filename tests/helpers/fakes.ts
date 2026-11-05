import { randomUUID } from "node:crypto";
import type { FxApi } from "@/server/clients/frankfurter";
import { type CaptureResult, type PayPalApi, PayPalApiError, type PayoutBatchResult, type PayPalOrderStatus, type RefundResult } from "@/server/clients/paypal";

/** Fixed-rate FX: rates[`${from}->${to}`], 1 for the same currency. */
export function fakeFx(rates: Record<string, number> = {}): FxApi {
  return {
    async getRate(from, to) {
      const rate = from === to ? 1 : rates[`${from}->${to}`];
      if (rate === undefined) throw new Error(`fakeFx has no rate ${from}->${to}`);
      return { from, to, rate, date: "2026-11-04", source: "ECB via Frankfurter" as const };
    },
  };
}

type Calls = { op: string; args: unknown[] }[];

/**
 * In-memory PayPal. Behaviour can be overridden per test; every call is
 * logged in `calls`.
 */
export function fakePayPal(over: Partial<PayPalApi> = {}) {
  const calls: Calls = [];
  const orders = new Map<string, { status: PayPalOrderStatus; total: number; currency: string }>();
  const log = (op: string, args: unknown[]) => calls.push({ op, args });

  const api: PayPalApi = {
    async createOrder(ctx, input) {
      log("createOrder", [ctx, input]);
      const id = `PP-${randomUUID().slice(0, 8)}`;
      orders.set(id, { status: "PAYER_ACTION_REQUIRED", total: input.totalMinor, currency: input.currency });
      return { id, status: "PAYER_ACTION_REQUIRED", approveUrl: `https://sandbox.paypal.test/checkoutnow?token=${id}` };
    },
    async getOrder(ctx, id) {
      log("getOrder", [ctx, id]);
      const o = orders.get(id);
      if (!o) throw new PayPalApiError(404, { name: "RESOURCE_NOT_FOUND" });
      return { id, status: o.status };
    },
    async captureOrder(ctx, id, requestId): Promise<CaptureResult> {
      log("captureOrder", [ctx, id, requestId]);
      const o = orders.get(id);
      if (!o) throw new Error(`fake: unknown order ${id}`);
      o.status = "COMPLETED";
      return {
        paypalOrderId: id,
        captureId: `CAP-${id}`,
        status: "COMPLETED",
        currency: o.currency,
        grossMinor: o.total,
        paypalFeeMinor: Math.round(o.total * 0.0349) + 49,
        shipping: { name: { full_name: "Test Buyer" } },
        alreadyCaptured: false,
      };
    },
    async refundCapture(ctx, input): Promise<RefundResult> {
      log("refundCapture", [ctx, input]);
      return { refundId: `R-${randomUUID().slice(0, 8)}`, status: "COMPLETED", paypalFeeReturnedMinor: 0 };
    },
    async createPayout(ctx, input): Promise<PayoutBatchResult> {
      log("createPayout", [ctx, input]);
      return { batchId: `B-${input.senderBatchId}`, status: "PENDING", feeMinor: null };
    },
    async getPayoutBatch(ctx, batchId, currency): Promise<PayoutBatchResult> {
      log("getPayoutBatch", [ctx, batchId, currency]);
      return { batchId, status: "SUCCESS", feeMinor: 25, itemStatus: "SUCCESS" };
    },
    async verifyWebhookSignature(ctx, input) {
      log("verifyWebhookSignature", [ctx, input]);
      return true;
    },
  };
  // Overrides are logged like the defaults.
  for (const [name, fn] of Object.entries(over) as [keyof PayPalApi, (...a: unknown[]) => unknown][]) {
    (api as Record<string, unknown>)[name] = (...args: unknown[]) => {
      log(name, args);
      return fn(...args);
    };
  }
  return { api, calls, orders, count: (op: string) => calls.filter((c) => c.op === op).length };
}
