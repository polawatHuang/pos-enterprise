"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Loader2, Printer, ScanBarcode, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { PosSettings, PurchaseOrder } from "@/lib/types";
import { cn, formatMoney, formatNumber, formatThaiDate } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, Skeleton } from "@/components/ui/primitives";
import { beep } from "@/components/pos/sound";
import { PO_STATUS } from "./labels";

/** Purchase order: printable A4 for the supplier, and a scan-to-receive panel when goods arrive. */
export function PoDetail({ id }: { id: number }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const key = ["purchasing", "orders", id];
  const po = useQuery({ queryKey: key, queryFn: () => api.get<PurchaseOrder>(`/purchasing/orders/${id}`) });
  const org = useQuery({ queryKey: ["pos", "settings"], queryFn: () => api.get<PosSettings>("/pos/settings"), staleTime: 5 * 60_000 });
  const [recv, setRecv] = useState<Record<number, string>>({});
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  if (po.isPending) return <Skeleton className="h-[60vh] w-full rounded-xl" />;
  const p = po.data;
  if (!p) return <p className="text-sm text-muted-foreground">ไม่พบใบสั่งซื้อ</p>;
  const items = p.items ?? [];
  const receiving = (p.status === "ordered" || p.status === "partial") && can("purchasing:write");
  const remaining = (i: (typeof items)[number]) => Math.max(i.quantity - i.receivedQty, 0);
  const val = (i: (typeof items)[number]) => (recv[i.productId] === undefined ? null : Number(recv[i.productId]) || 0);

  const scan = () => {
    const c = code.trim();
    if (!c) return;
    const line = items.find((i) => i.barcode === c || i.sku === c);
    setCode("");
    if (!line) {
      beep("error");
      toast.error(`ไม่มีรหัส ${c} ในใบสั่งซื้อนี้`);
      return;
    }
    beep("ok");
    setRecv((r) => ({ ...r, [line.productId]: String((Number(r[line.productId]) || 0) + 1) }));
  };

  const act = async (what: "send" | "cancel" | "receive", close = false) => {
    setBusy(what);
    try {
      if (what === "receive") {
        const list = items.map((i) => ({ productId: i.productId, quantity: val(i) ?? 0 })).filter((x) => x.quantity > 0);
        await api.post(`/purchasing/orders/${id}/receive`, { items: list.length ? list : [{ productId: items[0].productId, quantity: 0 }], close });
        toast.success(close ? "รับของและปิดใบสั่งซื้อแล้ว" : "รับของเข้าสต๊อกแล้ว");
        setRecv({});
      } else {
        if (what === "cancel" && !window.confirm("ยกเลิกใบสั่งซื้อนี้?")) return;
        await api.post(`/purchasing/orders/${id}/${what}`);
        toast.success(what === "send" ? "ส่งใบสั่งซื้อแล้ว" : "ยกเลิกแล้ว");
      }
      void qc.invalidateQueries({ queryKey: ["purchasing"] });
      void qc.invalidateQueries({ queryKey: ["inventory"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };

  const fillAll = () => setRecv(Object.fromEntries(items.map((i) => [i.productId, String(remaining(i))])));
  const shown = onlyDiff ? items.filter((i) => (val(i) ?? 0) !== remaining(i)) : items;

  return (
    <div className="mx-auto max-w-5xl pb-24">
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/purchasing?tab=orders" aria-label="กลับ">
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="mr-auto flex items-center gap-2 text-xl font-semibold">
          {p.poNo} <Badge tone={PO_STATUS[p.status].tone}>{PO_STATUS[p.status].label}</Badge>
        </h1>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer /> พิมพ์
        </Button>
        {p.status === "draft" && can("purchasing:write") && (
          <Button onClick={() => void act("send")} disabled={busy !== null}>
            <Send /> ส่งใบสั่งซื้อ
          </Button>
        )}
        {(p.status === "draft" || p.status === "ordered") && can("purchasing:write") && (
          <Button variant="ghost" className="text-danger" onClick={() => void act("cancel")} disabled={busy !== null}>
            <XCircle /> ยกเลิก
          </Button>
        )}
      </div>

      {receiving && (
        <Card className="mb-4 p-4 print:hidden">
          <p className="mb-2 font-medium">รับของ</p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              scan();
            }}
          >
            <div className="relative flex-1">
              <ScanBarcode className="absolute left-3 top-1/2 size-5 -translate-y-1/2 text-primary" />
              <Input ref={scanRef} value={code} onChange={(e) => setCode(e.target.value)} placeholder="สแกนกล่อง/ชิ้นที่มาถึง (+1 ต่อการสแกน)" className="h-11 pl-10" aria-label="สแกนรับของ" />
            </div>
            <button type="submit" className="sr-only">
              รับ
            </button>
            <Button type="button" variant="outline" className="h-11" onClick={fillAll}>
              มาครบตามสั่ง
            </Button>
          </form>
          <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> แสดงเฉพาะรายการที่ยังไม่ตรง
          </label>
        </Card>
      )}

      {/* Printable purchase order */}
      <Card className="p-6 print:border-0 print:p-0 print:shadow-none" id="po-paper">
        <div className="flex flex-wrap justify-between gap-4">
          <div>
            <p className="text-lg font-bold">{org.data?.org.legalName || org.data?.org.name}</p>
            {org.data?.org.address && <p className="text-sm text-muted-foreground">{org.data.org.address}</p>}
            {org.data?.org.taxId && <p className="text-sm text-muted-foreground">เลขผู้เสียภาษี {org.data.org.taxId}</p>}
          </div>
          <div className="text-right">
            <p className="text-xl font-bold">ใบสั่งซื้อ</p>
            <p className="text-sm">เลขที่ {p.poNo}</p>
            <p className="text-sm text-muted-foreground">วันที่ {formatThaiDate(p.orderDate)}</p>
            {p.expectedDate && <p className="text-sm text-muted-foreground">กำหนดส่ง {formatThaiDate(p.expectedDate)}</p>}
          </div>
        </div>
        <div className="mt-4 grid gap-1 rounded-lg bg-muted/60 p-3 text-sm sm:grid-cols-2">
          <p>
            ผู้ขาย: <span className="font-medium">{p.supplierName ?? "–"}</span> {p.supplierPhone && `· โทร ${p.supplierPhone}`}
          </p>
          <p>
            ส่งที่: <span className="font-medium">{p.warehouseName}</span>
          </p>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-2 font-medium">#</th>
                <th className="py-2 pr-2 font-medium">สินค้า</th>
                <th className="py-2 pr-2 text-right font-medium">จำนวน</th>
                <th className="py-2 pr-2 text-right font-medium">ราคา/หน่วย</th>
                <th className="py-2 pr-2 text-right font-medium">รวม</th>
                {(receiving || p.status === "received" || p.status === "partial") && <th className="py-2 pr-2 text-right font-medium print:hidden">รับแล้ว</th>}
                {receiving && <th className="py-2 text-right font-medium print:hidden">รับรอบนี้</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((i, idx) => {
                const v = val(i);
                const left = remaining(i);
                return (
                  <tr key={i.productId} className="border-b border-border last:border-0">
                    <td className="py-2 pr-2 text-muted-foreground">{idx + 1}</td>
                    <td className="py-2 pr-2">
                      <p className="font-medium">{i.name}</p>
                      <p className="text-xs text-muted-foreground">{i.barcode ?? i.sku}</p>
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">
                      {formatNumber(i.quantity)} {i.unit}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{formatMoney(i.unitCost)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{formatMoney(i.lineTotal)}</td>
                    {(receiving || p.status === "received" || p.status === "partial") && (
                      <td className={cn("py-2 pr-2 text-right tabular-nums print:hidden", i.receivedQty >= i.quantity ? "text-success" : "text-muted-foreground")}>
                        {i.receivedQty >= i.quantity ? <CheckCircle2 className="ml-auto size-4" /> : formatNumber(i.receivedQty)}
                      </td>
                    )}
                    {receiving && (
                      <td className="py-2 text-right print:hidden">
                        <Input
                          value={recv[i.productId] ?? ""}
                          onChange={(e) => setRecv((r) => ({ ...r, [i.productId]: e.target.value.replace(/[^\d.]/g, "") }))}
                          placeholder={left ? String(left) : "0"}
                          inputMode="decimal"
                          className={cn("ml-auto h-8 w-20 text-right", v !== null && v !== left && "border-warning", v !== null && v > left && "border-danger")}
                          aria-label={`รับ ${i.name}`}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex justify-end">
          <p className="text-lg">
            รวมทั้งสิ้น <span className="font-bold tabular-nums">{formatMoney(p.total)}</span>
          </p>
        </div>
        {p.note && <p className="mt-2 whitespace-pre-line text-xs text-muted-foreground">หมายเหตุ: {p.note}</p>}
        <div className="mt-10 hidden grid-cols-2 gap-10 text-center text-sm print:grid">
          <p className="border-t border-black pt-1">ผู้สั่งซื้อ</p>
          <p className="border-t border-black pt-1">ผู้อนุมัติ</p>
        </div>
      </Card>

      {receiving && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 p-3 backdrop-blur print:hidden lg:left-auto lg:right-6 lg:bottom-6 lg:rounded-2xl lg:border lg:shadow-lg">
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => void act("receive", true)} disabled={busy !== null}>
              รับและปิดใบ (ของไม่มาแล้ว)
            </Button>
            <Button onClick={() => void act("receive")} disabled={busy !== null || !items.some((i) => (val(i) ?? 0) > 0)}>
              {busy === "receive" && <Loader2 className="animate-spin" />}
              ยืนยันรับเข้าสต๊อก
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
