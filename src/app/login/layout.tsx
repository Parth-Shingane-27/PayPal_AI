import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Try the demo",
  description: "Sign in as one of ten freelancers or ten clients and explore GlobalGig: localized service pages, milestone payments through PayPal, multilingual messages and an earnings ledger.",
  alternates: { canonical: "/login" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
