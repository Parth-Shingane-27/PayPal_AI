import { z } from "zod";

/**
 * Configuration is validated lazily, per integration: the core settings are
 * needed by everything, while PayPal / Groq / Voyage keys are only checked
 * when that integration is actually used. A missing key therefore fails loudly
 * at the call site that needs it, not at boot.
 */

const nonEmpty = z.string().trim().min(1);

const coreSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  APP_URL: z.url(),
  DEMO_LOGIN: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(5000).default(500),
});

const reasoningEffort = z.enum(["low", "medium", "high"]);

const groqSchema = z.object({
  GROQ_API_KEY: nonEmpty,
  // Production models with strict json_schema and strict tool support: openai/gpt-oss-20b, openai/gpt-oss-120b.
  /** Routes new seller conversations and writes listing copy (one structured-output call each). */
  GROQ_MODEL: nonEmpty.default("openai/gpt-oss-20b"),
  GROQ_REASONING_EFFORT: reasoningEffort.default("low"),
  /** Runs the four agents (multi-step tool use). */
  GROQ_AGENT_MODEL: nonEmpty.default("openai/gpt-oss-120b"),
  GROQ_AGENT_REASONING_EFFORT: reasoningEffort.default("medium"),
  /** Market price research: a model with Groq's built-in browser_search tool. */
  GROQ_SEARCH_MODEL: nonEmpty.default("openai/gpt-oss-20b"),
});

const paypalSchema = z.object({
  PAYPAL_ENV: z.enum(["sandbox", "live"]).default("sandbox"),
  PAYPAL_CLIENT_ID: nonEmpty,
  PAYPAL_CLIENT_SECRET: nonEmpty,
  PAYPAL_BRAND_NAME: nonEmpty.default("GlobalCart"),
});

const paypalWebhookSchema = z.object({ PAYPAL_WEBHOOK_ID: nonEmpty });

const voyageSchema = z.object({ VOYAGE_API_KEY: nonEmpty });

const workerSchema = z.object({ WORKER_PORT: z.coerce.number().int().positive().default(4000) });

type CoreConfig = z.infer<typeof coreSchema>;
export type PaypalConfig = z.infer<typeof paypalSchema> & { baseUrl: string };
export type ReasoningEffort = z.infer<typeof reasoningEffort>;

export class ConfigError extends Error {
  constructor(integration: string, issues: z.core.$ZodIssue[]) {
    const detail = issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    super(`Invalid ${integration} configuration — ${detail}`);
    this.name = "ConfigError";
  }
}

function parse<T extends z.ZodType>(integration: string, schema: T): z.infer<T> {
  const result = schema.safeParse(process.env);
  if (!result.success) throw new ConfigError(integration, result.error.issues);
  return result.data;
}

/** Re-read on every call so tests can change process.env; parsing is cheap. */
export function coreConfig(): CoreConfig {
  return parse("core", coreSchema);
}

export function groqConfig(): z.infer<typeof groqSchema> {
  return parse("Groq", groqSchema);
}

export function paypalConfig(): PaypalConfig {
  const cfg = parse("PayPal", paypalSchema);
  const baseUrl = cfg.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  return { ...cfg, baseUrl };
}

export function paypalWebhookId(): string {
  return parse("PayPal webhook", paypalWebhookSchema).PAYPAL_WEBHOOK_ID;
}

export function voyageConfig(): z.infer<typeof voyageSchema> {
  return parse("Voyage", voyageSchema);
}

export function workerConfig(): z.infer<typeof workerSchema> {
  return parse("worker", workerSchema);
}

/** Demo login: always available outside production, opt-in in production. */
export function demoLoginEnabled(): boolean {
  const cfg = coreConfig();
  return cfg.NODE_ENV !== "production" || cfg.DEMO_LOGIN;
}
