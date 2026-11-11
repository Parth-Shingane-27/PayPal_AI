import { getT } from "@/lib/i18n/server";
import { ApprovalsView } from "./ApprovalsView";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("nav.approvals") };
}

export default function ApprovalsPage() {
  return <ApprovalsView />;
}
