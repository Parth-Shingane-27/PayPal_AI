import { PurchasesGrid } from "@/components/buyer/PurchasesGrid";

export const metadata = { title: "Orders" };

export default function OrdersPage() {
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em]">Your orders</h1>
        <p className="mt-1 max-w-2xl text-ink-3">
          Every purchase in the currency you paid, with how much reached the maker after PayPal, platform and conversion costs.
        </p>
      </header>
      <PurchasesGrid />
    </div>
  );
}
