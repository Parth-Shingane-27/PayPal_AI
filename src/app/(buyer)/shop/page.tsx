import { AskAi } from "@/components/AskAi";
import { ChatPanel } from "@/components/ChatPanel";
import { getMarket } from "@/server/domain/markets";
import { buyerPage } from "@/server/page-auth";
import { listPublishedListings } from "@/server/services/search";
import { ProductList } from "./ProductList";

export const metadata = { title: "Shop" };

export default async function ShopPage() {
  const buyer = await buyerPage();
  const market = getMarket(buyer.market);
  const listings = await listPublishedListings(market.locale);
  return (
    <div className="space-y-6">
      <ProductList key={market.locale} listings={listings} />
      <AskAi label="Ask the shopping assistant" hint={`Describe what you want in any language. Prices are in ${market.currency} and include shipping.`}>
        <ChatPanel
          key={`chat-${market.locale}`}
          resumeKey={market.locale}
          title={`Shopping assistant · ${market.language} · ${market.currency}`}
          placeholder={`Ask for a product in any language. You are shopping the ${market.locale} market; prices are in ${market.currency} and include shipping.`}
          paypalClientId={process.env.PAYPAL_CLIENT_ID || null}
        />
      </AskAi>
    </div>
  );
}
