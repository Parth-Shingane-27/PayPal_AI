import { demoLoginEnabled } from "@/server/config";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { handler, json } from "@/server/http";

/** Seeded accounts for the demo login screen. */
export const GET = handler(async () => {
  if (!demoLoginEnabled()) throw new AppError("FORBIDDEN", "Demo login is disabled.");
  const [sellers, buyers] = await Promise.all([
    prisma.seller.findMany({ select: { id: true, name: true, country: true, currency: true, locale: true }, orderBy: { name: "asc" } }),
    prisma.buyer.findMany({ select: { id: true, name: true, country: true, locale: true }, orderBy: { name: "asc" } }),
  ]);
  return json({ sellers, buyers });
});
