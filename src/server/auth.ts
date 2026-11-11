import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { coreConfig } from "./config";
import { prisma } from "./db";
import { isMarketLocale } from "./domain/markets";
import { AppError } from "./errors";

/**
 * Session = HMAC-SHA256 signed cookie: base64url(JSON payload) + "." + base64url(mac).
 * The payload names the actor; every service re-checks ownership by id. A
 * client's chosen market lives in the same signed cookie.
 */

export const SESSION_COOKIE = "gg_session";
const SESSION_TTL_S = 7 * 24 * 60 * 60;

const payloadSchema = z.object({
  role: z.enum(["FREELANCER", "CLIENT"]),
  id: z.uuid(),
  market: z.string().nullable(),
  exp: z.number().int(),
});
type SessionPayload = z.infer<typeof payloadSchema>;

/** The signed-in account. A client's market can be changed from the market picker; a freelancer works in their own locale. */
export type Principal =
  | { role: "FREELANCER"; freelancerId: string; name: string; locale: string; currency: string; country: string }
  | { role: "CLIENT"; clientId: string; name: string; market: string; country: string };

/** The owner a service expects, from a principal. */
export function gigOwnerOf(p: Principal) {
  return p.role === "FREELANCER"
    ? { type: "FREELANCER" as const, freelancerId: p.freelancerId, locale: p.locale }
    : { type: "CLIENT" as const, clientId: p.clientId, locale: p.market };
}

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

/** Loads the freelancer or client named by a verified token; null if it no longer exists. */
export async function principalFromToken(token: string | undefined | null): Promise<Principal | null> {
  const p = verifySession(token);
  if (!p) return null;
  if (p.role === "FREELANCER") {
    const f = await prisma.freelancer.findUnique({ where: { id: p.id } });
    return f ? { role: "FREELANCER", freelancerId: f.id, name: f.name, locale: f.locale, currency: f.currency, country: f.country } : null;
  }
  if (p.role === "CLIENT") {
    const c = await prisma.client.findUnique({ where: { id: p.id } });
    if (!c) return null;
    return { role: "CLIENT", clientId: c.id, name: c.company_name ?? c.name, market: p.market && isMarketLocale(p.market) ? p.market : c.locale, country: c.country };
  }
  return null;
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export async function requirePrincipal(req: Request): Promise<Principal> {
  const p = await principalFromToken(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
  if (!p) throw new AppError("UNAUTHENTICATED", "Please sign in.");
  return p;
}

/** Any signed-in account and the agent-session owner it maps to. */
export async function requireChatOwner(req: Request): Promise<{
  principal: Principal;
  owner: { type: "FREELANCER"; freelancerId: string } | { type: "CLIENT"; clientId: string };
}> {
  const principal = await requirePrincipal(req);
  return { principal, owner: principal.role === "FREELANCER" ? { type: "FREELANCER", freelancerId: principal.freelancerId } : { type: "CLIENT", clientId: principal.clientId } };
}

export async function requireFreelancer(req: Request): Promise<Extract<Principal, { role: "FREELANCER" }>> {
  const p = await requirePrincipal(req);
  if (p.role !== "FREELANCER") throw new AppError("FORBIDDEN", "This is for freelancers.");
  return p;
}

export async function requireClient(req: Request): Promise<Extract<Principal, { role: "CLIENT" }>> {
  const p = await requirePrincipal(req);
  if (p.role !== "CLIENT") throw new AppError("FORBIDDEN", "This is for clients.");
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
