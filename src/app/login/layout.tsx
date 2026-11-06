import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Try the demo",
  description: "Sign in as one of ten makers or ten buyers and explore GlobalCart: localized listings, PayPal checkout, multilingual messages and a sales ledger.",
  alternates: { canonical: "/login" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
