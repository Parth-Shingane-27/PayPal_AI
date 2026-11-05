import { Nav } from "@/components/Nav";
import { sellerPage } from "@/server/page-auth";

const LINKS = [
  { href: "/seller/products", label: "Products" },
  { href: "/seller/assistant", label: "Assistant" },
  { href: "/seller/treasury", label: "Treasury" },
  { href: "/seller/operations", label: "Operations" },
  { href: "/seller/approvals", label: "Approvals" },
  { href: "/seller/activity", label: "Activity" },
];

export default async function SellerLayout({ children }: { children: React.ReactNode }) {
  const seller = await sellerPage();
  return (
    <>
      <Nav links={LINKS} who={seller.name} />
      <main className="mx-auto max-w-7xl p-4">{children}</main>
    </>
  );
}
