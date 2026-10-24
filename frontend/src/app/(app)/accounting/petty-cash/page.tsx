import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { PettyCashView } from "@/components/accounting/petty-cash-view";

export const metadata: Metadata = { title: "เงินสดย่อย" };

export default function PettyCashPage() {
  return (
    <RequirePermission permission="accounting:read">
      <PettyCashView />
    </RequirePermission>
  );
}
