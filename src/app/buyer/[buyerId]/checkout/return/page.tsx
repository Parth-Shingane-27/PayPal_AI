import Link from "next/link";
import { buyerPath } from "@/lib/routes";
import { AppError } from "@/server/errors";
import { buyerPage } from "@/server/page-auth";
import { captureCheckout } from "@/server/services/checkout";

export const metadata = { title: "Payment" };

/**
 * Redirect checkout: PayPal sends the buyer back here with ?token=<PayPal
 * order id> after approval. Capture is idempotent, so a refresh is harmless.
 */
export default async function CheckoutReturnPage({ params, searchParams }: { params: Promise<{ buyerId: string }>; searchParams: Promise<{ token?: string }> }) {
  // Capturing a payment is a side effect: refuse a URL that names someone else before doing anything.
  const buyer = await buyerPage((await params).buyerId);
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
  const style = { ok: "bg-positive-soft text-positive-ink", wait: "bg-amber-50 text-amber-800", bad: "bg-red-50 text-red-800" }[outcome.tone];
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Checkout</h1>
      <p className={`rounded p-3 ${style}`}>{outcome.text}</p>
      <div className="flex gap-4 text-sm">
        <Link className="text-blue-700 underline" href={buyerPath(buyer.buyerId, "orders")}>
          Your orders
        </Link>
        <Link className="text-blue-700 underline" href={buyerPath(buyer.buyerId, "cart")}>
          Cart
        </Link>
      </div>
    </div>
  );
}
