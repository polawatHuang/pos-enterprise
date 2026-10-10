import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { InventoryView } from "@/components/inventory/inventory-view";

export const metadata: Metadata = { title: "สต๊อกสินค้า" };

export default function InventoryPage() {
  return (
    <RequirePermission permission="inventory:read">
      <InventoryView />
    </RequirePermission>
  );
}
