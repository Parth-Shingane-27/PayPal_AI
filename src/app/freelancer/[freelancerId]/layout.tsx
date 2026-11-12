import type { Metadata } from "next";
import { type NavLink, Shell } from "@/components/shell/Shell";
import type { MessageKey } from "@/lib/i18n/messages";
import { getT } from "@/lib/i18n/server";
import { freelancerPath } from "@/lib/routes";
import { freelancerPage } from "@/server/page-auth";
import { countNewFindings } from "@/server/proactive/findings";
import { threadUnreadCount } from "@/server/services/gig/threads";

/** Signed-in workspace: never indexed. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

const LINKS: (Omit<NavLink, "label" | "href"> & { sub: string; key: MessageKey })[] = [
  { sub: "", key: "nav.overview", icon: "overview", exact: true },
  { sub: "board", key: "pj.nav.board", icon: "find" },
  { sub: "projects", key: "fl.nav.projects", icon: "projects" },
  { sub: "messages", key: "nav.messages", icon: "messages", badge: "unread" },
  { sub: "earnings", key: "fl.nav.earnings", icon: "earnings" },
];

export default async function FreelancerLayout({ children, params }: { children: React.ReactNode; params: Promise<{ freelancerId: string }> }) {
  const { freelancerId } = await params;
  const f = await freelancerPage(freelancerId);
  const [unread, found] = await Promise.all([threadUnreadCount({ type: "FREELANCER", freelancerId: f.freelancerId, locale: f.locale }), countNewFindings(f.freelancerId)]);
  const t = await getT();
  const links: NavLink[] = LINKS.map(({ key, sub, ...l }) => ({
    ...l,
    href: freelancerPath(f.freelancerId, sub),
    label: t(key),
    // New findings show on the dashboard, where the feed is.
    count: sub === "" ? found : undefined,
  }));
  const countryKey = `country.${f.country}` as MessageKey;
  const country = t(countryKey) === countryKey ? f.country : t(countryKey);
  return (
    <Shell
      variant="rail"
      assistant={{ role: "FREELANCER" }}
      links={links}
      who={f.name}
      sub={t("fl.shell.sub", { country, currency: f.currency })}
      initialUnread={unread}
    >
      {children}
    </Shell>
  );
}
