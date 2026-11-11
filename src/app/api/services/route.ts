import { requireFreelancer } from "@/server/auth";
import { handler, json, readBody } from "@/server/http";
import { createService, listServices, serviceInputSchema } from "@/server/services/gig/catalog";

/** The freelancer's services. */
export const GET = handler(async (req) => {
  const f = await requireFreelancer(req);
  return json({ services: await listServices(f.freelancerId) });
});

/** Adds a service from the service form (base prices start at the freelancer's floor). */
export const POST = handler(async (req) => {
  const f = await requireFreelancer(req);
  const s = await createService(f.freelancerId, await readBody(req, serviceInputSchema));
  return json({ service_id: s.id }, 201);
});
