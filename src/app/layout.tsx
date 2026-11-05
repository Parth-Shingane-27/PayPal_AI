import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GlobalCart",
  description: "List once, sell worldwide. AI agents help; PayPal moves the money.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
