import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { BranchesManager } from "@/components/settings/branches-manager";

export const metadata: Metadata = { title: "สาขาและคลังสินค้า" };

export default function BranchesPage() {
  return (
    <RequirePermission permission="settings:manage">
      <BranchesManager />
    </RequirePermission>
  );
}
