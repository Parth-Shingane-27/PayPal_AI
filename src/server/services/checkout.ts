import { randomUUID } from "node:crypto";
import type { Payment } from "@/generated/prisma/client";
import { type FxApi, frankfurter } from "../clients/frankfurter";
import { type CaptureResult, PayPalApiError, type PayPalApi, type PayPalOrderStatus } from "../clients/paypal";
import { coreConfig } from "../config";
import { type Db, prisma } from "../db";
import { estimateSaleFees, FEE_TABLE } from "../domain/fees";
import { getMarket } from "../domain/markets";
import { applyBps, convertMinor, money } from "../domain/money";
import { AppError, notFound } from "../errors";
import { asJson, type AuditCtx, paypal as defaultPaypal, toCallContext } from "./audit";
import { OPEN_STATUSES } from "./cart";
import { lockBuyer } from "./locks";

/**
 * PayPal checkout. The buyer's click in the PayPal popup is the approval;
 * capture happens in a normal API route after approval, never in a tool.
 */

const REUSABLE: ReadonlySet<PayPalOrderStatus> = new Set(["CREATED", "SAVED", "APPROVED", "PAYER_ACTION_REQUIRED"]);

type CheckoutDeps = { paypal?: PayPalApi; fx?: FxApi };

type CheckoutStarted = {
  order_id: string;
  paypal_order_id: string;
  approve_url: string;
  total: ReturnType<typeof money>;
  reused: boolean;
  prices_updated: boolean;
};

/**
 * Creates (or reuses) the PayPal order for one cart. Holds the buyer lock for
 * the whole step so two clicks cannot create two PayPal orders.
 */
export async function startCheckout(buyerId: string, orderId: string, audit: AuditCtx, deps: CheckoutDeps = {}): Promise<CheckoutStarted> {
  const pp = deps.paypal ?? defaultPaypal;
  const cfg = coreConfig();
  return prisma.$transaction(
    async (tx) => {
      await lockBuyer(tx, buyerId);
      const order = await tx.order.findFirst({
        where: { id: orderId, buyer_id: buyerId, status: { in: OPEN_STATUSES } },
        include: { items: { include: { listing: true } } },
      });
      if (!order) throw notFound("Cart");
      if (order.items.length === 0) throw new AppError("INVALID_INPUT", "This cart is empty.");

      // Re-validate every item against the live listing and refresh snapshots.
      let pricesUpdated = false;
      for (const item of order.items) {
        if (item.listing.status !== "PUBLISHED") {
          throw new AppError("CONFLICT", `"${item.title}" is no longer available. Remove it from the cart to continue.`);
        }
        if (item.listing.price_minor !== item.unit_price_minor || item.listing.title !== item.title) {
          pricesUpdated = true;
          await tx.orderItem.update({
            where: { id: item.id },
            data: { unit_price_minor: item.listing.price_minor, title: item.listing.title },
          });
          item.unit_price_minor = item.listing.price_minor;
          item.title = item.listing.title;
        }
      }
      const total = order.items.reduce((s, i) => s + i.unit_price_minor * i.quantity, 0);
      const callCtx = toCallContext(audit, order.seller_id);

      if (order.status === "PENDING_PAYMENT") {
        const pending = await tx.payment.findFirst({
          where: { order_id: order.id, status: "CREATED" },
          orderBy: { created_at: "desc" },
        });
        if (pending?.approve_url && pending.gross_minor === total && !pricesUpdated) {
          let status: PayPalOrderStatus | "GONE";
          try {
            status = (await pp.getOrder(callCtx, pending.paypal_order_id)).status;
          } catch (err) {
            if (err instanceof PayPalApiError && err.status === 404) status = "GONE";
            else throw err;
          }
          if (REUSABLE.has(status as PayPalOrderStatus)) {
            return {
              order_id: order.id,
              paypal_order_id: pending.paypal_order_id,
              approve_url: pending.approve_url,
              total: money(total, order.currency, order.locale),
              reused: true,
              prices_updated: false,
            };
          }
          if (status === "COMPLETED") {
            throw new AppError("CONFLICT", "This cart was already paid in PayPal. Refresh your orders to see it.", {
              paypal_order_id: pending.paypal_order_id,
            });
          }
        }
        // 404, VOIDED, a changed total: the old attempt is dead. Reset to CART.
        await tx.payment.updateMany({ where: { order_id: order.id, status: "CREATED" }, data: { status: "VOIDED" } });
        await tx.order.update({ where: { id: order.id }, data: { status: "CART" } });
      }

      const invoiceId = `${order.id}-${randomUUID()}`;
      const created = await pp.createOrder(callCtx, {
        orderId: order.id,
        invoiceId,
        currency: order.currency,
        items: order.items.map((i) => ({ name: i.title, sku: i.sku, quantity: i.quantity, unitMinor: i.unit_price_minor })),
        totalMinor: total,
        locale: order.locale,
        returnUrl: `${cfg.APP_URL}/checkout/return?order=${order.id}`,
        cancelUrl: `${cfg.APP_URL}/cart?cancelled=${order.id}`,
      });
      await tx.payment.create({
        data: {
          order_id: order.id,
          seller_id: order.seller_id,
          paypal_order_id: created.id,
          invoice_id: invoiceId,
          status: "CREATED",
          currency: order.currency,
          gross_minor: total,
          approve_url: created.approveUrl,
        },
      });
      await tx.order.update({ where: { id: order.id }, data: { status: "PENDING_PAYMENT" } });
      return {
        order_id: order.id,
        paypal_order_id: created.id,
        approve_url: created.approveUrl,
        total: money(total, order.currency, order.locale),
        reused: false,
        prices_updated: pricesUpdated,
      };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

type Settlement = {
  paypal_fee_minor: number;
  fee_is_estimate: boolean;
  platform_fee_minor: number;
  fx_cost_minor: number;
  net_to_seller_minor: number;
};

/**
 * Fees for a captured payment. PayPal's actual fee is used when it is in the
 * capture currency; otherwise the estimate table is used and flagged. FX cost
 * is the gap between PayPal's conversion and the ECB mid rate, when PayPal
 * converted the money.
 */
export async function settle(
  payment: Pick<Payment, "currency" | "seller_id" | "order_id">,
  cap: Pick<CaptureResult, "grossMinor" | "paypalFeeMinor" | "conversion">,
  fx: FxApi,
  db: Db = prisma,
): Promise<Settlement> {
  const order = await db.order.findUniqueOrThrow({ where: { id: payment.order_id }, include: { seller: true } });
  const platformBps = coreConfig().PLATFORM_FEE_BPS;
  let feeIsEstimate = false;
  let paypalFee = cap.paypalFeeMinor;
  if (paypalFee === null) {
    const market = getMarket(order.locale);
    const est = estimateSaleFees(cap.grossMinor, {
      currency: payment.currency,
      marketCountry: market.country,
      sellerCountry: order.seller.country,
      sellerCurrency: order.seller.currency,
      platformBps,
    });
    paypalFee = est.paypal_fee + est.international_fee;
    feeIsEstimate = true;
  }

  let fxCost = 0;
  if (cap.conversion) {
    const c = cap.conversion;
    try {
      const mid = await fx.getRate(c.receivableCurrency, payment.currency);
      fxCost = Math.max(0, c.netMinor - convertMinor(c.receivableMinor, c.receivableCurrency, payment.currency, mid.rate));
    } catch {
      fxCost = applyBps(c.netMinor, FEE_TABLE.conversion_bps);
      feeIsEstimate = true;
    }
  }

  const platformFee = applyBps(cap.grossMinor, platformBps);
  return {
    paypal_fee_minor: paypalFee,
    fee_is_estimate: feeIsEstimate,
    platform_fee_minor: platformFee,
    fx_cost_minor: fxCost,
    net_to_seller_minor: cap.grossMinor - paypalFee - platformFee - fxCost,
  };
}

export type CaptureOutcome = {
  order_id: string;
  order_status: string;
  payment_status: string;
  total: ReturnType<typeof money>;
  already_captured: boolean;
};

/**
 * Records a capture result on a payment. Only CREATED or PENDING payments move
 * forward; a payment that is already settled is returned unchanged.
 */
export async function applyCapture(paymentId: string, cap: CaptureResult, fx: FxApi = frankfurter): Promise<CaptureOutcome> {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { order: true } });
  if (cap.currency !== payment.currency || cap.grossMinor !== payment.gross_minor) {
    throw new Error(
      `Capture ${cap.captureId} is ${cap.grossMinor} ${cap.currency}, payment ${payment.id} expects ${payment.gross_minor} ${payment.currency}`,
    );
  }

  if (cap.status === "COMPLETED" || cap.status === "REFUNDED" || cap.status === "PARTIALLY_REFUNDED") {
    const s = await settle(payment, cap, fx);
    await prisma.$transaction(async (tx) => {
      const moved = await tx.payment.updateMany({
        where: { id: payment.id, status: { in: ["CREATED", "PENDING"] } },
        data: {
          status: "COMPLETED",
          capture_id: cap.captureId,
          captured_at: new Date(),
          failure_reason: null,
          ...s,
        },
      });
      if (moved.count === 1) {
        await tx.order.update({
          where: { id: payment.order_id },
          data: { status: "PAID", paid_at: new Date(), shipping: cap.shipping === undefined ? undefined : asJson(cap.shipping) },
        });
      }
    });
  } else if (cap.status === "PENDING") {
    await prisma.payment.updateMany({
      where: { id: payment.id, status: "CREATED" },
      data: { status: "PENDING", capture_id: cap.captureId, failure_reason: cap.statusReason ?? null },
    });
  } else {
    // DECLINED or FAILED: the buyer can try again from the cart.
    await prisma.$transaction(async (tx) => {
      const moved = await tx.payment.updateMany({
        where: { id: payment.id, status: { in: ["CREATED", "PENDING"] } },
        data: { status: cap.status === "DECLINED" ? "DECLINED" : "FAILED", capture_id: cap.captureId, failure_reason: cap.statusReason ?? cap.status },
      });
      if (moved.count === 1) {
        await tx.order.updateMany({ where: { id: payment.order_id, status: "PENDING_PAYMENT" }, data: { status: "CART" } });
      }
    });
  }
  return captureOutcome(payment.id, cap.alreadyCaptured);
}

async function captureOutcome(paymentId: string, alreadyCaptured: boolean): Promise<CaptureOutcome> {
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { order: true } });
  return {
    order_id: p.order_id,
    order_status: p.order.status,
    payment_status: p.status,
    total: money(p.gross_minor, p.currency, p.order.locale),
    already_captured: alreadyCaptured,
  };
}

/** Called by the capture route after the buyer approved in PayPal. Idempotent. */
export async function captureCheckout(
  buyerId: string,
  paypalOrderId: string,
  audit: AuditCtx,
  deps: CheckoutDeps = {},
): Promise<CaptureOutcome> {
  const pp = deps.paypal ?? defaultPaypal;
  const payment = await prisma.payment.findFirst({ where: { paypal_order_id: paypalOrderId, order: { buyer_id: buyerId } } });
  if (!payment) throw notFound("Payment");
  if (payment.status === "COMPLETED" || (payment.status === "PENDING" && payment.capture_id)) {
    return captureOutcome(payment.id, true);
  }
  if (payment.status === "VOIDED") {
    throw new AppError("CONFLICT", "This checkout was replaced because the cart changed. Please start checkout again.", { restart: true });
  }
  if (payment.status !== "CREATED") {
    throw new AppError("CONFLICT", `This payment is ${payment.status.toLowerCase()} and cannot be captured. Please start checkout again.`, {
      restart: true,
    });
  }
  const cap = await pp.captureOrder(toCallContext(audit, payment.seller_id), paypalOrderId, `capture-${payment.id}`);
  return applyCapture(payment.id, cap, deps.fx ?? frankfurter);
}
