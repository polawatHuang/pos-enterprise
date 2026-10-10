"use client";

import { useParams } from "next/navigation";
import { RequirePermission } from "@/components/layout/page";
import { DocumentDetail } from "@/components/accounting/document-detail";

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequirePermission permission="accounting:read">
      <DocumentDetail key={id} id={Number(id)} />
    </RequirePermission>
  );
}
