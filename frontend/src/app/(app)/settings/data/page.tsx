import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { DataResetView } from "@/components/settings/data-reset";

export const metadata: Metadata = { title: "จัดการข้อมูล" };

export default function DataPage() {
  return (
    <RequirePermission permission="settings:manage">
      <DataResetView />
    </RequirePermission>
  );
}
