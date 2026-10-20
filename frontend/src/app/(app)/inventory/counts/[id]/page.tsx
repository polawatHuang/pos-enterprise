"use client";

import { useParams } from "next/navigation";
import { RequirePermission } from "@/components/layout/page";
import { CountDetail } from "@/components/inventory/count-detail";

export default function CountDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequirePermission permission="inventory:count">
      <CountDetail key={id} id={Number(id)} />
    </RequirePermission>
  );
}
