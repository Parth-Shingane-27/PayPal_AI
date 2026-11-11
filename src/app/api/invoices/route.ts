import { gigOwnerOf, requirePrincipal } from "@/server/auth";
import { handler, json } from "@/server/http";
import { listInvoices } from "@/server/services/gig/invoices";

export const GET = handler(async (req) => {
  const p = await requirePrincipal(req);
  return json({ invoices: await listInvoices(gigOwnerOf(p), { limit: 500 }) });
});
