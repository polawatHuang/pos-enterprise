"use client";

import { useParams } from "next/navigation";
import { RequirePermission } from "@/components/layout/page";
import { VoucherDetail } from "@/components/accounting/voucher-detail";

export default function VoucherPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequirePermission permission="accounting:read">
      <VoucherDetail key={id} id={Number(id)} />
    </RequirePermission>
  );
}
