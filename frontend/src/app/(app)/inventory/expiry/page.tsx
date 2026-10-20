import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { ExpiryView } from "@/components/inventory/expiry-view";

export const metadata: Metadata = { title: "ใกล้หมดอายุ" };

export default function ExpiryPage() {
  return (
    <RequirePermission permission="inventory:read">
      <ExpiryView />
    </RequirePermission>
  );
}
