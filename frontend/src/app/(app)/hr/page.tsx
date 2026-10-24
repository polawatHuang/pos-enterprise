import type { Metadata } from "next";
import { Suspense } from "react";
import { RequirePermission } from "@/components/layout/page";
import { HrView } from "@/components/hr/hr-view";

export const metadata: Metadata = { title: "พนักงาน & เงินเดือน" };

export default function HrPage() {
  return (
    <RequirePermission permission="hr:manage">
      <Suspense>
        <HrView />
      </Suspense>
    </RequirePermission>
  );
}
