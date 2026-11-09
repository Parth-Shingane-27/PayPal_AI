import { DelayedError, type Job, Queue, Worker } from "bullmq";
import { prisma } from "@/server/db";
import { proactiveEnabled } from "@/server/config";
import { enqueueEmbedding, type EmbeddingJob, type PayoutJob, QUEUE_NAMES, queuePrefix, redisConnection, scheduleDailyWatch, schedulePayoutJob, type WatchJob, type WebhookJob } from "@/server/queue";
import { runWatch, sellerIds } from "@/server/proactive/watcher";
import { payoutsNeedingJobs, runPayout } from "@/server/services/payouts";
import { embedListing, listingsMissingEmbeddings } from "@/server/services/search";
import { processWebhookEvent } from "@/server/services/webhooks";

const PAYOUT_POLL_MS = 60_000;
const RECONCILE_MS = 60_000;

export async function webhookProcessor(job: Job<WebhookJob>) {
  return processWebhookEvent(job.data.eventId);
}

export async function watchProcessor(job: Job<WatchJob>) {
  return runWatch(job.data.sellerId);
}

async function embeddingProcessor(job: Job<EmbeddingJob>) {
  return embedListing(job.data.listingId);
}

/**
 * Sends the payout, then polls PayPal by moving this same job back to the
 * delayed set (job id stays = payout id) until the batch finishes.
 */
export async function payoutProcessor(job: Job<PayoutJob>, token?: string) {
  const outcome = await runPayout(job.data.payoutId);
  if (outcome === "POLL") {
    await job.moveToDelayed(Date.now() + PAYOUT_POLL_MS, token);
    throw new DelayedError();
  }
  return outcome;
}

/**
 * Makes sure every SCHEDULED or PROCESSING payout has a live job: covers a
 * failed enqueue at approval time and a job that exhausted its retries.
 */
export async function reconcilePayouts(payouts: Queue): Promise<number> {
  let fixed = 0;
  for (const p of await payoutsNeedingJobs()) {
    const job = await payouts.getJob(p.id);
    if (!job) {
      await schedulePayoutJob(p.id, p.status === "SCHEDULED" ? p.scheduled_for : new Date());
      fixed++;
    } else if (await job.isFailed()) {
      await job.retry();
      fixed++;
    }
  }
  return fixed;
}

export function startWorkers() {
  const opts = { connection: redisConnection(), prefix: queuePrefix() };
  const workers = [
    new Worker<WebhookJob>(QUEUE_NAMES.webhooks, webhookProcessor, { ...opts, concurrency: 5 }),
    new Worker<EmbeddingJob>(QUEUE_NAMES.embeddings, embeddingProcessor, { ...opts, concurrency: 2 }),
    new Worker<PayoutJob>(QUEUE_NAMES.payouts, payoutProcessor, { ...opts, concurrency: 2 }),
    new Worker<WatchJob>(QUEUE_NAMES.watch, watchProcessor, { ...opts, concurrency: 1 }),
  ];
  for (const w of workers) {
    w.on("failed", (job, err) => console.error(`[${w.name}] job ${job?.id} failed: ${err.message}`));
  }
  const payoutQueue = new Queue(QUEUE_NAMES.payouts, opts);
  const reconcile = () =>
    reconcilePayouts(payoutQueue)
      .then((n) => n > 0 && console.log(`reconciled ${n} payout job(s)`))
      .catch((err: unknown) => console.error("payout reconcile failed", err));
  void reconcile();
  const timer = setInterval(reconcile, RECONCILE_MS);
  // Listings published while embeddings could not run get queued again on boot.
  if (!process.env.VOYAGE_API_KEY?.trim()) {
    console.warn("VOYAGE_API_KEY is not set: skipping embedding backfill. Add it to .env and restart the worker.");
  } else {
    void listingsMissingEmbeddings()
      .then(async (ids) => {
        for (const id of ids) await enqueueEmbedding(id);
        if (ids.length) console.log(`queued ${ids.length} listing embedding(s)`);
      })
      .catch((err: unknown) => console.error("embedding backfill failed", err));
  }

  // Proactive agents: make sure every seller has a daily check.
  if (proactiveEnabled()) {
    void sellerIds()
      .then((ids) => Promise.all(ids.map(scheduleDailyWatch)))
      .catch((err: unknown) => console.error("proactive scheduling failed", err));
  }

  return async function stop() {
    clearInterval(timer);
    await Promise.all(workers.map((w) => w.close()));
    await payoutQueue.close();
    await prisma.$disconnect();
  };
}
