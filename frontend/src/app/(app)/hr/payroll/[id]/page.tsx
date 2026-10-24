"use client";

import { useParams } from "next/navigation";
import { RequirePermission } from "@/components/layout/page";
import { PayrollRunView } from "@/components/hr/payroll-run";

export default function PayrollRunPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequirePermission permission="hr:manage">
      <PayrollRunView key={id} id={Number(id)} />
    </RequirePermission>
  );
}
