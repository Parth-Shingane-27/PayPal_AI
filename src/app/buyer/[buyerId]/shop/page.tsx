import { getMarket } from "@/server/domain/markets";
import { buyerPage } from "@/server/page-auth";
import { listPublishedListings } from "@/server/services/search";
import { ProductList } from "./ProductList";

export const metadata = { title: "Shop" };

export default async function ShopPage() {
  const buyer = await buyerPage();
  const market = getMarket(buyer.market);
  const listings = await listPublishedListings(market.locale);
  // The shopping assistant lives in the side panel (see components/assistant); it is already scoped to this market.
  return (
    <div className="space-y-6">
      <ProductList key={market.locale} listings={listings} />
    </div>
  );
}
