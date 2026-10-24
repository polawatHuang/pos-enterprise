import type { Metadata } from "next";
import { Suspense } from "react";
import { RequirePermission } from "@/components/layout/page";
import { DocumentsHub } from "@/components/documents/documents-hub";
import { DOCUMENTS_READ } from "@/config/nav";

export const metadata: Metadata = { title: "ศูนย์เอกสาร" };

export default function DocumentsHubPage() {
  return (
    <RequirePermission permission={DOCUMENTS_READ}>
      <Suspense>
        <DocumentsHub />
      </Suspense>
    </RequirePermission>
  );
}
