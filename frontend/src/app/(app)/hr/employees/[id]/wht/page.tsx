"use client";

import { useParams, useSearchParams } from "next/navigation";
import { RequirePermission } from "@/components/layout/page";
import { SalaryWhtView } from "@/components/hr/hr-papers";

export default function SalaryWhtPage() {
  const { id } = useParams<{ id: string }>();
  const year = Number(useSearchParams().get("year")) || new Date().getFullYear();
  return (
    <RequirePermission permission="hr:manage">
      <SalaryWhtView key={`${id}-${year}`} employeeId={Number(id)} year={year} />
    </RequirePermission>
  );
}
