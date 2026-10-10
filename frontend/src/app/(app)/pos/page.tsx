import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { PosView } from "@/components/pos/pos-view";

export const metadata: Metadata = { title: "ขายหน้าร้าน" };

export default function PosPage() {
  return (
    <RequirePermission permission="pos:sell">
      <PosView />
    </RequirePermission>
  );
}
