import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Hanken_Grotesk } from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", display: "swap" });
const hanken = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-hanken", display: "swap" });

const SITE_URL = process.env.APP_URL ?? "http://localhost:3000";
const DESCRIPTION = "List a product once and sell it in 11 markets. AI localizes and prices each listing, buyers pay in their own currency through PayPal, and makers see exactly what every sale costs.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "GlobalCart", template: "%s | GlobalCart" },
  description: DESCRIPTION,
  applicationName: "GlobalCart",
  keywords: ["cross-border marketplace", "sell internationally", "small makers", "PayPal", "localized listings", "multi-currency"],
  authors: [{ name: "GlobalCart" }],
  creator: "GlobalCart",
  formatDetection: { telephone: false, email: false, address: false },
  openGraph: {
    type: "website",
    siteName: "GlobalCart",
    locale: "en_US",
    title: "GlobalCart",
    description: DESCRIPTION,
    url: "/",
  },
  twitter: { card: "summary_large_image", title: "GlobalCart", description: DESCRIPTION },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#fbf8f1",
  colorScheme: "light",
};

/** Applies the saved theme before first paint so there is no flash. */
const THEME_SCRIPT = `try{if(localStorage.getItem("gc-theme-v2")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${hanken.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
