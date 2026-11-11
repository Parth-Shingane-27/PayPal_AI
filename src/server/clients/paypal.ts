import type { ActorType, AgentName } from "@/generated/prisma/enums";
import { z } from "zod";
import { type PaypalConfig, paypalConfig } from "../config";
import { parseDecimal, isSupportedCurrency, toDecimalString } from "../domain/money";
import { AppError } from "../errors";

/**
 * PayPal REST client (Orders v2, Payments v2, Payouts v1, Webhooks v1),
 * checked against github.com/paypal/paypal-rest-api-specifications.
 *
 * - OAuth token cached until a minute before expiry; a 401 refreshes once.
 * - Every write sends PayPal-Request-Id and Prefer: return=representation.
 * - Only GETs and writes that carry a request id are retried.
 * - Every call is reported to `record` so it lands in agent_actions.
 */

export type FetchFn = typeof fetch;

/** Who caused a PayPal call; written to the audit row. */
export type CallContext = {
  actor: ActorType;
  actorId?: string | null;
  freelancerId?: string | null;
  sessionId?: string | null;
  agent?: AgentName | null;
};

export type PayPalCallRecord = {
  operation: string;
  method: string;
  path: string;
  requestId?: string;
  request?: unknown;
  httpStatus?: number;
  response?: unknown;
  error?: string;
  durationMs: number;
};

type Recorder = (ctx: CallContext, record: PayPalCallRecord) => Promise<void>;

export class PayPalApiError extends Error {
  readonly status: number;
  readonly paypalName?: string;
  /** Every `details[].issue` PayPal returned. */
  readonly issues: string[];
  readonly debugId?: string;

  constructor(status: number, body: unknown) {
    const parsed = paypalErrorSchema.safeParse(body);
    const data = parsed.success ? parsed.data : undefined;
    const issues = (data?.details ?? []).flatMap((d) => (d.issue ? [d.issue] : []));
    const issue = issues[0];
    super(`PayPal ${status}${data?.name ? ` ${data.name}` : ""}${issue ? ` (${issue})` : ""}: ${data?.message ?? "request failed"}`);
    this.name = "PayPalApiError";
    this.status = status;
    this.paypalName = data?.name;
    this.issues = issues;
    this.debugId = data?.debug_id;
  }

  hasIssue(issue: string): boolean {
    return this.issues.includes(issue);
  }
}

const paypalErrorSchema = z.object({
  name: z.string().optional(),
  message: z.string().optional(),
  debug_id: z.string().optional(),
  details: z.array(z.object({ issue: z.string().optional(), description: z.string().optional() })).optional(),
});

const moneySchema = z.object({ currency_code: z.string(), value: z.string() });
const linkSchema = z.object({ href: z.string(), rel: z.string(), method: z.string().optional() });

const captureSchema = z.object({
  id: z.string(),
  status: z.enum(["COMPLETED", "DECLINED", "PARTIALLY_REFUNDED", "PENDING", "REFUNDED", "FAILED"]),
  status_details: z.object({ reason: z.string().optional() }).optional(),
  amount: moneySchema,
  seller_receivable_breakdown: z
    .object({
      gross_amount: moneySchema,
      paypal_fee: moneySchema.optional(),
      net_amount: moneySchema.optional(),
      receivable_amount: moneySchema.optional(),
      exchange_rate: z.object({ value: z.string().optional() }).optional(),
    })
    .optional(),
});

const authorizationSchema = z.object({
  id: z.string(),
  status: z.enum(["CREATED", "CAPTURED", "DENIED", "PARTIALLY_CAPTURED", "VOIDED", "PENDING"]),
  amount: moneySchema,
  expiration_time: z.string().optional(),
});

const orderSchema = z.object({
  id: z.string(),
  status: z.enum(["CREATED", "SAVED", "APPROVED", "VOIDED", "COMPLETED", "PAYER_ACTION_REQUIRED"]),
  links: z.array(linkSchema).optional(),
  purchase_units: z
    .array(
      z.object({
        reference_id: z.string().optional(),
        shipping: z.unknown().optional(),
        payments: z.object({ captures: z.array(captureSchema).optional(), authorizations: z.array(authorizationSchema).optional() }).optional(),
      }),
    )
    .optional(),
});

const refundSchema = z.object({
  id: z.string(),
  status: z.enum(["CANCELLED", "FAILED", "PENDING", "COMPLETED"]),
  amount: moneySchema.optional(),
  seller_payable_breakdown: z
    .object({ paypal_fee: moneySchema.optional(), net_amount: moneySchema.optional() })
    .optional(),
});

const payoutCurrencySchema = z.object({ currency: z.string(), value: z.string() });
const batchStatusSchema = z.enum(["DENIED", "PENDING", "PROCESSING", "SUCCESS", "CANCELED"]);
const payoutBatchSchema = z.object({
  batch_header: z.object({
    payout_batch_id: z.string(),
    batch_status: batchStatusSchema,
    fees: payoutCurrencySchema.optional(),
  }),
  items: z
    .array(
      z.object({
        payout_item_id: z.string(),
        transaction_status: z
          .enum(["SUCCESS", "FAILED", "PENDING", "UNCLAIMED", "RETURNED", "ONHOLD", "BLOCKED", "REFUNDED", "REVERSED"])
          .optional(),
        errors: z.object({ name: z.string().optional(), message: z.string().optional() }).optional(),
      }),
    )
    .optional(),
});

const tokenSchema = z.object({ access_token: z.string(), expires_in: z.number() });

export type PayPalOrderStatus = z.infer<typeof orderSchema>["status"];
type PayoutBatchStatus = z.infer<typeof batchStatusSchema>;

type CreateOrderInput = {
  orderId: string;
  /** `${orderId}-${uuid}`, unique per attempt: invoice_id and PayPal-Request-Id. */
  invoiceId: string;
  currency: string;
  items: { name: string; sku: string; quantity: number; unitMinor: number }[];
  totalMinor: number;
  locale: string;
  returnUrl: string;
  cancelUrl: string;
  /** AUTHORIZE places a hold that is captured later; CAPTURE (default) charges at once. */
  intent?: "CAPTURE" | "AUTHORIZE";
  /** "service": freelance work (no item category, no shipping address). Default "goods". */
  kind?: "goods" | "service";
};

export type CaptureResult = {
  paypalOrderId: string;
  captureId: string;
  status: z.infer<typeof captureSchema>["status"];
  statusReason?: string;
  currency: string;
  grossMinor: number;
  /** null when PayPal sent no fee, or a fee in a different currency. */
  paypalFeeMinor: number | null;
  /** Present when PayPal converted the capture into another holding currency. */
  conversion?: { netMinor: number; receivableCurrency: string; receivableMinor: number; rate: number };
  shipping?: unknown;
  /** True when PayPal said ORDER_ALREADY_CAPTURED and we read the existing capture. */
  alreadyCaptured: boolean;
};

export type AuthorizationResult = {
  paypalOrderId: string;
  authorizationId: string;
  status: z.infer<typeof authorizationSchema>["status"];
  currency: string;
  amountMinor: number;
  /** When PayPal stops honouring the hold, if it said. */
  expiresAt: Date | null;
};

export type RefundResult = {
  refundId: string;
  status: z.infer<typeof refundSchema>["status"];
  /** PayPal fee returned to us; 0 when none or in a different currency. */
  paypalFeeReturnedMinor: number;
};

export type PayoutBatchResult = {
  batchId: string;
  status: PayoutBatchStatus;
  /** Actual fee, when reported in the payout currency. */
  feeMinor: number | null;
  itemStatus?: string;
  itemError?: string;
};

type Deps = {
  config?: () => PaypalConfig;
  fetch?: FetchFn;
  record?: Recorder;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

/** PayPal's checkout UI has no Hindi; India's checkout is English. */
function paypalLocale(locale: string): string {
  return locale === "hi-IN" ? "en-IN" : locale;
}

function amount(minor: number, currency: string) {
  return { currency_code: currency, value: toDecimalString(minor, currency) };
}

/** Parses PayPal money only when it is in `expected` currency. */
function minorIfCurrency(m: { currency_code: string; value: string } | undefined, expected: string): number | null {
  if (!m || m.currency_code !== expected) return null;
  return parseDecimal(m.value, expected);
}

export class PayPalClient {
  private readonly getConfig: () => PaypalConfig;
  private readonly fetchFn: FetchFn;
  private readonly record: Recorder;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private token?: { value: string; expiresAt: number };

  constructor(deps: Deps = {}) {
    this.getConfig = deps.config ?? paypalConfig;
    this.fetchFn = deps.fetch ?? fetch;
    this.record = deps.record ?? (async () => {});
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = deps.now ?? Date.now;
  }

  // --- auth -----------------------------------------------------------------

  private async accessToken(): Promise<string> {
    if (this.token && this.now() < this.token.expiresAt - 60_000) return this.token.value;
    const cfg = this.getConfig();
    const basic = Buffer.from(`${cfg.PAYPAL_CLIENT_ID}:${cfg.PAYPAL_CLIENT_SECRET}`).toString("base64");
    const res = await this.fetchFn(`${cfg.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    const body: unknown = await res.json().catch(() => undefined);
    if (!res.ok) throw new PayPalApiError(res.status, body);
    const token = tokenSchema.parse(body);
    this.token = { value: token.access_token, expiresAt: this.now() + token.expires_in * 1000 };
    return this.token.value;
  }

  // --- transport ------------------------------------------------------------

  private async request(
    ctx: CallContext,
    operation: string,
    method: "GET" | "POST",
    path: string,
    opts: { body?: unknown; requestId?: string } = {},
  ): Promise<{ status: number; body: unknown }> {
    const started = this.now();
    const canRetry = method === "GET" || opts.requestId !== undefined;
    let refreshed = false;
    let lastError: unknown;
    let httpStatus: number | undefined;
    let responseBody: unknown;

    try {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        let res: Response;
        try {
          const headers: Record<string, string> = {
            Authorization: `Bearer ${await this.accessToken()}`,
            "Content-Type": "application/json",
          };
          if (method !== "GET") {
            headers.Prefer = "return=representation";
            if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
          }
          res = await this.fetchFn(`${this.getConfig().baseUrl}${path}`, {
            method,
            headers,
            body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          });
        } catch (err) {
          if (err instanceof PayPalApiError) throw err; // token endpoint rejected us
          lastError = err; // network failure
          if (!canRetry || attempt === MAX_ATTEMPTS) throw err;
          await this.sleep(250 * 2 ** (attempt - 1));
          continue;
        }

        httpStatus = res.status;
        const text = await res.text();
        responseBody = text ? safeJson(text) : undefined;

        if (res.status === 401 && !refreshed) {
          refreshed = true;
          this.token = undefined;
          attempt -= 1; // the refresh retry does not count as an attempt
          continue;
        }
        if (res.ok) return { status: res.status, body: responseBody };

        lastError = new PayPalApiError(res.status, responseBody);
        if (!canRetry || !RETRYABLE_STATUS.has(res.status) || attempt === MAX_ATTEMPTS) throw lastError;
        await this.sleep(250 * 2 ** (attempt - 1));
      }
      throw lastError;
    } catch (err) {
      await this.record(ctx, {
        operation,
        method,
        path,
        requestId: opts.requestId,
        request: opts.body,
        httpStatus,
        response: responseBody,
        error: err instanceof Error ? err.message : String(err),
        durationMs: this.now() - started,
      });
      throw err;
    }
  }

  /** request() plus the success audit record (request() records failures). */
  private async call(
    ctx: CallContext,
    operation: string,
    method: "GET" | "POST",
    path: string,
    opts: { body?: unknown; requestId?: string } = {},
  ): Promise<unknown> {
    const started = this.now();
    const response = await this.request(ctx, operation, method, path, opts);
    await this.record(ctx, {
      operation,
      method,
      path,
      requestId: opts.requestId,
      request: opts.body,
      httpStatus: response.status,
      response: response.body,
      durationMs: this.now() - started,
    });
    return response.body;
  }

  // --- Orders v2 --------------------------------------------------------------

  async createOrder(ctx: CallContext, input: CreateOrderInput): Promise<{ id: string; status: PayPalOrderStatus; approveUrl: string }> {
    const cfg = this.getConfig();
    const itemTotal = input.items.reduce((sum, i) => sum + i.unitMinor * i.quantity, 0);
    if (itemTotal !== input.totalMinor) {
      throw new Error(`Item total ${itemTotal} does not match order total ${input.totalMinor}`);
    }
    const body = {
      intent: input.intent ?? "CAPTURE",
      purchase_units: [
        {
          reference_id: input.orderId,
          custom_id: input.orderId,
          invoice_id: input.invoiceId,
          amount: {
            ...amount(input.totalMinor, input.currency),
            breakdown: { item_total: amount(itemTotal, input.currency) },
          },
          items: input.items.map((i) => ({
            name: i.name.slice(0, 127),
            sku: i.sku.slice(0, 127),
            quantity: String(i.quantity),
            unit_amount: amount(i.unitMinor, input.currency),
            ...(input.kind === "service" ? {} : { category: "PHYSICAL_GOODS" }),
          })),
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: cfg.PAYPAL_BRAND_NAME,
            locale: paypalLocale(input.locale),
            user_action: "PAY_NOW",
            shipping_preference: input.kind === "service" ? "NO_SHIPPING" : "GET_FROM_FILE",
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
          },
        },
      },
    };
    const res = orderSchema.parse(
      await this.call(ctx, "orders.create", "POST", "/v2/checkout/orders", { body, requestId: input.invoiceId }),
    );
    const approveUrl = res.links?.find((l) => l.rel === "payer-action")?.href;
    if (!approveUrl) throw new Error(`PayPal order ${res.id} has no payer-action link`);
    return { id: res.id, status: res.status, approveUrl };
  }

  async getOrder(ctx: CallContext, paypalOrderId: string) {
    return orderSchema.parse(
      await this.call(ctx, "orders.get", "GET", `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`),
    );
  }

  /**
   * Captures an approved order. ORDER_ALREADY_CAPTURED reads the existing
   * capture instead; INSTRUMENT_DECLINED becomes PAYMENT_DECLINED so the UI
   * restarts the PayPal flow.
   */
  async captureOrder(ctx: CallContext, paypalOrderId: string, requestId: string): Promise<CaptureResult> {
    const path = `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`;
    let order: z.infer<typeof orderSchema>;
    let alreadyCaptured = false;
    try {
      order = orderSchema.parse(await this.call(ctx, "orders.capture", "POST", path, { body: {}, requestId }));
    } catch (err) {
      if (err instanceof PayPalApiError && err.hasIssue("ORDER_ALREADY_CAPTURED")) {
        order = await this.getOrder(ctx, paypalOrderId);
        alreadyCaptured = true;
      } else if (err instanceof PayPalApiError && err.hasIssue("INSTRUMENT_DECLINED")) {
        throw new AppError(
          "PAYMENT_DECLINED",
          "PayPal declined the payment method. Please choose another funding source in PayPal and try again.",
          { restart: true, issue: "INSTRUMENT_DECLINED" },
        );
      } else {
        throw err;
      }
    }
    const unit = order.purchase_units?.[0];
    const capture = unit?.payments?.captures?.[0];
    if (!capture) throw new Error(`PayPal order ${paypalOrderId} has no capture`);
    return parseCapture(order.id, capture, unit?.shipping, alreadyCaptured);
  }

  /**
   * Places the hold on an approved AUTHORIZE order. Nothing is charged: the
   * money is reserved on the payer's funding source until it is captured or
   * the authorization is voided or expires.
   */
  async authorizeOrder(ctx: CallContext, paypalOrderId: string, requestId: string): Promise<AuthorizationResult> {
    const path = `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/authorize`;
    let order: z.infer<typeof orderSchema>;
    try {
      order = orderSchema.parse(await this.call(ctx, "orders.authorize", "POST", path, { body: {}, requestId }));
    } catch (err) {
      if (err instanceof PayPalApiError && err.hasIssue("ORDER_ALREADY_AUTHORIZED")) {
        order = await this.getOrder(ctx, paypalOrderId);
      } else if (err instanceof PayPalApiError && err.hasIssue("INSTRUMENT_DECLINED")) {
        throw new AppError("PAYMENT_DECLINED", "PayPal declined the payment method. Please choose another funding source in PayPal and try again.", {
          restart: true,
          issue: "INSTRUMENT_DECLINED",
        });
      } else {
        throw err;
      }
    }
    const auth = order.purchase_units?.[0]?.payments?.authorizations?.[0];
    if (!auth) throw new Error(`PayPal order ${paypalOrderId} has no authorization`);
    const currency = auth.amount.currency_code;
    return {
      paypalOrderId: order.id,
      authorizationId: auth.id,
      status: auth.status,
      currency,
      amountMinor: parseDecimal(auth.amount.value, currency),
      expiresAt: auth.expiration_time ? new Date(auth.expiration_time) : null,
    };
  }

  /** Captures the held money (final capture). Fees are known from this response. */
  async captureAuthorization(
    ctx: CallContext,
    input: { authorizationId: string; paypalOrderId: string; amountMinor: number; currency: string; requestId: string; invoiceId?: string },
  ): Promise<CaptureResult> {
    const path = `/v2/payments/authorizations/${encodeURIComponent(input.authorizationId)}/capture`;
    const res = captureSchema.parse(
      await this.call(ctx, "authorizations.capture", "POST", path, {
        requestId: input.requestId,
        body: {
          amount: { value: toDecimalString(input.amountMinor, input.currency), currency_code: input.currency },
          final_capture: true,
          ...(input.invoiceId ? { invoice_id: input.invoiceId } : {}),
        },
      }),
    );
    return parseCapture(input.paypalOrderId, res, undefined, false);
  }

  /** Releases a hold without charging anything. */
  async voidAuthorization(ctx: CallContext, authorizationId: string, requestId: string): Promise<void> {
    try {
      await this.call(ctx, "authorizations.void", "POST", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`, { body: {}, requestId });
    } catch (err) {
      if (err instanceof PayPalApiError && (err.hasIssue("AUTHORIZATION_ALREADY_VOIDED") || err.hasIssue("PREVIOUSLY_VOIDED"))) return;
      throw err;
    }
  }

  // --- Payments v2 ----------------------------------------------------------

  async refundCapture(
    ctx: CallContext,
    input: { captureId: string; amountMinor: number; currency: string; requestId: string; note: string },
  ): Promise<RefundResult> {
    const res = refundSchema.parse(
      await this.call(ctx, "captures.refund", "POST", `/v2/payments/captures/${encodeURIComponent(input.captureId)}/refund`, {
        requestId: input.requestId,
        body: {
          amount: { value: toDecimalString(input.amountMinor, input.currency), currency_code: input.currency },
          note_to_payer: input.note.slice(0, 255),
        },
      }),
    );
    return {
      refundId: res.id,
      status: res.status,
      paypalFeeReturnedMinor: minorIfCurrency(res.seller_payable_breakdown?.paypal_fee, input.currency) ?? 0,
    };
  }

  // --- Payouts v1 -----------------------------------------------------------

  async createPayout(
    ctx: CallContext,
    input: { senderBatchId: string; receiver: string; amountMinor: number; currency: string; note: string; senderItemId: string },
  ): Promise<PayoutBatchResult> {
    const body = {
      sender_batch_header: {
        sender_batch_id: input.senderBatchId,
        email_subject: "You have a payout from GlobalGig",
      },
      items: [
        {
          recipient_type: "EMAIL",
          receiver: input.receiver,
          amount: { currency: input.currency, value: toDecimalString(input.amountMinor, input.currency) },
          note: input.note,
          sender_item_id: input.senderItemId,
        },
      ],
    };
    const res = payoutBatchSchema.parse(
      await this.call(ctx, "payouts.create", "POST", "/v1/payments/payouts", { body, requestId: input.senderBatchId }),
    );
    return parseBatch(res, input.currency);
  }

  async getPayoutBatch(ctx: CallContext, batchId: string, currency: string): Promise<PayoutBatchResult> {
    const res = payoutBatchSchema.parse(
      await this.call(ctx, "payouts.get", "GET", `/v1/payments/payouts/${encodeURIComponent(batchId)}`),
    );
    return parseBatch(res, currency);
  }

  // --- Webhooks v1 ----------------------------------------------------------

  async verifyWebhookSignature(
    ctx: CallContext,
    input: {
      webhookId: string;
      authAlgo: string;
      certUrl: string;
      transmissionId: string;
      transmissionSig: string;
      transmissionTime: string;
      event: unknown;
    },
  ): Promise<boolean> {
    const res = z.object({ verification_status: z.enum(["SUCCESS", "FAILURE"]) }).parse(
      await this.call(ctx, "webhooks.verify", "POST", "/v1/notifications/verify-webhook-signature", {
        body: {
          auth_algo: input.authAlgo,
          cert_url: input.certUrl,
          transmission_id: input.transmissionId,
          transmission_sig: input.transmissionSig,
          transmission_time: input.transmissionTime,
          webhook_id: input.webhookId,
          webhook_event: input.event,
        },
      }),
    );
    return res.verification_status === "SUCCESS";
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseCapture(
  paypalOrderId: string,
  capture: z.infer<typeof captureSchema>,
  shipping: unknown,
  alreadyCaptured: boolean,
): CaptureResult {
  const currency = capture.amount.currency_code;
  const grossMinor = parseDecimal(capture.amount.value, currency);
  const breakdown = capture.seller_receivable_breakdown;
  const paypalFeeMinor = minorIfCurrency(breakdown?.paypal_fee, currency);

  let conversion: CaptureResult["conversion"];
  const receivable = breakdown?.receivable_amount;
  const rate = Number(breakdown?.exchange_rate?.value);
  const netMinor = minorIfCurrency(breakdown?.net_amount, currency);
  if (
    receivable &&
    receivable.currency_code !== currency &&
    isSupportedCurrency(receivable.currency_code) &&
    netMinor !== null &&
    Number.isFinite(rate) &&
    rate > 0
  ) {
    conversion = {
      netMinor,
      receivableCurrency: receivable.currency_code,
      receivableMinor: parseDecimal(receivable.value, receivable.currency_code),
      rate,
    };
  }

  return {
    paypalOrderId,
    captureId: capture.id,
    status: capture.status,
    statusReason: capture.status_details?.reason,
    currency,
    grossMinor,
    paypalFeeMinor,
    conversion,
    shipping,
    alreadyCaptured,
  };
}

function parseBatch(res: z.infer<typeof payoutBatchSchema>, currency: string): PayoutBatchResult {
  const fees = res.batch_header.fees;
  const item = res.items?.[0];
  return {
    batchId: res.batch_header.payout_batch_id,
    status: res.batch_header.batch_status,
    feeMinor: fees && fees.currency === currency ? parseDecimal(fees.value, currency) : null,
    itemStatus: item?.transaction_status,
    itemError: item?.errors?.message ?? item?.errors?.name,
  };
}

// --- Webhook resources --------------------------------------------------------
// Webhook payloads carry the same resource objects as the REST responses.

const relatedIdsSchema = z.object({
  supplementary_data: z.object({ related_ids: z.object({ order_id: z.string().optional() }).optional() }).optional(),
});

/** A capture resource from PAYMENT.CAPTURE.* events. */
export function captureFromResource(resource: unknown): CaptureResult {
  const capture = captureSchema.parse(resource);
  const related = relatedIdsSchema.safeParse(resource);
  const orderId = related.success ? (related.data.supplementary_data?.related_ids?.order_id ?? "") : "";
  return parseCapture(orderId, capture, undefined, false);
}

const refundResourceSchema = refundSchema.extend({
  amount: moneySchema,
  links: z.array(linkSchema).optional(),
});

/** A refund resource from PAYMENT.CAPTURE.REFUNDED / REVERSED events. */
export function refundFromResource(resource: unknown) {
  const r = refundResourceSchema.parse(resource);
  const currency = r.amount.currency_code;
  const up = r.links?.find((l) => l.rel === "up")?.href;
  const captureId = up?.match(/\/captures\/([^/?]+)/)?.[1];
  return {
    refundId: r.id,
    status: r.status,
    currency,
    amountMinor: parseDecimal(r.amount.value, currency),
    paypalFeeReturnedMinor: minorIfCurrency(r.seller_payable_breakdown?.paypal_fee, currency) ?? 0,
    captureId,
  };
}

/** A payout batch resource from PAYMENT.PAYOUTSBATCH.* events. */
export function payoutBatchFromResource(resource: unknown, currency: string): PayoutBatchResult {
  return parseBatch(payoutBatchSchema.parse(resource), currency);
}

/** Payout batch id from a PAYMENT.PAYOUTSBATCH.* resource, before we know the currency. */
export function payoutBatchId(resource: unknown): string {
  return z.object({ batch_header: z.object({ payout_batch_id: z.string() }) }).parse(resource).batch_header.payout_batch_id;
}

/** The operations services depend on (lets tests substitute a fake). */
export type PayPalApi = Pick<
  PayPalClient,
  "createOrder" | "getOrder" | "captureOrder" | "authorizeOrder" | "captureAuthorization" | "voidAuthorization" | "refundCapture" | "createPayout" | "getPayoutBatch" | "verifyWebhookSignature"
>;
