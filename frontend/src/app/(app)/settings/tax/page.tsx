import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { TaxSettingsView } from "@/components/settings/tax-settings";

export const metadata: Metadata = { title: "ภาษีมูลค่าเพิ่ม" };

export default function TaxSettingsPage() {
  return (
    <RequirePermission permission="settings:manage">
      <TaxSettingsView />
    </RequirePermission>
  );
}
