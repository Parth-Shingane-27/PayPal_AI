import { z } from "zod";
import {
  captureFromResource,
  type PayPalApi,
  payoutBatchFromResource,
  payoutBatchId,
  refundFromResource,
} from "../clients/paypal";
import { paypalWebhookId, proactiveEnabled } from "../config";
import { prisma } from "../db";
import { enqueueWatch } from "../queue";
import { asJson, paypal as defaultPaypal, SYSTEM, toCallContext } from "./audit";
import { applyCapture } from "./checkout";
import { applyBatchResult } from "./payouts";
import { syncOrderRefundStatus } from "./refunds";

/**
 * PayPal webhooks. The worker's HTTP route verifies the signature with PayPal,
 * stores each event once (event id is the primary key), queues it, and
 * returns 200. The queued job calls processWebhookEvent.
 */

export const webhookEventSchema = z.object({
  id: z.string().min(1),
  event_type: z.string().min(1),
  resource_type: z.string().optional(),
  resource: z.unknown(),
});
export type WebhookEventBody = z.infer<typeof webhookEventSchema>;

export type WebhookHeaders = {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
};

export async function verifyWebhook(headers: WebhookHeaders, event: unknown, pp: PayPalApi = defaultPaypal): Promise<boolean> {
  return pp.verifyWebhookSignature(toCallContext(SYSTEM), { webhookId: paypalWebhookId(), ...headers, event });
}

/** Returns false when the event id was already stored (a redelivery). */
export async function storeWebhookEvent(event: WebhookEventBody): Promise<boolean> {
  const resourceId = z.object({ id: z.string() }).safeParse(event.resource);
  const created = await prisma.webhookEvent.createMany({
    data: [
      {
        id: event.id,
        event_type: event.event_type,
        resource_type: event.resource_type ?? null,
        resource_id: resourceId.success ? resourceId.data.id : null,
        payload: asJson(event),
      },
    ],
    skipDuplicates: true,
  });
  return created.count === 1;
}

type Outcome = { status: "PROCESSED" | "IGNORED"; note?: string; sellerId?: string };

async function handleCapture(resource: unknown): Promise<Outcome> {
  const cap = captureFromResource(resource);
  const payment = await prisma.payment.findFirst({
    where: { OR: [{ capture_id: cap.captureId }, ...(cap.paypalOrderId ? [{ paypal_order_id: cap.paypalOrderId }] : [])] },
  });
  if (!payment) return { status: "IGNORED", note: `No payment for capture ${cap.captureId}` };
  await applyCapture(payment.id, { ...cap, paypalOrderId: payment.paypal_order_id });
  return { status: "PROCESSED", sellerId: payment.seller_id };
}

async function handleRefund(resource: unknown, reversed: boolean): Promise<Outcome> {
  const r = refundFromResource(resource);
  const known = await prisma.refund.findUnique({ where: { paypal_refund_id: r.refundId } });
  if (known) {
    if (known.status === "PENDING" && r.status === "COMPLETED") {
      await prisma.$transaction(async (tx) => {
        await tx.refund.update({ where: { id: known.id }, data: { status: "COMPLETED", completed_at: new Date() } });
        await syncOrderRefundStatus(tx, known.order_id);
      });
    } else if (known.status === "PENDING" && (r.status === "FAILED" || r.status === "CANCELLED")) {
      await prisma.$transaction(async (tx) => {
        await tx.refund.update({ where: { id: known.id }, data: { status: "FAILED", error: `PayPal refund ${r.status}` } });
        await syncOrderRefundStatus(tx, known.order_id);
      });
    }
    return { status: "PROCESSED", sellerId: known.seller_id };
  }

  // A refund or reversal made outside GlobalCart: record it so the ledger is right.
  if (!r.captureId) return { status: "IGNORED", note: `Refund ${r.refundId} has no capture link` };
  const payment = await prisma.payment.findUnique({ where: { capture_id: r.captureId } });
  if (!payment) return { status: "IGNORED", note: `No payment for capture ${r.captureId}` };
  if (r.status !== "COMPLETED" && r.status !== "PENDING") return { status: "IGNORED", note: `Refund status ${r.status}` };
  const status = r.status;
  const platformReturned = Math.round(((payment.platform_fee_minor ?? 0) * r.amountMinor) / payment.gross_minor);
  await prisma.$transaction(async (tx) => {
    await tx.refund.create({
      data: {
        payment_id: payment.id,
        order_id: payment.order_id,
        seller_id: payment.seller_id,
        currency: r.currency,
        amount_minor: r.amountMinor,
        reason: reversed ? "Payment reversed by PayPal (chargeback or dispute)." : "Refunded directly in PayPal, outside GlobalCart.",
        status,
        paypal_refund_id: r.refundId,
        paypal_fee_returned_minor: r.paypalFeeReturnedMinor,
        platform_fee_returned_minor: platformReturned,
        seller_debit_minor: r.amountMinor - r.paypalFeeReturnedMinor - platformReturned,
        completed_at: status === "COMPLETED" ? new Date() : null,
      },
    });
    await syncOrderRefundStatus(tx, payment.order_id);
  });
  return { status: "PROCESSED", sellerId: payment.seller_id };
}

async function handlePayoutBatch(resource: unknown): Promise<Outcome> {
  const batchId = payoutBatchId(resource);
  const payout = await prisma.payout.findUnique({ where: { paypal_batch_id: batchId } });
  if (!payout) return { status: "IGNORED", note: `No payout for batch ${batchId}` };
  await applyBatchResult(payout.id, payoutBatchFromResource(resource, payout.currency));
  return { status: "PROCESSED", sellerId: payout.seller_id };
}

/** Processes one stored event. Errors are recorded and rethrown so the job retries. */
export async function processWebhookEvent(eventId: string): Promise<Outcome | { status: "SKIPPED" }> {
  const event = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
  if (!event || event.status === "PROCESSED" || event.status === "IGNORED") return { status: "SKIPPED" };
  const resource = (event.payload as { resource?: unknown }).resource;
  try {
    let handled: Outcome;
    const t = event.event_type;
    if (t === "PAYMENT.CAPTURE.REFUNDED" || t === "PAYMENT.CAPTURE.REVERSED") handled = await handleRefund(resource, t.endsWith("REVERSED"));
    else if (t.startsWith("PAYMENT.CAPTURE.")) handled = await handleCapture(resource);
    else if (t.startsWith("PAYMENT.PAYOUTSBATCH.")) handled = await handlePayoutBatch(resource);
    else handled = { status: "IGNORED", note: `Unhandled event type ${t}` };
    const { sellerId, ...outcome } = handled;
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: outcome.status, error: outcome.note ?? null, processed_at: new Date() },
    });
    // Proactive agents: look again at this seller soon. Never fail the webhook over it.
    if (outcome.status === "PROCESSED" && sellerId && proactiveEnabled()) {
      await enqueueWatch(sellerId).catch((e: unknown) => console.error("[proactive] could not queue a check", e));
    }
    return outcome;
  } catch (err) {
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: "FAILED", error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}
