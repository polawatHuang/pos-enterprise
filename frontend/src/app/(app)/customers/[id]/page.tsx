"use client";

import { useParams } from "next/navigation";
import { RequirePermission } from "@/components/layout/page";
import { CustomerDetail } from "@/components/customers/customer-detail";
import { CUSTOMERS_READ } from "@/config/nav";

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequirePermission permission={CUSTOMERS_READ}>
      <CustomerDetail key={id} id={Number(id)} />
    </RequirePermission>
  );
}
