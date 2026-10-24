"use client";

import { useParams, useSearchParams } from "next/navigation";
import { RequirePermission } from "@/components/layout/page";
import { PayslipView } from "@/components/hr/hr-papers";
import { HR_SELF } from "@/config/nav";

export default function PayslipPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const mine = useSearchParams().get("mine") === "1";
  return (
    <RequirePermission permission={mine ? HR_SELF : "hr:manage"}>
      <PayslipView key={itemId} itemId={Number(itemId)} mine={mine} />
    </RequirePermission>
  );
}
