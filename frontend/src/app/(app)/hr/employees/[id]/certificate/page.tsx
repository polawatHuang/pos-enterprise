"use client";

import { useParams, useSearchParams } from "next/navigation";
import { RequirePermission } from "@/components/layout/page";
import { CertificateView } from "@/components/hr/hr-papers";

export default function CertificatePage() {
  const { id } = useParams<{ id: string }>();
  const kind = useSearchParams().get("kind") === "employment" ? "employment" : "salary";
  return (
    <RequirePermission permission="hr:manage">
      <CertificateView key={`${id}-${kind}`} employeeId={Number(id)} kind={kind} />
    </RequirePermission>
  );
}
