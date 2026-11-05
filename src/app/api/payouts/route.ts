import { z } from "zod";
import { requireSeller } from "@/server/auth";
import { SUPPORTED_CURRENCIES } from "@/server/domain/money";
import { handler, json, readBody } from "@/server/http";
import { payOutNow } from "@/server/services/quick-actions";

/** The seller's "Pay out now" click: sends everything available in one currency to their PayPal account. */
export const POST = handler(async (req) => {
  const seller = await requireSeller(req);
  const body = await readBody(req, z.object({ currency: z.enum(SUPPORTED_CURRENCIES) }));
  return json(await payOutNow(seller.sellerId, body.currency));
});
