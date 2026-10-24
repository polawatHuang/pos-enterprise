"use client";

import { useParams } from "next/navigation";
import { RequirePermission } from "@/components/layout/page";
import { StockDocumentView } from "@/components/inventory/stock-document";

export default function StockDocumentPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequirePermission permission="inventory:read">
      <StockDocumentView key={id} id={Number(id)} />
    </RequirePermission>
  );
}
