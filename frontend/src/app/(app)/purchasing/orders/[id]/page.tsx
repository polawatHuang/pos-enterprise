"use client";

import { useParams } from "next/navigation";
import { RequirePermission } from "@/components/layout/page";
import { PoDetail } from "@/components/purchasing/po-detail";

export default function PurchaseOrderPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequirePermission permission="inventory:read">
      <PoDetail key={id} id={Number(id)} />
    </RequirePermission>
  );
}
