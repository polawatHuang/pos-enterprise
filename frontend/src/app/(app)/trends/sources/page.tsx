import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { SourcesView } from "@/components/trends/sources-view";

export const metadata: Metadata = { title: "แหล่งข้อมูลสินค้าเทรนด์" };

export default function SourcesPage() {
  return (
    <RequirePermission permission="scraping:read">
      <SourcesView />
    </RequirePermission>
  );
}
