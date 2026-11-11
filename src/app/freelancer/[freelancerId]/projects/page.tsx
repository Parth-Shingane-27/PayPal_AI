import { getT } from "@/lib/i18n/server";
import { ProjectsBoard } from "./ProjectsBoard";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("fl.nav.projects") };
}

export default function ProjectsPage() {
  return <ProjectsBoard />;
}
