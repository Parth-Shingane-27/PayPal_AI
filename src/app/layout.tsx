import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Hanken_Grotesk } from "next/font/google";
import { I18nProvider } from "@/components/i18n/I18nProvider";
import { getUiLang } from "@/lib/i18n/server";
import "./globals.css";

const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", display: "swap" });
const hanken = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-hanken", display: "swap" });

const SITE_URL = process.env.APP_URL ?? "http://localhost:3000";
const DESCRIPTION = "Freelancers sell services to clients in 11 markets. AI localizes each service page and sets rates per market, clients pay each milestone in their own currency through PayPal, and the money is held until they accept the work.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "GlobalGig", template: "%s | GlobalGig" },
  description: DESCRIPTION,
  applicationName: "GlobalGig",
  keywords: ["freelance marketplace", "hire freelancers abroad", "milestone payments", "PayPal", "localized service pages", "multi-currency"],
  authors: [{ name: "GlobalGig" }],
  creator: "GlobalGig",
  formatDetection: { telephone: false, email: false, address: false },
  openGraph: {
    type: "website",
    siteName: "GlobalGig",
    locale: "en_US",
    title: "GlobalGig",
    description: DESCRIPTION,
    url: "/",
  },
  twitter: { card: "summary_large_image", title: "GlobalGig", description: DESCRIPTION },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#fbf8f1",
  colorScheme: "light",
};

/** Applies the saved theme before first paint so there is no flash. */
const THEME_SCRIPT = `try{if(localStorage.getItem("gg-theme-v2")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

/**
 * Applies the saved assistant-panel state before first paint, so the page does not jump when the
 * panel was left collapsed or resized. Keep the key and shape in step with components/assistant/dock-store.ts.
 */
const DOCK_SCRIPT = `try{var d=JSON.parse(localStorage.getItem("gg-dock-v1")||"null"),r=document.documentElement;if(d&&d.open===false)r.dataset.dock="closed";else if(d&&typeof d.width==="number")r.style.setProperty("--dock-w",d.width+"px")}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getUiLang();
  return (
    <html lang={lang} className={`${bricolage.variable} ${hanken.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: DOCK_SCRIPT }} />
      </head>
      <body>
        <I18nProvider lang={lang}>{children}</I18nProvider>
      </body>
    </html>
  );
}
