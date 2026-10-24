"use client";

import { useParams, useSearchParams } from "next/navigation";
import { RequirePermission } from "@/components/layout/page";
import { CategoryDetailView } from "@/components/trends/category-detail";

export default function TrendCategoryPage() {
  const { id } = useParams<{ id: string }>();
  const period = useSearchParams().get("period") ?? undefined;
  return (
    <RequirePermission permission="scraping:read">
      <CategoryDetailView key={id} id={id} period={period} />
    </RequirePermission>
  );
}
