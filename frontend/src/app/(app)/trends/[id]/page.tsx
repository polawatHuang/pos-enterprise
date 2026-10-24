"use client";

import { useParams } from "next/navigation";
import { RequirePermission } from "@/components/layout/page";
import { TrendProductPage } from "@/components/trends/product-page";

export default function TrendProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequirePermission permission="scraping:read">
      <TrendProductPage key={id} id={Number(id)} />
    </RequirePermission>
  );
}
