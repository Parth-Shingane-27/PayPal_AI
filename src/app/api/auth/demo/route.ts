import { NextResponse } from "next/server";
import { z } from "zod";
import { cookieOptions, SESSION_COOKIE, signSession } from "@/server/auth";
import { demoLoginEnabled } from "@/server/config";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { handler, readBody } from "@/server/http";

const bodySchema = z.object({ role: z.enum(["SELLER", "BUYER"]), id: z.uuid() });

/** Demo login: sign in as a seeded seller or buyer. Off in production unless DEMO_LOGIN=true. */
export const POST = handler(async (req) => {
  if (!demoLoginEnabled()) throw new AppError("FORBIDDEN", "Demo login is disabled.");
  const { role, id } = await readBody(req, bodySchema);
  const exists = role === "SELLER" ? await prisma.seller.findUnique({ where: { id } }) : await prisma.buyer.findUnique({ where: { id } });
  if (!exists) throw new AppError("NOT_FOUND", "Account not found.");
  const res = NextResponse.json({ ok: true, role, redirect: role === "SELLER" ? "/seller/products" : "/shop" });
  res.cookies.set(SESSION_COOKIE, signSession({ role, id, market: null }), cookieOptions());
  return res;
});
