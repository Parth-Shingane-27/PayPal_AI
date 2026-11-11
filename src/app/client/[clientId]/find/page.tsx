import { FindServices } from "@/components/gig/client/FindServices";
import { clientPage } from "@/server/page-auth";

export const metadata = { title: "Find a freelancer" };

export default async function FindPage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ q?: string | string[] }> }) {
  const client = await clientPage((await params).clientId);
  const { q } = await searchParams;
  const query = (Array.isArray(q) ? q[0] : q)?.slice(0, 300) ?? "";
  // The Hiring assistant in the side panel is scoped to this market; the list re-mounts when the market changes.
  return <FindServices key={client.market} market={client.market} initialQuery={query} />;
}
