import { Suspense } from "react";
import { ThreadInbox } from "@/components/gig/ThreadInbox";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("nav.messages") };
}

export default async function FreelancerMessagesPage() {
  const t = await getT();
  return (
    <Suspense fallback={<p className="text-ink-3">{t("msg.loading")}</p>}>
      <ThreadInbox role="FREELANCER" />
    </Suspense>
  );
}
