import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { AccountingOverviewView } from "@/components/accounting/overview-view";

export const metadata: Metadata = { title: "ภาพรวมบัญชี" };

export default function AccountingPage() {
  return (
    <RequirePermission permission="accounting:read">
      <AccountingOverviewView />
    </RequirePermission>
  );
}
