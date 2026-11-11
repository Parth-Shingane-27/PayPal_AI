import { clientPage } from "@/server/page-auth";
import { CheckoutReturn } from "./CheckoutReturn";

export const metadata = { title: "Payment" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

/**
 * Redirect checkout for a milestone: PayPal sends the client back here with
 * ?token=<PayPal order id>&milestone=<id>. The page captures once (idempotent
 * on the server, so a refresh is harmless). ?cancelled= means nothing was charged.
 */
export default async function CheckoutReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ token?: string | string[]; milestone?: string | string[]; cancelled?: string | string[] }>;
}) {
  // Capturing is a side effect: refuse a URL that names someone else before anything runs.
  await clientPage((await params).clientId);
  const sp = await searchParams;
  return <CheckoutReturn token={one(sp.token)} milestoneId={one(sp.milestone) ?? one(sp.cancelled)} cancelled={sp.cancelled !== undefined} />;
}
