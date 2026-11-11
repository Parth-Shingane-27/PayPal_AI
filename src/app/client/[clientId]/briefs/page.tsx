import { BriefsView } from "@/components/gig/client/BriefsView";
import { gigOwnerOf } from "@/server/auth";
import { getMarket } from "@/server/domain/markets";
import { clientPage } from "@/server/page-auth";
import { listBriefs } from "@/server/services/gig/briefs";

export const metadata = { title: "Briefs" };

export default async function BriefsPage({ params }: { params: Promise<{ clientId: string }> }) {
  const client = await clientPage((await params).clientId);
  const briefs = await listBriefs(gigOwnerOf(client));
  return <BriefsView briefs={briefs} currency={getMarket(client.market).currency} />;
}
