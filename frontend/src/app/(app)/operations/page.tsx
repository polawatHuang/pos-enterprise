import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { OperationsView } from "@/components/operations/operations-view";

export const metadata: Metadata = { title: "งานร้านวันนี้" };

export default function OperationsPage() {
  return (
    <RequirePermission permission={["operations:work", "operations:manage"]}>
      <OperationsView />
    </RequirePermission>
  );
}
