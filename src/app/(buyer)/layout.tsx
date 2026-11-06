import { MarketPicker } from "@/components/MarketPicker";
import type { Metadata } from "next";
import { type NavLink, Shell } from "@/components/shell/Shell";
import type { MessageKey } from "@/lib/i18n/messages";
import { getT } from "@/lib/i18n/server";
import { buyerPage } from "@/server/page-auth";
import { unreadCount } from "@/server/services/messages";

/** Signed-in workspace: never indexed. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

const LINKS: (Omit<NavLink, "label"> & { key: MessageKey })[] = [
  { href: "/buyer", key: "nav.journal", icon: "journal", exact: true },
  { href: "/shop", key: "nav.shop", icon: "shop" },
  { href: "/cart", key: "nav.cart", icon: "cart" },
  { href: "/orders", key: "nav.orders", icon: "orders" },
  { href: "/buyer/messages", key: "nav.messages", icon: "messages", badge: "unread" },
];

export default async function BuyerLayout({ children }: { children: React.ReactNode }) {
  const buyer = await buyerPage();
  const unread = await unreadCount(buyer);
  const t = await getT();
  const links: NavLink[] = LINKS.map(({ key, ...l }) => ({ ...l, label: t(key) }));
  return (
    <Shell variant="bar" links={links} who={buyer.name} sub={t("shell.buyer")} initialUnread={unread} tools={<MarketPicker current={buyer.market} />}>
      {children}
    </Shell>
  );
}
