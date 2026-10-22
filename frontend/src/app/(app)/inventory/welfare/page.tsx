import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { WelfareView } from "@/components/inventory/welfare-view";
import { WELFARE_ACCESS } from "@/config/nav";

export const metadata: Metadata = { title: "เบิกสวัสดิการพนักงาน" };

export default function WelfarePage() {
  return (
    <RequirePermission permission={WELFARE_ACCESS}>
      <WelfareView />
    </RequirePermission>
  );
}
