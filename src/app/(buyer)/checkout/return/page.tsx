import Link from "next/link";
import { AppError } from "@/server/errors";
import { buyerPage } from "@/server/page-auth";
import { captureCheckout } from "@/server/services/checkout";

/**
 * Redirect checkout: PayPal sends the buyer back here with ?token=<PayPal
 * order id> after approval. Capture is idempotent, so a refresh is harmless.
 */
export default async function CheckoutReturnPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const buyer = await buyerPage();
  const { token } = await searchParams;
  if (!token) return <p className="text-red-700">Missing PayPal order token.</p>;

  let outcome: { tone: "ok" | "wait" | "bad"; text: string };
  try {
    const res = await captureCheckout(buyer.buyerId, token, { actor: { type: "BUYER", buyerId: buyer.buyerId } });
    outcome =
      res.payment_status === "COMPLETED"
        ? { tone: "ok", text: `Payment complete: ${res.total.display}. Thank you!` }
        : res.payment_status === "PENDING"
          ? { tone: "wait", text: `PayPal is still processing your payment of ${res.total.display}. Your order updates when it completes.` }
          : { tone: "bad", text: `The payment was ${res.payment_status.toLowerCase()}. Your cart is still there; please try again.` };
  } catch (err) {
    outcome = { tone: "bad", text: err instanceof AppError ? err.message : "Something went wrong while confirming your payment." };
  }
  const style = { ok: "bg-emerald-50 text-emerald-800", wait: "bg-amber-50 text-amber-800", bad: "bg-red-50 text-red-800" }[outcome.tone];
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Checkout</h1>
      <p className={`rounded p-3 ${style}`}>{outcome.text}</p>
      <div className="flex gap-4 text-sm">
        <Link className="text-blue-700 underline" href="/orders">
          Your orders
        </Link>
        <Link className="text-blue-700 underline" href="/cart">
          Cart
        </Link>
      </div>
    </div>
  );
}
