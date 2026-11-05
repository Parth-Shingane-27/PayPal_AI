import { NextResponse } from "next/server";
import { z } from "zod";
import { cookieOptions, requireBuyer, SESSION_COOKIE, signSession } from "@/server/auth";
import { MARKET_LOCALES } from "@/server/domain/markets";
import { handler, readBody } from "@/server/http";

/** The buyer's market picker: re-issues the signed session with the new market. */
export const POST = handler(async (req) => {
  const buyer = await requireBuyer(req);
  const { locale } = await readBody(req, z.object({ locale: z.enum(MARKET_LOCALES) }));
  const res = NextResponse.json({ ok: true, market: locale });
  res.cookies.set(SESSION_COOKIE, signSession({ role: "BUYER", id: buyer.buyerId, market: locale }), cookieOptions());
  return res;
});
