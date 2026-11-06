import { MarketPicker } from "@/components/MarketPicker";
import type { Metadata } from "next";
import { type NavLink, Shell } from "@/components/shell/Shell";
import { buyerPage } from "@/server/page-auth";
import { unreadCount } from "@/server/services/messages";

/** Signed-in workspace: never indexed. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

const LINKS: NavLink[] = [
  { href: "/buyer", label: "Journal", icon: "journal", exact: true },
  { href: "/shop", label: "Shop", icon: "shop" },
  { href: "/cart", label: "Cart", icon: "cart" },
  { href: "/orders", label: "Orders", icon: "orders" },
  { href: "/buyer/messages", label: "Messages", icon: "messages", badge: "unread" },
];

export default async function BuyerLayout({ children }: { children: React.ReactNode }) {
  const buyer = await buyerPage();
  const unread = await unreadCount(buyer);
  return (
    <Shell variant="bar" links={LINKS} who={buyer.name} sub="Buyer" initialUnread={unread} tools={<MarketPicker current={buyer.market} />}>
      {children}
    </Shell>
  );
}
