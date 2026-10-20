import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { PurchasingView } from "@/components/purchasing/purchasing-view";

export const metadata: Metadata = { title: "สั่งซื้อ & รับของ" };

export default function PurchasingPage() {
  return (
    <RequirePermission permission="inventory:read">
      <PurchasingView />
    </RequirePermission>
  );
}
