import { ProductEditor } from "./ProductEditor";

export const metadata = { title: "Edit product" };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductEditor productId={id} />;
}
