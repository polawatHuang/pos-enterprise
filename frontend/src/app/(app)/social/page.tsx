import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { CalendarView } from "@/components/social/calendar-view";

export const metadata: Metadata = { title: "ตั้งเวลาโพสต์" };

export default function SocialPage() {
  return (
    <RequirePermission permission="social:read">
      <CalendarView />
    </RequirePermission>
  );
}
