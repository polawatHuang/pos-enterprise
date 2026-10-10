import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { DocumentsView } from "@/components/accounting/documents-view";

export const metadata: Metadata = { title: "เอกสาร" };

export default function DocumentsPage() {
  return (
    <RequirePermission permission="accounting:read">
      <DocumentsView />
    </RequirePermission>
  );
}
