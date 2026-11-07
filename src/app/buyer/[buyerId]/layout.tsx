import { MarketPicker } from "@/components/MarketPicker";
import type { Metadata } from "next";
import { type NavLink, Shell } from "@/components/shell/Shell";
import type { MessageKey } from "@/lib/i18n/messages";
import { getT } from "@/lib/i18n/server";
import { buyerPath } from "@/lib/routes";
import { buyerPage } from "@/server/page-auth";
import { unreadCount } from "@/server/services/messages";

/** Signed-in workspace: never indexed. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

const LINKS: (Omit<NavLink, "label" | "href"> & { sub: string; key: MessageKey })[] = [
  { sub: "", key: "nav.journal", icon: "journal", exact: true },
  { sub: "shop", key: "nav.shop", icon: "shop" },
  { sub: "cart", key: "nav.cart", icon: "cart" },
  { sub: "orders", key: "nav.orders", icon: "orders" },
  { sub: "messages", key: "nav.messages", icon: "messages", badge: "unread" },
];

export default async function BuyerLayout({ children, params }: { children: React.ReactNode; params: Promise<{ buyerId: string }> }) {
  const { buyerId } = await params;
  const buyer = await buyerPage(buyerId);
  const unread = await unreadCount(buyer);
  const t = await getT();
  const links: NavLink[] = LINKS.map(({ key, sub, ...l }) => ({ ...l, href: buyerPath(buyer.buyerId, sub), label: t(key) }));
  return (
    <Shell variant="bar" links={links} who={buyer.name} sub={t("shell.buyer")} initialUnread={unread} tools={<MarketPicker current={buyer.market} />}>
      {children}
    </Shell>
  );
}
