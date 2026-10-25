import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { DataResetView } from "@/components/settings/data-reset";
import { BusinessInfoCard, DataRequestsCard } from "@/components/settings/privacy-settings";

export const metadata: Metadata = { title: "จัดการข้อมูล" };

export default function DataPage() {
  return (
    <RequirePermission permission="settings:manage">
      <DataResetView>
        <div className="mb-6 space-y-6">
          <BusinessInfoCard />
          <DataRequestsCard />
        </div>
      </DataResetView>
    </RequirePermission>
  );
}
