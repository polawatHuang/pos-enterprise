import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { IntegrationsStatus } from "@/components/settings/integrations-status";

export const metadata: Metadata = { title: "การเชื่อมต่อ API" };

export default function IntegrationsPage() {
  return (
    <RequirePermission permission="integrations:manage">
      <IntegrationsStatus />
    </RequirePermission>
  );
}
