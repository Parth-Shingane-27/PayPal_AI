import { getT } from "@/lib/i18n/server";
import { ServiceEditor } from "./ServiceEditor";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("fl.svc.editTitle") };
}

export default async function ServicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ServiceEditor serviceId={id} />;
}
