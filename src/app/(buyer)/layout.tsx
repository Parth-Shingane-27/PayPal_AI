import { MarketPicker } from "@/components/MarketPicker";
import { Nav } from "@/components/Nav";
import { buyerPage } from "@/server/page-auth";

const LINKS = [
  { href: "/shop", label: "Shop" },
  { href: "/cart", label: "Cart" },
  { href: "/orders", label: "Orders" },
];

export default async function BuyerLayout({ children }: { children: React.ReactNode }) {
  const buyer = await buyerPage();
  return (
    <>
      <Nav links={LINKS} who={buyer.name}>
        <MarketPicker current={buyer.market} />
      </Nav>
      <main className="mx-auto max-w-7xl p-4">{children}</main>
    </>
  );
}
