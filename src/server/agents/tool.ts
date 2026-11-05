import type { ChatCompletionTool } from "groq-sdk/resources/chat/completions";
import { z } from "zod";
import type { AgentName } from "@/generated/prisma/client";
import type { Market } from "../domain/markets";
import type { Actor, AuditCtx } from "../services/audit";

/**
 * Tool definitions. Each input schema is written once in zod; the JSON schema
 * sent to the model is derived from it (additionalProperties: false, every
 * property required — optional inputs are nullable instead). The runtime still
 * validates every input with zod before running the tool.
 */

type ToolKind = "read" | "draft" | "proposal";

/** Built by the runtime from the authenticated session, never from model input. */
export type ToolCtx = {
  actor: Exclude<Actor, { type: "SYSTEM" }>;
  locale: string;
  market: Market;
  sessionId: string;
  agent: AgentName;
  /** Id of this call's agent_actions row (proposal tools write it themselves). */
  actionId: string;
  audit: AuditCtx;
};

type ToolDef<S extends z.ZodObject = z.ZodObject> = {
  name: string;
  description: string;
  input: S;
  kind: ToolKind;
  run: (ctx: ToolCtx, input: z.infer<S>) => Promise<unknown>;
};

export type AnyTool = ToolDef<z.ZodObject>;

export function defineTool<S extends z.ZodObject>(def: ToolDef<S>): AnyTool {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(def.name)) throw new Error(`Invalid tool name ${def.name}`);
  return def as unknown as AnyTool;
}

// Keywords left out of the schema the model sees (kept portable across
// providers' strict / structured-output modes); zod still enforces them.
const UNSUPPORTED_KEYS = new Set([
  "$schema",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "default",
]);
const SUPPORTED_FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);

function sanitize(node: unknown, path: string): unknown {
  if (Array.isArray(node)) return node.map((n, i) => sanitize(n, `${path}[${i}]`));
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (UNSUPPORTED_KEYS.has(k)) continue;
    if (k === "format" && typeof v === "string" && !SUPPORTED_FORMATS.has(v)) continue;
    out[k] = sanitize(v, `${path}.${k}`);
  }
  if (out.type === "object") {
    const props = (out.properties ?? {}) as Record<string, unknown>;
    const required = (out.required ?? []) as string[];
    const missing = Object.keys(props).filter((p) => !required.includes(p));
    if (missing.length) {
      throw new Error(`Tool schema ${path}: properties must all be required (use .nullable() for optional): ${missing.join(", ")}`);
    }
    out.properties = props;
    out.additionalProperties = false;
    // Groq rejects `required` on an object with no properties, so a no-input tool omits it.
    if (Object.keys(props).length) out.required = Object.keys(props);
    else delete out.required;
  }
  return out;
}

type JsonObjectSchema = { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };

/** The JSON schema the model sees for a zod object (tool inputs, structured outputs). */
export function jsonSchemaFor(schema: z.ZodObject, name = "schema"): JsonObjectSchema {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input", unrepresentable: "throw" });
  const clean = sanitize(json, name) as JsonObjectSchema;
  if (clean.type !== "object") throw new Error(`${name} must be an object schema`);
  return clean;
}

/** Groq function tools with strict schemas, in a fixed order so the request prefix stays stable. */
export function toChatTools(tools: AnyTool[]): ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: jsonSchemaFor(t.input, t.name), strict: true },
  }));
}

/** zod issues as one readable line for an is_error tool result. */
export function describeIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.length ? i.path.join(".") : "input"}: ${i.message}`).join("; ");
}
