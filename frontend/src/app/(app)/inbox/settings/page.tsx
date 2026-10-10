import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { InboxSettingsView } from "@/components/inbox/settings-view";

export const metadata: Metadata = { title: "ตั้งค่า AI แชต" };

export default function InboxSettingsPage() {
  return (
    <RequirePermission permission="inbox:read">
      <InboxSettingsView />
    </RequirePermission>
  );
}
