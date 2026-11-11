import { getT } from "@/lib/i18n/server";
import { QuotesView } from "./QuotesView";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("fl.nav.quotes") };
}

export default function QuotesPage() {
  return <QuotesView />;
}
