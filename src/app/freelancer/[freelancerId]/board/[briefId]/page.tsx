import { getT } from "@/lib/i18n/server";
import { ProjectDetail } from "./ProjectDetail";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("pj.board.title") };
}

export default async function ProjectPage({ params }: { params: Promise<{ briefId: string }> }) {
  const { briefId } = await params;
  return <ProjectDetail briefId={briefId} />;
}
