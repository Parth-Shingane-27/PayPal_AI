import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { coreConfig } from "./config";
import { prisma } from "./db";
import { isMarketLocale } from "./domain/markets";
import { AppError } from "./errors";

/**
 * Session = HMAC-SHA256 signed cookie: base64url(JSON payload) + "." + base64url(mac).
 * The payload names the actor; every service re-checks ownership by id. A
 * buyer's chosen market lives in the same signed cookie.
 */

export const SESSION_COOKIE = "gc_session";
const SESSION_TTL_S = 7 * 24 * 60 * 60;

const payloadSchema = z.object({
  role: z.enum(["SELLER", "BUYER"]),
  id: z.uuid(),
  market: z.string().nullable(),
  exp: z.number().int(),
});
type SessionPayload = z.infer<typeof payloadSchema>;

export type Principal =
  | { role: "SELLER"; sellerId: string; name: string; locale: string }
  | { role: "BUYER"; buyerId: string; name: string; market: string };

function mac(data: string): string {
  return createHmac("sha256", coreConfig().SESSION_SECRET).update(data).digest("base64url");
}

export function signSession(p: Omit<SessionPayload, "exp">, now = Date.now()): string {
  const payload: SessionPayload = { ...p, exp: Math.floor(now / 1000) + SESSION_TTL_S };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${mac(data)}`;
}

export function verifySession(token: string | undefined | null, now = Date.now()): SessionPayload | null {
  if (!token) return null;
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  const expected = Buffer.from(mac(data));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = payloadSchema.parse(JSON.parse(Buffer.from(data, "base64url").toString("utf8")));
    return payload.exp * 1000 > now ? payload : null;
  } catch {
    return null;
  }
}

/** Loads the actor named by a verified token; null if it no longer exists. */
export async function principalFromToken(token: string | undefined | null): Promise<Principal | null> {
  const p = verifySession(token);
  if (!p) return null;
  if (p.role === "SELLER") {
    const s = await prisma.seller.findUnique({ where: { id: p.id } });
    return s ? { role: "SELLER", sellerId: s.id, name: s.name, locale: s.locale } : null;
  }
  const b = await prisma.buyer.findUnique({ where: { id: p.id } });
  if (!b) return null;
  const market = p.market && isMarketLocale(p.market) ? p.market : b.locale;
  return { role: "BUYER", buyerId: b.id, name: b.name, market };
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

async function principalFromRequest(req: Request): Promise<Principal | null> {
  return principalFromToken(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
}

export async function requirePrincipal(req: Request): Promise<Principal> {
  const p = await principalFromRequest(req);
  if (!p) throw new AppError("UNAUTHENTICATED", "Please sign in.");
  return p;
}

export async function requireSeller(req: Request): Promise<Extract<Principal, { role: "SELLER" }>> {
  const p = await requirePrincipal(req);
  if (p.role !== "SELLER") throw new AppError("FORBIDDEN", "This page is for sellers.");
  return p;
}

export async function requireBuyer(req: Request): Promise<Extract<Principal, { role: "BUYER" }>> {
  const p = await requirePrincipal(req);
  if (p.role !== "BUYER") throw new AppError("FORBIDDEN", "This page is for buyers.");
  return p;
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: coreConfig().NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_S,
  };
}
