"use client";

import { useSearchParams } from "next/navigation";
import { RequirePermission } from "@/components/layout/page";
import { DocumentEditor } from "@/components/accounting/document-editor";
import type { DocType } from "@/lib/types";

export default function NewDocumentPage() {
  const type = (useSearchParams().get("type") ?? "tax_invoice") as DocType;
  return (
    <RequirePermission permission="accounting:write">
      <DocumentEditor key={type} defaultType={type} />
    </RequirePermission>
  );
}
