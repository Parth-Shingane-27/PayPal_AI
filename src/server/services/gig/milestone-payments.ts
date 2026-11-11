import { randomUUID } from "node:crypto";
import type { MilestonePayment } from "@/generated/prisma/client";
import { clientPath } from "@/lib/routes";
import { type FxApi, frankfurter } from "../../clients/frankfurter";
import { type CaptureResult, PayPalApiError, type PayPalApi, type PayPalOrderStatus } from "../../clients/paypal";
import { coreConfig } from "../../config";
import { type Db, prisma } from "../../db";
import { platformFee } from "../../domain/balances";
import { estimateSaleFees, FEE_TABLE } from "../../domain/fees";
import { getMarket } from "../../domain/markets";
import { applyBps, convertMinor, money } from "../../domain/money";
import { AppError, notFound } from "../../errors";
import { type AuditCtx, gigCallContext, paypal as defaultPaypal } from "../audit";
import { markFunded } from "./milestones";
import { type GigOwner, lockClient } from "./owner";

/**
 * Milestone funding through PayPal. One PayPal order per milestone, captured
 * into the platform account. The client's approval click in PayPal is the
 * consent; capture runs in a normal API route afterwards (or from the
 * webhook), never in a tool. Captured money is "in holding" until release.
 */

const REUSABLE: ReadonlySet<PayPalOrderStatus> = new Set(["CREATED", "SAVED", "APPROVED", "PAYER_ACTION_REQUIRED"]);

type Deps = { paypal?: PayPalApi; fx?: FxApi };

export type FundingStarted = {
  contract_id: string;
  milestone_id: string;
  position: number;
  milestone_title: string;
  paypal_order_id: string;
  approve_url: string;
  amount: ReturnType<typeof money>;
  reused: boolean;
};

/**
 * create_milestone_payment and the "Fund milestone" button: starts (or reuses)
 * the PayPal order for the next unfunded milestone of a contract. Milestones
 * are funded in order. Holds the client lock so two clicks make one order.
 */
export async function startMilestoneFunding(o: GigOwner, contractId: string, audit: AuditCtx, deps: Deps = {}): Promise<FundingStarted> {
  if (o.type !== "CLIENT") throw new AppError("FORBIDDEN", "Only the client funds milestones.");
  const pp = deps.paypal ?? defaultPaypal;
  const cfg = coreConfig();
  return prisma.$transaction(
    async (tx) => {
      await lockClient(tx, o.clientId);
      const contract = await tx.contract.findFirst({
        where: { id: contractId, client_id: o.clientId },
        include: { milestones: { orderBy: { position: "asc" } } },
      });
      if (!contract) throw notFound("Contract");
      if (contract.status === "CANCELLED" || contract.status === "COMPLETED") throw new AppError("CONFLICT", `This contract is ${contract.status.toLowerCase()}.`);
      const next = contract.milestones.find((m) => m.state === "AWAITING_FUNDING");
      if (!next) throw new AppError("CONFLICT", "Every milestone of this contract is already funded.");
      const view = (paypalOrderId: string, approveUrl: string, reused: boolean): FundingStarted => ({
        contract_id: contract.id,
        milestone_id: next.id,
        position: next.position,
        milestone_title: next.title,
        paypal_order_id: paypalOrderId,
        approve_url: approveUrl,
        amount: money(next.amount_minor, next.currency, contract.locale),
        reused,
      });
      const callCtx = gigCallContext(audit, contract.freelancer_id);

      const pending = await tx.milestonePayment.findFirst({ where: { milestone_id: next.id, status: { in: ["CREATED", "PENDING"] } }, orderBy: { created_at: "desc" } });
      if (pending?.status === "PENDING") throw new AppError("CONFLICT", "PayPal is still processing the payment for this milestone.");
      if (pending?.approve_url && pending.gross_minor === next.amount_minor) {
        let status: PayPalOrderStatus | "GONE";
        try {
          status = (await pp.getOrder(callCtx, pending.paypal_order_id)).status;
        } catch (err) {
          if (err instanceof PayPalApiError && err.status === 404) status = "GONE";
          else throw err;
        }
        if (REUSABLE.has(status as PayPalOrderStatus)) return view(pending.paypal_order_id, pending.approve_url, true);
        if (status === "COMPLETED") {
          throw new AppError("CONFLICT", "This milestone was already paid in PayPal. Refresh the project to see it.", { paypal_order_id: pending.paypal_order_id });
        }
      }
      await tx.milestonePayment.updateMany({ where: { milestone_id: next.id, status: "CREATED" }, data: { status: "VOIDED" } });

      const invoiceId = `${next.id}-${randomUUID()}`;
      const created = await pp.createOrder(callCtx, {
        orderId: next.id,
        invoiceId,
        currency: next.currency,
        items: [{ name: `${contract.title}: milestone ${next.position}, ${next.title}`, sku: `M${next.position}-${contract.id.slice(0, 8)}`, quantity: 1, unitMinor: next.amount_minor }],
        totalMinor: next.amount_minor,
        locale: contract.locale,
        returnUrl: `${cfg.APP_URL}${clientPath(o.clientId, "checkout/return")}?milestone=${next.id}`,
        cancelUrl: `${cfg.APP_URL}${clientPath(o.clientId, `projects/${contract.id}`)}?cancelled=${next.id}`,
        kind: "service",
      });
      await tx.milestonePayment.create({
        data: {
          milestone_id: next.id,
          contract_id: contract.id,
          freelancer_id: contract.freelancer_id,
          client_id: o.clientId,
          paypal_order_id: created.id,
          paypal_invoice_id: invoiceId,
          status: "CREATED",
          currency: next.currency,
          gross_minor: next.amount_minor,
          approve_url: created.approveUrl,
        },
      });
      return view(created.id, created.approveUrl, false);
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

type Settlement = { paypal_fee_minor: number; fee_is_estimate: boolean; platform_fee_minor: number; fx_cost_minor: number };

/**
 * Fees measured at capture. PayPal's actual fee when it is in the capture
 * currency, otherwise the estimate table (flagged). FX cost is PayPal's
 * conversion against the ECB mid rate, when PayPal converted. net_to_freelancer
 * is not set here: it is recorded at release.
 */
export async function settleMilestone(
  payment: Pick<MilestonePayment, "currency" | "contract_id">,
  cap: Pick<CaptureResult, "grossMinor" | "paypalFeeMinor" | "conversion">,
  fx: FxApi,
  db: Db = prisma,
): Promise<Settlement> {
  const contract = await db.contract.findUniqueOrThrow({ where: { id: payment.contract_id }, include: { freelancer: true } });
  const bps = coreConfig().PLATFORM_FEE_BPS;
  let feeIsEstimate = false;
  let paypalFee = cap.paypalFeeMinor;
  if (paypalFee === null) {
    const est = estimateSaleFees(cap.grossMinor, {
      currency: payment.currency,
      marketCountry: getMarket(contract.locale).country,
      freelancerCountry: contract.freelancer.country,
      freelancerCurrency: contract.freelancer.currency,
      platformBps: bps,
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
  return { paypal_fee_minor: paypalFee, fee_is_estimate: feeIsEstimate, platform_fee_minor: platformFee(cap.grossMinor, bps), fx_cost_minor: fxCost };
}

export type FundingOutcome = {
  contract_id: string;
  milestone_id: string;
  milestone_state: string;
  payment_status: string;
  amount: ReturnType<typeof money>;
  already_captured: boolean;
};

/** Records a capture result. Only CREATED / PENDING payments move forward; FUND fires once. */
export async function applyMilestoneCapture(paymentId: string, cap: CaptureResult, fx: FxApi = frankfurter): Promise<FundingOutcome> {
  const payment = await prisma.milestonePayment.findUniqueOrThrow({ where: { id: paymentId } });
  if (cap.currency !== payment.currency || cap.grossMinor !== payment.gross_minor) {
    throw new Error(`Capture ${cap.captureId} is ${cap.grossMinor} ${cap.currency}, milestone payment ${payment.id} expects ${payment.gross_minor} ${payment.currency}`);
  }
  if (cap.status === "COMPLETED" || cap.status === "REFUNDED" || cap.status === "PARTIALLY_REFUNDED") {
    const s = await settleMilestone(payment, cap, fx);
    await prisma.$transaction(async (tx) => {
      const now = new Date();
      const moved = await tx.milestonePayment.updateMany({
        where: { id: payment.id, status: { in: ["CREATED", "PENDING"] } },
        data: { status: "COMPLETED", capture_id: cap.captureId, captured_at: now, failure_reason: null, ...s },
      });
      if (moved.count === 1) await markFunded(tx, payment.milestone_id, now);
    });
  } else if (cap.status === "PENDING") {
    await prisma.milestonePayment.updateMany({
      where: { id: payment.id, status: "CREATED" },
      data: { status: "PENDING", capture_id: cap.captureId, failure_reason: cap.statusReason ?? null },
    });
  } else {
    // DECLINED / FAILED: the milestone stays AWAITING_FUNDING and the client can try again.
    await prisma.milestonePayment.updateMany({
      where: { id: payment.id, status: { in: ["CREATED", "PENDING"] } },
      data: { status: cap.status === "DECLINED" ? "DECLINED" : "FAILED", capture_id: cap.captureId, failure_reason: cap.statusReason ?? cap.status },
    });
  }
  return fundingOutcome(payment.id, cap.alreadyCaptured);
}

async function fundingOutcome(paymentId: string, alreadyCaptured: boolean): Promise<FundingOutcome> {
  const p = await prisma.milestonePayment.findUniqueOrThrow({ where: { id: paymentId }, include: { milestone: true, contract: { select: { locale: true } } } });
  return {
    contract_id: p.contract_id,
    milestone_id: p.milestone_id,
    milestone_state: p.milestone.state,
    payment_status: p.status,
    amount: money(p.gross_minor, p.currency, p.contract.locale),
    already_captured: alreadyCaptured,
  };
}

/** The capture route, after the client approved in PayPal. Idempotent. */
export async function captureMilestoneFunding(o: GigOwner, paypalOrderId: string, audit: AuditCtx, deps: Deps = {}): Promise<FundingOutcome> {
  if (o.type !== "CLIENT") throw new AppError("FORBIDDEN", "Only the client funds milestones.");
  const pp = deps.paypal ?? defaultPaypal;
  const payment = await prisma.milestonePayment.findFirst({ where: { paypal_order_id: paypalOrderId, client_id: o.clientId } });
  if (!payment) throw notFound("Payment");
  if (payment.status === "COMPLETED" || (payment.status === "PENDING" && payment.capture_id)) return fundingOutcome(payment.id, true);
  if (payment.status !== "CREATED") {
    throw new AppError("CONFLICT", `This payment is ${payment.status.toLowerCase()} and cannot be captured. Start the milestone payment again.`, { restart: true });
  }
  const cap = await pp.captureOrder(gigCallContext(audit, payment.freelancer_id), paypalOrderId, `capture-${payment.id}`);
  return applyMilestoneCapture(payment.id, cap, deps.fx ?? frankfurter);
}
