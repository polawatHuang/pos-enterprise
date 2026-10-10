import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { TrendsView } from "@/components/trends/trends-view";

export const metadata: Metadata = { title: "สินค้าเทรนด์" };

export default function TrendsPage() {
  return (
    <RequirePermission permission="scraping:read">
      <TrendsView />
    </RequirePermission>
  );
}
