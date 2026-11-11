import { QuotesView } from "@/components/gig/client/QuotesView";
import { gigOwnerOf } from "@/server/auth";
import { clientPage } from "@/server/page-auth";
import { listBriefs } from "@/server/services/gig/briefs";
import { listQuotes } from "@/server/services/gig/quotes";

export const metadata = { title: "Quotes" };

export default async function QuotesPage({ params }: { params: Promise<{ clientId: string }> }) {
  const client = await clientPage((await params).clientId);
  const owner = gigOwnerOf(client);
  const [quotes, briefs] = await Promise.all([listQuotes(owner), listBriefs(owner)]);
  const briefTitles = Object.fromEntries(briefs.map((b) => [b.brief_id, b.title]));
  return <QuotesView quotes={quotes} briefTitles={briefTitles} />;
}
