import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { InboxView } from "@/components/inbox/inbox-view";

export const metadata: Metadata = { title: "แชตลูกค้า" };

export default function InboxPage() {
  return (
    <RequirePermission permission="inbox:read">
      <InboxView />
    </RequirePermission>
  );
}
