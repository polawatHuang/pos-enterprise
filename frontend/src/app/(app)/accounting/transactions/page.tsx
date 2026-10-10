import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { TransactionsView } from "@/components/accounting/transactions-view";

export const metadata: Metadata = { title: "รายรับ-รายจ่าย" };

export default function TransactionsPage() {
  return (
    <RequirePermission permission="accounting:read">
      <TransactionsView />
    </RequirePermission>
  );
}
