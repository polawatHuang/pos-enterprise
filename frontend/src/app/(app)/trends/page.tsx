import type { Metadata } from "next";
import { Suspense } from "react";
import { RequirePermission } from "@/components/layout/page";
import { CategoryReportView } from "@/components/trends/category-report";

export const metadata: Metadata = { title: "สินค้าเทรนด์" };

export default function TrendsPage() {
  return (
    <RequirePermission permission="scraping:read">
      <Suspense>
        <CategoryReportView />
      </Suspense>
    </RequirePermission>
  );
}
