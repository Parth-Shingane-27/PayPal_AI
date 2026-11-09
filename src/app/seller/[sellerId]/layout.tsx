import type { Metadata } from "next";
import { type NavLink, Shell } from "@/components/shell/Shell";
import type { MessageKey } from "@/lib/i18n/messages";
import { getT } from "@/lib/i18n/server";
import { getMarket } from "@/server/domain/markets";
import { sellerPath } from "@/lib/routes";
import { sellerPage } from "@/server/page-auth";
import { unreadCount } from "@/server/services/messages";
import { newFindingCounts } from "@/server/proactive/findings";

/** Signed-in workspace: never indexed. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

const LINKS: (Omit<NavLink, "label" | "href"> & { sub: string; key: MessageKey })[] = [
  { sub: "", key: "nav.overview", icon: "overview", exact: true },
  { sub: "ledger", key: "nav.ledger", icon: "ledger" },
  { sub: "messages", key: "nav.messages", icon: "messages", badge: "unread" },
  { sub: "products", key: "nav.products", icon: "products" },
  { sub: "treasury", key: "nav.treasury", icon: "treasury" },
  { sub: "operations", key: "nav.operations", icon: "operations" },
  { sub: "approvals", key: "nav.approvals", icon: "approvals" },
  { sub: "activity", key: "nav.activity", icon: "activity" },
  { sub: "assistant", key: "nav.assistant", icon: "assistant" },
];

export default async function SellerLayout({ children, params }: { children: React.ReactNode; params: Promise<{ sellerId: string }> }) {
  const { sellerId } = await params;
  const seller = await sellerPage(sellerId);
  const [unread, found] = await Promise.all([unreadCount(seller), newFindingCounts(seller.sellerId)]);
  const market = getMarket(seller.locale);
  const t = await getT();
  const links: NavLink[] = LINKS.map(({ key, sub, ...l }) => ({
    ...l,
    href: sellerPath(seller.sellerId, sub),
    label: t(key),
    // New findings count on the page of the agent that wrote them.
    count: sub === "treasury" ? found.TREASURY : sub === "operations" ? found.OPERATIONS : undefined,
  }));
  return (
    <Shell variant="rail" assistant={{ role: "SELLER" }} links={links} who={seller.name} sub={t("shell.sellsFrom", { country: market.country, currency: market.currency })} initialUnread={unread}>
      {children}
    </Shell>
  );
}
