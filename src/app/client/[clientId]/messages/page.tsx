import { Suspense } from "react";
import { ThreadInbox } from "@/components/gig/ThreadInbox";
import { getT } from "@/lib/i18n/server";
import { clientPage } from "@/server/page-auth";

export const metadata = { title: "Messages" };

export default async function ClientMessagesPage({ params }: { params: Promise<{ clientId: string }> }) {
  await clientPage((await params).clientId);
  const t = await getT();
  return (
    <Suspense fallback={<p className="text-ink-3">{t("msg.loading")}</p>}>
      <ThreadInbox role="CLIENT" />
    </Suspense>
  );
}
