import type { Metadata } from "next";
import { type NavLink, Shell } from "@/components/shell/Shell";
import { getMarket } from "@/server/domain/markets";
import { sellerPage } from "@/server/page-auth";
import { unreadCount } from "@/server/services/messages";

/** Signed-in workspace: never indexed. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

const LINKS: NavLink[] = [
  { href: "/seller", label: "Overview", icon: "overview", exact: true },
  { href: "/seller/ledger", label: "Sales ledger", icon: "ledger" },
  { href: "/seller/messages", label: "Messages", icon: "messages", badge: "unread" },
  { href: "/seller/products", label: "Products", icon: "products" },
  { href: "/seller/treasury", label: "Treasury", icon: "treasury" },
  { href: "/seller/operations", label: "Operations", icon: "operations" },
  { href: "/seller/approvals", label: "Approvals", icon: "approvals" },
  { href: "/seller/activity", label: "Activity", icon: "activity" },
  { href: "/seller/assistant", label: "Assistant", icon: "assistant" },
];

export default async function SellerLayout({ children }: { children: React.ReactNode }) {
  const seller = await sellerPage();
  const unread = await unreadCount(seller);
  const market = getMarket(seller.locale);
  return (
    <Shell variant="rail" links={LINKS} who={seller.name} sub={`Sells from ${market.country} in ${market.currency}`} initialUnread={unread}>
      {children}
    </Shell>
  );
}
