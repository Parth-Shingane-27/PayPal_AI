"use server";

import { isUuid } from "@/lib/routes";
import { prisma } from "@/server/db";
import { freelancerPage } from "@/server/page-auth";

/**
 * The text of one of the signed-in freelancer's service pages, for the inline
 * editor (the service API lists pages without their description). Read only;
 * saving goes through PATCH /api/service-pages/<id>.
 */
export async function servicePageText(pageId: string): Promise<{ title: string; description: string; seo_title: string } | null> {
  const f = await freelancerPage();
  if (!isUuid(pageId)) return null;
  return prisma.servicePage.findFirst({ where: { id: pageId, freelancer_id: f.freelancerId }, select: { title: true, description: true, seo_title: true } });
}
