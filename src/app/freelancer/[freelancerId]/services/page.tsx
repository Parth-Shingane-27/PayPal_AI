import { getT } from "@/lib/i18n/server";
import { ServicesView } from "./ServicesView";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("fl.nav.services") };
}

export default function ServicesPage() {
  return <ServicesView />;
}
