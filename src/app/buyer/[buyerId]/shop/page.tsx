import { getT } from "@/lib/i18n/server";
import { getMarket } from "@/server/domain/markets";
import { buyerPage } from "@/server/page-auth";
import { listPublishedListings } from "@/server/services/search";
import { ShopClient } from "./ShopClient";

export const metadata = { title: "Shop" };

export default async function ShopPage() {
  const buyer = await buyerPage();
  const market = getMarket(buyer.market);
  const t = await getT();
  const listings = await listPublishedListings(market.locale);
  return (
    <ShopClient
      key={market.locale}
      listings={listings}
      locale={market.locale}
      label={t("shop.assistant")}
      hint={t("shop.assistantHint", { currency: market.currency })}
      title={`Shopping agent · ${market.language} · ${market.currency}`}
      placeholder={`Tell me what you want, in any language. I'll find it, compare options, fill your cart and start PayPal checkout. You only approve the payment. Prices are in ${market.currency} and include shipping.`}
      suggestions={[
        "Find me a handmade gift for a friend and add the best one to my cart",
        "Compare the two cheapest mugs and buy the better value one",
        "Show what's in my cart and take me to checkout",
        "Find a ceramic mug under 40 and check out with PayPal",
      ]}
      paypalClientId={process.env.PAYPAL_CLIENT_ID || null}
    />
  );
}
