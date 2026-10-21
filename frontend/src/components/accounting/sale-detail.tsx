"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PosOrder } from "@/lib/types";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/utils";
import { useTaxSettings } from "@/lib/tax";
import { Badge, Skeleton } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";
import { ErrorNote } from "@/components/dashboard/widgets";
import { METHOD_LABEL } from "@/components/pos/receipt";

const STATUS: Record<string, { label: string; tone: "success" | "neutral" | "danger" }> = {
  paid: { label: "ชำระแล้ว", tone: "success" },
  completed: { label: "สำเร็จ", tone: "success" },
  packed: { label: "แพ็กแล้ว", tone: "neutral" },
  shipped: { label: "จัดส่งแล้ว", tone: "neutral" },
  cancelled: { label: "ยกเลิก", tone: "danger" },
  refunded: { label: "คืนเงินแล้ว", tone: "danger" },
};

/**
 * One sale from รายรับ-รายจ่าย: what the customer bought and how they paid. Render inside a <Dialog>.
 * `path` loads the bill from another endpoint with the same shape (e.g. the customer page, for users without accounting access).
 */
export function SaleDetailDialog({ id, path }: { id: number; path?: string }) {
  const { tax } = useTaxSettings();
  const url = path ?? `/accounting/transactions/sales/${id}`;
  const order = useQuery({
    queryKey: path ? ["sale", url] : ["accounting", "sale", id],
    queryFn: () => api.get<PosOrder>(url),
  });
  const o = order.data;

  return (
    <DialogContent title={o ? `ออร์เดอร์ ${o.orderNo}` : "รายละเอียดออร์เดอร์"} description={o ? formatDateTime(o.orderedAt) : undefined} className="max-w-xl">
      {order.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : order.isError || !o ? (
        <ErrorNote onRetry={() => order.refetch()} />
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={STATUS[o.status]?.tone ?? "neutral"}>{STATUS[o.status]?.label ?? o.status}</Badge>
            {o.branchName && <Badge>{o.branchName}</Badge>}
            {o.cashierName && <Badge>พนักงาน {o.cashierName}</Badge>}
            {o.customerName && <Badge tone="primary">ลูกค้า {o.customerName}</Badge>}
          </div>

          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 font-medium">สินค้า</th>
                <th className="py-2 text-right font-medium">จำนวน</th>
                <th className="py-2 text-right font-medium">ราคา</th>
                <th className="py-2 text-right font-medium">รวม</th>
              </tr>
            </thead>
            <tbody>
              {o.items.map((it, i) => (
                <tr key={i} className="border-b border-border/60 align-top">
                  <td className="py-2 pr-2">
                    {it.name}
                    {it.unitName && <span className="text-muted-foreground"> ({it.unitName})</span>}
                    {it.discount > 0 && <span className="block text-xs text-danger">ส่วนลด −{formatMoney(it.discount)}</span>}
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatNumber(it.quantity)}</td>
                  <td className="py-2 text-right tabular-nums">{formatMoney(it.unitPrice)}</td>
                  <td className="py-2 text-right font-medium tabular-nums">{formatMoney(it.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="ml-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1">
            <dt className="text-muted-foreground">รวม</dt>
            <dd className="text-right tabular-nums">{formatMoney(o.subtotal)}</dd>
            {o.discount > 0 && (
              <>
                <dt className="text-muted-foreground">ส่วนลดท้ายบิล</dt>
                <dd className="text-right tabular-nums text-danger">−{formatMoney(o.discount)}</dd>
              </>
            )}
            {o.vatAmount > 0 && (
              <>
                <dt className="text-muted-foreground">VAT {tax.vatRate}% (รวมในราคา)</dt>
                <dd className="text-right tabular-nums">{formatMoney(o.vatAmount)}</dd>
              </>
            )}
            <dt className="font-semibold">ยอดสุทธิ</dt>
            <dd className="text-right font-semibold tabular-nums">{formatMoney(o.total)}</dd>
          </dl>

          {o.payments.length > 0 && (
            <div className="rounded-lg bg-muted px-3 py-2.5">
              <p className="mb-1 text-xs font-medium text-muted-foreground">ชำระเงิน</p>
              {o.payments.map((p, i) => (
                <p key={i} className="flex justify-between tabular-nums">
                  <span>
                    {METHOD_LABEL[p.method] ?? p.method}
                    {p.reference && <span className="text-xs text-muted-foreground"> · {p.reference}</span>}
                  </span>
                  <span>{formatMoney(p.amount)}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </DialogContent>
  );
}
