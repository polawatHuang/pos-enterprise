import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { ReportsView } from "@/components/accounting/reports-view";

export const metadata: Metadata = { title: "รายงานการเงิน" };

export default function ReportsPage() {
  return (
    <RequirePermission permission="accounting:read">
      <ReportsView />
    </RequirePermission>
  );
}
