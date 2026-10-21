"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PurchaseOrder } from "@/lib/types";
import { formatMoney, formatThaiDate } from "@/lib/utils";
import { Badge, Skeleton } from "@/components/ui/primitives";
import { ErrorNote } from "@/components/dashboard/widgets";
import { PO_STATUS } from "./labels";

export function OrdersList() {
  const orders = useQuery({ queryKey: ["purchasing", "orders"], queryFn: () => api.get<PurchaseOrder[]>("/purchasing/orders") });
  if (orders.isPending) return <Skeleton className="m-4 h-48" />;
  if (orders.isError) return <ErrorNote onRetry={() => orders.refetch()} error={orders.error} />;
  if (!orders.data?.length) return <p className="p-12 text-center text-sm text-muted-foreground">ยังไม่มีใบสั่งซื้อ — สร้างจากแท็บ &quot;สั่งของ&quot;</p>;
  return (
    <div className="overflow-x-auto">
      <table className="table-cards w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-4 py-3 font-medium">เลขที่</th>
            <th className="px-4 py-3 font-medium">ผู้ขาย</th>
            <th className="px-4 py-3 font-medium">เข้าคลัง</th>
            <th className="px-4 py-3 font-medium">ส่งของ</th>
            <th className="px-4 py-3 font-medium">รับแล้ว</th>
            <th className="px-4 py-3 text-right font-medium">มูลค่า</th>
            <th className="px-4 py-3 font-medium">สถานะ</th>
          </tr>
        </thead>
        <tbody>
          {orders.data.map((po) => (
            <tr key={po.id} className="border-b border-border last:border-0 hover:bg-muted/40">
              <td className="px-4 py-3">
                <Link href={`/purchasing/orders/${po.id}`} className="font-medium text-primary hover:underline">
                  {po.poNo}
                </Link>
                {po.source === "suggestion" && <span className="ml-1.5 text-[10px] text-muted-foreground">จากคำแนะนำ</span>}
              </td>
              <td data-label="ผู้ขาย" className="px-4 py-3">{po.supplierName ?? "–"}</td>
              <td data-label="เข้าคลัง" className="px-4 py-3">{po.warehouseName}</td>
              <td data-label="ส่งของ" className="px-4 py-3 text-muted-foreground">{po.expectedDate ? formatThaiDate(po.expectedDate) : "–"}</td>
              <td data-label="รับแล้ว" className="px-4 py-3">
                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-success" style={{ width: `${po.receivedPct ?? 0}%` }} />
                </div>
              </td>
              <td data-label="มูลค่า" className="px-4 py-3 text-right tabular-nums">{formatMoney(po.total)}</td>
              <td data-label="สถานะ" className="px-4 py-3">
                <Badge tone={PO_STATUS[po.status].tone}>{PO_STATUS[po.status].label}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
