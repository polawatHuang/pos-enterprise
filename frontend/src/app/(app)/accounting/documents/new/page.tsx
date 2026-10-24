"use client";

import { useSearchParams } from "next/navigation";
import { RequirePermission } from "@/components/layout/page";
import { DocumentEditor } from "@/components/accounting/document-editor";
import { BillingNoteEditor } from "@/components/accounting/billing-note-editor";
import type { DocType } from "@/lib/types";

export default function NewDocumentPage() {
  const type = (useSearchParams().get("type") ?? "tax_invoice") as DocType;
  return (
    <RequirePermission permission="accounting:write">{type === "billing_note" ? <BillingNoteEditor /> : <DocumentEditor key={type} defaultType={type} />}</RequirePermission>
  );
}
