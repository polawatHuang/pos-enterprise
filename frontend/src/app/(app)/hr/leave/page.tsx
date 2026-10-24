import type { Metadata } from "next";
import { Suspense } from "react";
import { RequirePermission } from "@/components/layout/page";
import { LeaveView } from "@/components/hr/leave-view";
import { HR_SELF } from "@/config/nav";

export const metadata: Metadata = { title: "ใบลา & สลิปเงินเดือน" };

export default function LeavePage() {
  return (
    <RequirePermission permission={HR_SELF}>
      <Suspense>
        <LeaveView />
      </Suspense>
    </RequirePermission>
  );
}
