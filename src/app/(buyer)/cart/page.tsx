import { buyerPage } from "@/server/page-auth";
import { CartView } from "./CartView";

export const metadata = { title: "Cart" };

export default async function CartPage({ searchParams }: { searchParams: Promise<{ cancelled?: string }> }) {
  await buyerPage();
  const { cancelled } = await searchParams;
  return <CartView paypalClientId={process.env.PAYPAL_CLIENT_ID || null} cancelled={Boolean(cancelled)} />;
}
