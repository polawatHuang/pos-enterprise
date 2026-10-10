import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { AftersalesView } from "@/components/inbox/aftersales-view";

export const metadata: Metadata = { title: "คืนสินค้าและข้อเสนอ" };

export default function AftersalesPage() {
  return (
    <RequirePermission permission="inbox:read">
      <AftersalesView />
    </RequirePermission>
  );
}
