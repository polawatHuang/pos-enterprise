import type { Metadata } from "next";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { RequirePermission } from "@/components/layout/page";

export const metadata: Metadata = { title: "ภาพรวมร้าน" };

export default function DashboardPage() {
  return (
    <RequirePermission permission="dashboard:view">
      <DashboardView />
    </RequirePermission>
  );
}
