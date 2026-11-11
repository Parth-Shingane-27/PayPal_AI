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
  watch: "watch",
} as const;

export type WebhookJob = { eventId: string };
/** A service page or a freelancer's skills profile to (re-)embed. */
export type EmbeddingJob = { kind: "service_page" | "freelancer"; id: string };
/** A freelancer_payouts row to send. */
export type PayoutJob = { payoutId: string };
export type WatchJob = { freelancerId: string };

/** BullMQ needs maxRetriesPerRequest: null on every connection it uses. */
export function redisConnection() {
  return { url: coreConfig().REDIS_URL, maxRetriesPerRequest: null };
}

/** Separate key prefix for tests so they never see dev jobs. */
export function queuePrefix(): string {
  return process.env.NODE_ENV === "test" ? "gg-test" : "gg";
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

/** (Re-)embeds a service page or a freelancer's skills profile; keyed by time so a re-publish re-embeds. */
export async function enqueueGigEmbedding(target: { kind: "service_page" | "freelancer"; id: string }): Promise<void> {
  await queue(QUEUE_NAMES.embeddings).add("embed", target satisfies EmbeddingJob, { jobId: `${target.kind}-${target.id}-${Date.now()}` });
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

/** One proactive check per freelancer per 10-minute window: a burst of events becomes one run. */
export const WATCH_WINDOW_MS = 10 * 60_000;

export async function enqueueWatch(freelancerId: string, opts: { manual?: boolean; now?: number } = {}): Promise<void> {
  const now = opts.now ?? Date.now();
  await queue(QUEUE_NAMES.watch).add("watch", { freelancerId } satisfies WatchJob, {
    // A manual "Check now" is never swallowed by the window; it is still one job per click.
    jobId: opts.manual ? `watch-${freelancerId}-manual-${now}` : `watch-${freelancerId}-${Math.floor(now / WATCH_WINDOW_MS)}`,
    attempts: 2,
    backoff: { type: "fixed", delay: 30_000 },
  });
}

/** Daily check for one freelancer. upsertJobScheduler is idempotent, so calling it on every boot is safe. */
export async function scheduleDailyWatch(freelancerId: string): Promise<void> {
  await queue(QUEUE_NAMES.watch).upsertJobScheduler(`daily-watch-${freelancerId}`, { every: 24 * 60 * 60_000 }, { name: "watch", data: { freelancerId } satisfies WatchJob });
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
}
