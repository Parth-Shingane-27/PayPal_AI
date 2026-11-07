import type { Metadata } from "next";
import { type NavLink, Shell } from "@/components/shell/Shell";
import type { MessageKey } from "@/lib/i18n/messages";
import { getT } from "@/lib/i18n/server";
import { getMarket } from "@/server/domain/markets";
import { sellerPage } from "@/server/page-auth";
import { unreadCount } from "@/server/services/messages";

/** Signed-in workspace: never indexed. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

const LINKS: (Omit<NavLink, "label"> & { key: MessageKey })[] = [
  { href: "/seller", key: "nav.overview", icon: "overview", exact: true },
  { href: "/seller/ledger", key: "nav.ledger", icon: "ledger" },
  { href: "/seller/messages", key: "nav.messages", icon: "messages", badge: "unread" },
  { href: "/seller/products", key: "nav.products", icon: "products" },
  { href: "/seller/treasury", key: "nav.treasury", icon: "treasury" },
  { href: "/seller/operations", key: "nav.operations", icon: "operations" },
  { href: "/seller/approvals", key: "nav.approvals", icon: "approvals" },
  { href: "/seller/activity", key: "nav.activity", icon: "activity" },
  { href: "/seller/assistant", key: "nav.assistant", icon: "assistant" },
];

export default async function SellerLayout({ children }: { children: React.ReactNode }) {
  const seller = await sellerPage();
  const unread = await unreadCount(seller);
  const market = getMarket(seller.locale);
  const t = await getT();
  const links: NavLink[] = LINKS.map(({ key, ...l }) => ({ ...l, label: t(key) }));
  return (
    <Shell variant="rail" links={links} who={seller.name} sub={t("shell.sellsFrom", { country: market.country, currency: market.currency })} initialUnread={unread}>
      {children}
    </Shell>
  );
}
