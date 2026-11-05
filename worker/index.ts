import "dotenv/config";
import { workerConfig } from "@/server/config";
import { closeQueues } from "@/server/queue";
import { startWorkers } from "./jobs";
import { buildServer } from "./server";

/** GlobalCart worker: PayPal webhooks (Fastify) + BullMQ jobs (webhooks, embeddings, payouts). */
async function main() {
  const { WORKER_PORT } = workerConfig();
  const stopWorkers = startWorkers();
  const app = buildServer();
  await app.listen({ port: WORKER_PORT, host: "0.0.0.0" });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    app.log.info(`${signal} received, shutting down`);
    try {
      await app.close(); // stop taking webhooks first
      await stopWorkers(); // let active jobs finish
      await closeQueues();
      process.exit(0);
    } catch (err) {
      console.error("shutdown failed", err);
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
