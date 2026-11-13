import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { AchievementsView } from "@/components/dashboard/achievements-view";

export const metadata: Metadata = { title: "ประวัติความสำเร็จ" };

export default function AchievementsPage() {
  return (
    <RequirePermission permission="dashboard:view">
      <AchievementsView />
    </RequirePermission>
  );
}
