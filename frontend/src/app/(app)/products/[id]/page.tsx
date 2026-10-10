"use client";

import { useParams } from "next/navigation";
import { RequirePermission } from "@/components/layout/page";
import { ProductDetail } from "@/components/products/product-detail";

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequirePermission permission="products:read">
      <ProductDetail key={id} id={Number(id)} />
    </RequirePermission>
  );
}
