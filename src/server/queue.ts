import { Queue } from "bullmq";
import { coreConfig } from "./config";

/**
 * Queue producers. The worker (worker/index.ts) consumes these queues. Each
 * queue is created lazily so code paths that never enqueue never touch Redis.
 */

export const QUEUE_NAMES = {
  webhooks: "webhooks",
  embeddings: "embeddings",
  payouts: "payouts",
} as const;

export type WebhookJob = { eventId: string };
export type EmbeddingJob = { listingId: string };
export type PayoutJob = { payoutId: string };

/** BullMQ needs maxRetriesPerRequest: null on every connection it uses. */
export function redisConnection() {
  return { url: coreConfig().REDIS_URL, maxRetriesPerRequest: null };
}

/** Separate key prefix for tests so they never see dev jobs. */
export function queuePrefix(): string {
  return process.env.NODE_ENV === "test" ? "gc-test" : "gc";
}

const queues = new Map<string, Queue>();

function queue(name: string): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: redisConnection(),
      prefix: queuePrefix(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
    queues.set(name, q);
  }
  return q;
}

/** Webhook event ids are unique, so a redelivered event is queued once. */
export async function enqueueWebhook(eventId: string): Promise<void> {
  await queue(QUEUE_NAMES.webhooks).add("process", { eventId } satisfies WebhookJob, { jobId: eventId });
}

/**
 * Embedding jobs are keyed by listing and time so a re-publish re-embeds.
 * The job reads the listing's current text when it runs.
 */
export async function enqueueEmbedding(listingId: string): Promise<void> {
  await queue(QUEUE_NAMES.embeddings).add("embed", { listingId } satisfies EmbeddingJob, {
    jobId: `${listingId}-${Date.now()}`,
  });
}

/** Job id = payout id: approving twice can never queue two payouts. */
export async function schedulePayoutJob(payoutId: string, runAt: Date): Promise<void> {
  const delay = Math.max(0, runAt.getTime() - Date.now());
  await queue(QUEUE_NAMES.payouts).add("payout", { payoutId } satisfies PayoutJob, {
    jobId: payoutId,
    delay,
    // Polling is done by re-delaying the job, not by retries; retries cover
    // transient failures (PayPal 5xx, network).
    attempts: 8,
    backoff: { type: "exponential", delay: 30_000 },
  });
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
}
