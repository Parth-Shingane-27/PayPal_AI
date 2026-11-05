import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "./errors";

/** Shared plumbing for API route handlers. */

type ErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } };

export function errorBody(err: unknown): { status: number; body: ErrorBody } {
  if (err instanceof AppError) {
    return { status: err.httpStatus, body: { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } } };
  }
  console.error("unhandled API error", err);
  return { status: 500, body: { error: { code: "INTERNAL", message: "Something went wrong. Please try again." } } };
}

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/** Wraps a handler: AppError -> its status, anything else -> 500 with details in the log. */
export function handler<C>(fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") checkOrigin(req);
      return await fn(req, ctx);
    } catch (err) {
      const { status, body } = errorBody(err);
      return json(body, status);
    }
  };
}

/** Rejects cross-site mutations (the session cookie is also SameSite=Lax). */
export function checkOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError("FORBIDDEN", "Bad origin.");
  }
  if (host && originHost !== host) throw new AppError("FORBIDDEN", "Cross-site request refused.");
}

export async function readBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new AppError("INVALID_INPUT", "Request body must be JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("INVALID_INPUT", parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  }
  return parsed.data;
}

const idParam = z.uuid();

/** Validates a dynamic route id; malformed ids read as "not found". */
export async function routeId(params: Promise<{ id: string }>, what: string): Promise<string> {
  const { id } = await params;
  if (!idParam.safeParse(id).success) throw new AppError("NOT_FOUND", `${what} not found.`);
  return id;
}
