import type { Metadata } from "next";
import { Suspense } from "react";
import { RequirePermission } from "@/components/layout/page";
import { ReportsView } from "@/components/accounting/reports-view";

export const metadata: Metadata = { title: "รายงานการเงิน" };

export default function ReportsPage() {
  return (
    <RequirePermission permission="accounting:read">
      <Suspense>
        <ReportsView />
      </Suspense>
    </RequirePermission>
  );
}
