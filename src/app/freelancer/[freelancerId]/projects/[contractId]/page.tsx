import { getT } from "@/lib/i18n/server";
import { ProjectView } from "./ProjectView";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("fl.proj.title") };
}

export default async function ProjectPage({ params }: { params: Promise<{ contractId: string }> }) {
  const { contractId } = await params;
  return <ProjectView contractId={contractId} />;
}
