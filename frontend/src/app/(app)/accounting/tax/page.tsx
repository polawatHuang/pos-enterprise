import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { TaxView } from "@/components/accounting/tax-view";

export const metadata: Metadata = { title: "ภาษี" };

export default function TaxPage() {
  return (
    <RequirePermission permission="accounting:read">
      <TaxView />
    </RequirePermission>
  );
}
