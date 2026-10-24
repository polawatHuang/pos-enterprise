import type { Metadata } from "next";
import { Suspense } from "react";
import { RequirePermission } from "@/components/layout/page";
import { TrendsView } from "@/components/trends/trends-view";

export const metadata: Metadata = { title: "สินค้าเทรนด์ทั้งหมด" };

export default function TrendProductsPage() {
  return (
    <RequirePermission permission="scraping:read">
      <Suspense>
        <TrendsView />
      </Suspense>
    </RequirePermission>
  );
}
