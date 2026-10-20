import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { CountsView } from "@/components/inventory/counts-view";

export const metadata: Metadata = { title: "ตรวจนับสต๊อก" };

export default function CountsPage() {
  return (
    <RequirePermission permission="inventory:count">
      <CountsView />
    </RequirePermission>
  );
}
