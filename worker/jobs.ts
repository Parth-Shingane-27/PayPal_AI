import { DelayedError, type Job, Queue, Worker } from "bullmq";
import { prisma } from "@/server/db";
import { proactiveEnabled } from "@/server/config";
import { type PayoutJob, QUEUE_NAMES, queuePrefix, redisConnection, scheduleDailyWatch, schedulePayoutJob, type WatchJob, type WebhookJob } from "@/server/queue";
import { freelancerIds, runWatch } from "@/server/proactive/watcher";
import { sweepAutoReleases } from "@/server/services/gig/milestones";
import { freelancerPayoutsNeedingJobs, runFreelancerPayout } from "@/server/services/gig/payouts";
import { processWebhookEvent } from "@/server/services/webhooks";

const PAYOUT_POLL_MS = 60_000;
const RECONCILE_MS = 60_000;
/** How often the auto-release sweep looks for delivered milestones past their countdown. */
export const AUTO_RELEASE_SWEEP_MS = 60_000;

export async function webhookProcessor(job: Job<WebhookJob>) {
  return processWebhookEvent(job.data.eventId);
}

export async function watchProcessor(job: Job<WatchJob>) {
  return runWatch(job.data.freelancerId);
}

/**
 * Sends the payout, then polls PayPal by moving this same job back to the
 * delayed set (job id stays = payout id) until the batch finishes.
 */
export async function payoutProcessor(job: Job<PayoutJob>, token?: string) {
  const outcome = await runFreelancerPayout(job.data.payoutId);
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
  const all = await freelancerPayoutsNeedingJobs();
  for (const p of all) {
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
  // Auto-release: plain code, no agent. Each release is a guarded state change,
  // so overlapping sweeps (or two workers) release a milestone once.
  const autoRelease = () =>
    sweepAutoReleases()
      .then((r) => r.released > 0 && console.log(`auto-released ${r.released} milestone(s)`))
      .catch((err: unknown) => console.error("auto-release sweep failed", err));
  void autoRelease();
  const releaseTimer = setInterval(autoRelease, AUTO_RELEASE_SWEEP_MS);
  // Proactive agents: make sure every freelancer has a daily check.
  if (proactiveEnabled()) {
    void freelancerIds()
      .then((ids) => Promise.all(ids.map(scheduleDailyWatch)))
      .catch((err: unknown) => console.error("proactive scheduling failed", err));
  }

  return async function stop() {
    clearInterval(timer);
    clearInterval(releaseTimer);
    await Promise.all(workers.map((w) => w.close()));
    await payoutQueue.close();
    await prisma.$disconnect();
  };
}
