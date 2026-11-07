"use client";

import { useParams } from "next/navigation";
import { buyerPath, sellerPath } from "./routes";

/**
 * The signed-in account's address prefix, read from the URL: `/seller/<id>` on
 * seller pages and `/buyer/<id>` on buyer pages. Build every in-page link as
 * `${base}/ledger` so no component hardcodes a path.
 */
export function useBase(): string {
  const { sellerId, buyerId } = useParams<{ sellerId?: string; buyerId?: string }>();
  if (sellerId) return sellerPath(sellerId);
  if (buyerId) return buyerPath(buyerId);
  return "";
}
