import type { Metadata } from "next";
import { PageHeader, RequirePermission } from "@/components/layout/page";
import { Card } from "@/components/ui/primitives";
import { SuppliersList } from "@/components/purchasing/suppliers";

export const metadata: Metadata = { title: "ผู้ขาย" };

export default function SuppliersPage() {
  return (
    <RequirePermission permission="inventory:read">
      <PageHeader title="ผู้ขาย" description="ผู้ขายที่ใช้จัดใบสั่งซื้อ — ระยะเวลาส่งของ (lead time) ใช้คำนวณยอดแนะนำสั่งซื้อ" />
      <Card>
        <SuppliersList />
      </Card>
    </RequirePermission>
  );
}
