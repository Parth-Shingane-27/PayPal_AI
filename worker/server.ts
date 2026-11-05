import Fastify, { type FastifyInstance } from "fastify";
import { enqueueWebhook } from "@/server/queue";
import { storeWebhookEvent, verifyWebhook, type WebhookEventBody, webhookEventSchema, type WebhookHeaders } from "@/server/services/webhooks";

/**
 * PayPal webhook receiver. Reads the raw body, verifies the delivery with
 * PayPal, stores the event once (event id is the key), queues it and answers
 * 200 quickly. Processing happens in the webhooks worker.
 */

type WebhookDeps = {
  verify: (headers: WebhookHeaders, event: unknown) => Promise<boolean>;
  store: (event: WebhookEventBody) => Promise<boolean>;
  enqueue: (eventId: string) => Promise<void>;
};

const defaultDeps: WebhookDeps = { verify: verifyWebhook, store: storeWebhookEvent, enqueue: enqueueWebhook };

const HEADER = {
  authAlgo: "paypal-auth-algo",
  certUrl: "paypal-cert-url",
  transmissionId: "paypal-transmission-id",
  transmissionSig: "paypal-transmission-sig",
  transmissionTime: "paypal-transmission-time",
} as const;

export function buildServer(deps: WebhookDeps = defaultDeps): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.NODE_ENV === "test" ? "silent" : "info" }, bodyLimit: 1024 * 1024 });

  app.get("/health", async () => ({ ok: true }));

  app.register(async (scope) => {
    // Keep the body as the exact string PayPal sent.
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));

    scope.post("/webhooks/paypal", async (req, reply) => {
      const raw = typeof req.body === "string" ? req.body : "";
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return reply.code(400).send({ error: "invalid JSON" });
      }
      const event = webhookEventSchema.safeParse(parsed);
      if (!event.success) return reply.code(400).send({ error: "not a PayPal event" });

      const headers = {} as WebhookHeaders;
      for (const [key, name] of Object.entries(HEADER) as [keyof WebhookHeaders, string][]) {
        const value = req.headers[name];
        if (typeof value !== "string" || !value) return reply.code(400).send({ error: `missing ${name}` });
        headers[key] = value;
      }

      // Errors here (PayPal or DB unreachable) become a 500 so PayPal redelivers.
      if (!(await deps.verify(headers, parsed))) {
        req.log.warn({ eventId: event.data.id }, "webhook signature verification failed");
        return reply.code(400).send({ error: "signature verification failed" });
      }
      const isNew = await deps.store(event.data);
      // Queue even a redelivery: the job id is the event id, so it is queued once.
      await deps.enqueue(event.data.id);
      return reply.code(200).send({ ok: true, duplicate: !isNew });
    });
  });

  return app;
}
