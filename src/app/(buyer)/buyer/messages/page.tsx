import { Suspense } from "react";
import { Inbox } from "@/components/inbox/Inbox";

export const metadata = { title: "Messages" };

export default function BuyerMessagesPage() {
  return (
    <Suspense fallback={<p className="text-ink-3">Loading messages…</p>}>
      <Inbox role="BUYER" />
    </Suspense>
  );
}
