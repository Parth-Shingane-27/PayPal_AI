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
import { refundSplit } from "../domain/balances";
import { isReleased } from "../domain/milestones";
import { applyMilestoneCapture } from "./gig/milestone-payments";
import { afterRefundCompleted } from "./gig/milestones";
import { applyFreelancerBatchResult } from "./gig/payouts";

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

type Outcome = { status: "PROCESSED" | "IGNORED"; note?: string; freelancerId?: string };

async function handleCapture(resource: unknown): Promise<Outcome> {
  const cap = captureFromResource(resource);
  const payment = await prisma.milestonePayment.findFirst({
    where: { OR: [{ capture_id: cap.captureId }, ...(cap.paypalOrderId ? [{ paypal_order_id: cap.paypalOrderId }] : [])] },
  });
  if (!payment) return { status: "IGNORED", note: `No payment for capture ${cap.captureId}` };
  await applyMilestoneCapture(payment.id, { ...cap, paypalOrderId: payment.paypal_order_id });
  return { status: "PROCESSED", freelancerId: payment.freelancer_id };
}

/** Milestone refunds: settle a pending one, or record one made outside GlobalGig. */
async function handleMilestoneRefund(r: ReturnType<typeof refundFromResource>, reversed: boolean): Promise<Outcome> {
  const known = await prisma.milestoneRefund.findUnique({ where: { paypal_refund_id: r.refundId } });
  if (known) {
    if (known.status === "PENDING" && r.status === "COMPLETED") {
      await prisma.$transaction(async (tx) => {
        await tx.milestoneRefund.update({ where: { id: known.id }, data: { status: "COMPLETED", completed_at: new Date() } });
        await afterRefundCompleted(tx, known.id);
      });
    } else if (known.status === "PENDING" && (r.status === "FAILED" || r.status === "CANCELLED")) {
      await prisma.milestoneRefund.update({ where: { id: known.id }, data: { status: "FAILED", error: `PayPal refund ${r.status}` } });
    }
    return { status: "PROCESSED", freelancerId: known.freelancer_id };
  }
  if (!r.captureId) return { status: "IGNORED", note: `Refund ${r.refundId} has no capture link` };
  const payment = await prisma.milestonePayment.findUnique({ where: { capture_id: r.captureId }, include: { milestone: true } });
  if (!payment) return { status: "IGNORED", note: `No payment for capture ${r.captureId}` };
  if (r.status !== "COMPLETED" && r.status !== "PENDING") return { status: "IGNORED", note: `Refund status ${r.status}` };
  const fromHolding = !isReleased(payment.milestone.state) && payment.released_at === null;
  const split = refundSplit({
    amountMinor: r.amountMinor,
    grossMinor: payment.gross_minor,
    platformFeeMinor: payment.platform_fee_minor ?? 0,
    paypalFeeReturnedMinor: r.paypalFeeReturnedMinor,
    fromHolding,
  });
  const status = r.status;
  await prisma.$transaction(async (tx) => {
    const created = await tx.milestoneRefund.create({
      data: {
        payment_id: payment.id,
        milestone_id: payment.milestone_id,
        contract_id: payment.contract_id,
        freelancer_id: payment.freelancer_id,
        currency: r.currency,
        amount_minor: r.amountMinor,
        reason: reversed ? "Payment reversed by PayPal (chargeback or dispute)." : "Refunded directly in PayPal, outside GlobalGig.",
        from_holding: fromHolding,
        status,
        paypal_refund_id: r.refundId,
        paypal_fee_returned_minor: r.paypalFeeReturnedMinor,
        platform_fee_returned_minor: split.platformFeeReturnedMinor,
        freelancer_debit_minor: split.freelancerDebitMinor,
        completed_at: status === "COMPLETED" ? new Date() : null,
      },
    });
    if (status === "COMPLETED") await afterRefundCompleted(tx, created.id);
  });
  return { status: "PROCESSED", freelancerId: payment.freelancer_id };
}

async function handleRefund(resource: unknown, reversed: boolean): Promise<Outcome> {
  return handleMilestoneRefund(refundFromResource(resource), reversed);
}

async function handlePayoutBatch(resource: unknown): Promise<Outcome> {
  const batchId = payoutBatchId(resource);
  const fp = await prisma.freelancerPayout.findUnique({ where: { paypal_batch_id: batchId } });
  if (!fp) return { status: "IGNORED", note: `No payout for batch ${batchId}` };
  await applyFreelancerBatchResult(fp.id, payoutBatchFromResource(resource, fp.currency));
  return { status: "PROCESSED", freelancerId: fp.freelancer_id };
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
    const { freelancerId, ...outcome } = handled;
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: outcome.status, error: outcome.note ?? null, processed_at: new Date() },
    });
    // Proactive agents: look again at this freelancer soon. Never fail the webhook over it.
    if (outcome.status === "PROCESSED" && freelancerId && proactiveEnabled()) {
      await enqueueWatch(freelancerId).catch((e: unknown) => console.error("[proactive] could not queue a check", e));
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
