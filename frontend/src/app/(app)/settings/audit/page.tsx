import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { AuditLogViewer } from "@/components/settings/audit-log-viewer";

export const metadata: Metadata = { title: "บันทึกการใช้งาน" };

export default function AuditLogPage() {
  return (
    <RequirePermission permission="audit:read">
      <AuditLogViewer />
    </RequirePermission>
  );
}
