"use client";

import { useState } from "react";
import { ArrowLeft, Loader2, Minus, PackageCheck, Plus, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { PosOrder } from "@/lib/types";
import { cn, formatDateTime, formatMoney, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect } from "@/components/ui/primitives";
import { r2 } from "./cart";
import { METHOD_LABEL } from "./receipt";

const REFUND_METHODS = ["cash", "transfer", "promptpay", "card", "ewallet"] as const;
type RefundMethod = (typeof REFUND_METHODS)[number];
const REASONS = ["สินค้าชำรุด/เสีย", "ลูกค้าเปลี่ยนใจ", "ได้สินค้าผิด", "หมดอายุ"];

export interface ReturnResult {
  returnNo: string;
  refund: number;
  fullyReturned: boolean;
  order: PosOrder;
}

/**
 * Pick lines and quantities to take back from a completed bill. The preview mirrors the backend:
 * each line refunds its share of the bill total (bill-level discounts and points spread pro rata).
 */
export function ReturnView({ order, onBack, onDone }: { order: PosOrder; onBack: () => void; onDone: (r: ReturnResult) => void }) {
  const firstMethod = order.payments.find((p) => p.amount > 0)?.method;
  const [qty, setQty] = useState<Record<number, number>>({});
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<RefundMethod>(REFUND_METHODS.includes(firstMethod as RefundMethod) ? (firstMethod as RefundMethod) : "cash");
  const [restock, setRestock] = useState(true);
  const [busy, setBusy] = useState(false);

  const ratio = order.subtotal ? order.total / order.subtotal : 0;
  const lines = order.items.map((i) => ({ ...i, left: r2(i.quantity - i.returnedQty) }));
  const picked = lines.filter((l) => (qty[l.id] ?? 0) > 0);
  const remaining = r2(order.total - order.refundedAmount);
  const allPicked = lines.every((l) => l.left <= 0 || (qty[l.id] ?? 0) >= l.left);
  const preview = allPicked ? remaining : Math.min(remaining, r2(picked.reduce((s, l) => s + (l.lineTotal / l.quantity) * qty[l.id] * ratio, 0)));

  const set = (id: number, v: number, max: number) => setQty((q) => ({ ...q, [id]: Math.min(Math.max(r2(v), 0), max) }));

  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post<ReturnResult>(`/pos/orders/${order.id}/returns`, {
        items: picked.map((l) => ({ orderItemId: l.id, quantity: qty[l.id] })),
        reason: reason.trim(),
        refundMethod: method,
        restock,
      });
      toast.success(`คืนสินค้าแล้ว ${r.returnNo} · คืนเงิน ${formatMoney(r.refund)}`);
      onDone(r);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "คืนสินค้าไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-w-0 gap-4">
      <button onClick={onBack} className="-mt-2 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> กลับไปรายการบิล
      </button>
      <div className="rounded-xl bg-muted/40 p-3 text-sm">
        <p className="font-medium">
          {order.orderNo} · {formatMoney(order.total)}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatDateTime(order.orderedAt)}
          {order.customerName ? ` · ${order.customerName}` : ""}
          {order.refundedAmount > 0 ? ` · คืนไปแล้ว ${formatMoney(order.refundedAmount)}` : ""}
        </p>
      </div>

      <ul className="divide-y divide-border rounded-xl border border-border">
        {lines.map((l) => {
          const q = qty[l.id] ?? 0;
          const done = l.left <= 0;
          return (
            <li key={l.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 p-3", done && "opacity-50")}>
              <div className="min-w-0 flex-1 basis-40">
                <p className="truncate text-sm font-medium">{l.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatNumber(l.quantity)} {l.unitName ?? ""} × {formatMoney(l.lineTotal / l.quantity)}
                  {l.returnedQty > 0 && ` · คืนแล้ว ${formatNumber(l.returnedQty)}`}
                </p>
              </div>
              {done ? (
                <span className="text-xs text-muted-foreground">คืนครบแล้ว</span>
              ) : (
                <div className="ml-auto flex items-center gap-1">
                  <Button variant="outline" size="icon" className="size-9" aria-label="ลด" onClick={() => set(l.id, q - 1, l.left)} disabled={q <= 0}>
                    <Minus />
                  </Button>
                  <Input
                    inputMode="decimal"
                    value={q || ""}
                    placeholder="0"
                    onChange={(e) => set(l.id, Number(e.target.value) || 0, l.left)}
                    className="h-9 w-14 text-center tabular-nums"
                    aria-label={`จำนวนคืน ${l.name}`}
                  />
                  <Button variant="outline" size="icon" className="size-9" aria-label="เพิ่ม" onClick={() => set(l.id, q + 1, l.left)} disabled={q >= l.left}>
                    <Plus />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-9 px-2 text-xs" onClick={() => set(l.id, l.left, l.left)}>
                    ทั้งหมด
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="space-y-1.5">
        <Label htmlFor="rt-reason">เหตุผลที่คืน</Label>
        <div className="flex flex-wrap gap-1.5">
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={cn("rounded-full border px-3 py-1 text-xs", reason === r ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}
            >
              {r}
            </button>
          ))}
        </div>
        <Input id="rt-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="หรือพิมพ์เหตุผลเอง" maxLength={200} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="rt-method">คืนเงินทาง</Label>
          <NativeSelect id="rt-method" value={method} onChange={(e) => setMethod(e.target.value as RefundMethod)} className="h-10 w-full">
            {REFUND_METHODS.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
                {m === "cash" ? " (จ่ายจากลิ้นชักกะนี้)" : ""}
              </option>
            ))}
          </NativeSelect>
        </div>
        <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-border p-3 text-sm">
          <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="mt-0.5 size-4 accent-primary" />
          <span>
            <span className="flex items-center gap-1 font-medium">
              <PackageCheck className="size-4" /> นำกลับเข้าสต๊อก
            </span>
            <span className="text-xs text-muted-foreground">ไม่ติ๊กถ้าสินค้าเสีย/ขายต่อไม่ได้</span>
          </span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/30 p-3">
        <div className="mr-auto">
          <p className="text-xs text-muted-foreground">ยอดคืนเงิน</p>
          <p className="text-2xl font-bold tabular-nums" data-testid="return-total">
            {formatMoney(picked.length ? preview : 0)}
          </p>
        </div>
        <Button size="lg" variant="danger" disabled={!picked.length || !reason.trim() || busy} onClick={() => void submit()}>
          {busy ? <Loader2 className="animate-spin" /> : <Undo2 />} ยืนยันคืนสินค้า
        </Button>
      </div>
    </div>
  );
}
