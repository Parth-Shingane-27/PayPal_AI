import { notFound } from "next/navigation";
import { type MilestoneDetail, ProjectView } from "@/components/gig/client/ProjectView";
import { isUuid } from "@/lib/routes";
import { gigOwnerOf } from "@/server/auth";
import { AppError } from "@/server/errors";
import { clientPage } from "@/server/page-auth";
import { contractDetails, milestoneStatus } from "@/server/services/gig/insights";

export const metadata = { title: "Project" };

/** States in which a milestone has (or had) a delivery worth showing. */
const WITH_DELIVERY = new Set(["DELIVERED", "REVISION_REQUESTED", "DISPUTED", "ACCEPTED", "REFUNDED"]);

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ clientId: string; contractId: string }>; searchParams: Promise<{ cancelled?: string | string[] }> }) {
  const { clientId, contractId } = await params;
  const client = await clientPage(clientId);
  if (!isUuid(contractId)) notFound();
  const owner = gigOwnerOf(client);
  let contract: Awaited<ReturnType<typeof contractDetails>>;
  try {
    contract = await contractDetails(owner, contractId);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  const withDelivery = contract.milestones.filter((m) => WITH_DELIVERY.has(m.state) || m.delivered_at !== null);
  const details: Record<string, MilestoneDetail> = Object.fromEntries(
    await Promise.all(
      withDelivery.map(async (m) => {
        const s = await milestoneStatus(owner, m.milestone_id);
        return [m.milestone_id, { history: s.history, deliverables: s.deliverables }] as const;
      }),
    ),
  );
  const { cancelled } = await searchParams;
  return <ProjectView key={contract.contract_id} contract={contract} details={details} paypalClientId={process.env.PAYPAL_CLIENT_ID ?? null} paymentCancelled={Boolean(cancelled)} />;
}
