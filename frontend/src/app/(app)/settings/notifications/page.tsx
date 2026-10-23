import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { LineNotificationsView } from "@/components/settings/line-notifications";

export const metadata: Metadata = { title: "แจ้งเตือน LINE" };

export default function LineNotificationsPage() {
  return (
    <RequirePermission permission="settings:manage">
      <LineNotificationsView />
    </RequirePermission>
  );
}
