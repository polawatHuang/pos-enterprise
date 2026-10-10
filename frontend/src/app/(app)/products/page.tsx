import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { ProductsView } from "@/components/products/products-view";

export const metadata: Metadata = { title: "สินค้า" };

export default function ProductsPage() {
  return (
    <RequirePermission permission="products:read">
      <ProductsView />
    </RequirePermission>
  );
}
