import type { Metadata } from "next";
import { MarketPicker } from "@/components/MarketPicker";
import { type NavLink, Shell } from "@/components/shell/Shell";
import type { MessageKey } from "@/lib/i18n/messages";
import { getT } from "@/lib/i18n/server";
import { clientPath } from "@/lib/routes";
import { gigOwnerOf } from "@/server/auth";
import { clientPage } from "@/server/page-auth";
import { threadUnreadCount } from "@/server/services/gig/threads";

/** Signed-in workspace: never indexed. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

const LINKS: (Omit<NavLink, "label" | "href"> & { sub: string; key: MessageKey })[] = [
  { sub: "", key: "cl.nav.dashboard", icon: "overview", exact: true },
  { sub: "briefs", key: "cl.nav.briefs", icon: "briefs" },
  { sub: "projects", key: "cl.nav.projects", icon: "projects" },
  { sub: "messages", key: "nav.messages", icon: "messages", badge: "unread" },
  { sub: "invoices", key: "cl.nav.invoices", icon: "invoices" },
];

export default async function ClientLayout({ children, params }: { children: React.ReactNode; params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const client = await clientPage(clientId);
  const unread = await threadUnreadCount(gigOwnerOf(client));
  const t = await getT();
  const links: NavLink[] = LINKS.map(({ key, sub, ...l }) => ({ ...l, href: clientPath(client.clientId, sub), label: t(key) }));
  return (
    <Shell
      variant="bar"
      assistant={{ role: "CLIENT", paypalClientId: process.env.PAYPAL_CLIENT_ID ?? null, market: client.market }}
      links={links}
      who={client.name}
      sub={t("cl.shell.sub")}
      initialUnread={unread}
      tools={<MarketPicker current={client.market} />}
    >
      {children}
    </Shell>
  );
}
