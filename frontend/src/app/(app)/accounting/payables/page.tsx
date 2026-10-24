import type { Metadata } from "next";
import { Suspense } from "react";
import { RequirePermission } from "@/components/layout/page";
import { PayablesView } from "@/components/accounting/payables-view";

export const metadata: Metadata = { title: "เจ้าหนี้ & จ่ายเงินผู้ขาย" };

export default function PayablesPage() {
  return (
    <RequirePermission permission="accounting:read">
      <Suspense>
        <PayablesView />
      </Suspense>
    </RequirePermission>
  );
}
