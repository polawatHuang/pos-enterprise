"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Product, Warehouse } from "@/lib/types";
import { formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";
import { ProductPicker } from "@/components/common/product-picker";

export type StockAction = "receive" | "adjust" | "transfer";

interface Line {
  product: Product;
  quantity: string;
  unitCost: string;
  expiryDate: string;
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["inventory"] });
    void qc.invalidateQueries({ queryKey: ["products"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
}

function WarehouseSelect({ id, value, onChange, warehouses, label }: { id: string; value: string; onChange: (v: string) => void; warehouses: Warehouse[]; label: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect id={id} className="h-10 w-full" value={value} onChange={(e) => onChange(e.target.value)}>
        {warehouses.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

/** Multi-line dialog used for receiving and transferring stock. */
export function MultiLineStockDialog({ action, warehouses, onDone }: { action: "receive" | "transfer"; warehouses: Warehouse[]; onDone: () => void }) {
  const invalidate = useInvalidate();
  const [from, setFrom] = useState(String(warehouses[0]?.id ?? ""));
  const [to, setTo] = useState(String(warehouses[1]?.id ?? warehouses[0]?.id ?? ""));
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);

  const valid =
    lines.length > 0 &&
    lines.every((l) => Number(l.quantity) > 0) &&
    (action === "transfer" || lines.every((l) => !l.product.trackExpiry || l.product.shelfLifeDays != null || l.expiryDate)) &&
    (action === "receive" || from !== to);
  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = async () => {
    setBusy(true);
    try {
      if (action === "receive") {
        await api.post("/inventory/receive", {
          warehouseId: Number(from),
          reference: reference || undefined,
          items: lines.map((l) => ({
            productId: l.product.id,
            quantity: Number(l.quantity),
            ...(l.unitCost !== "" ? { unitCost: Number(l.unitCost) } : {}),
            ...(l.expiryDate ? { expiryDate: l.expiryDate } : {}),
          })),
        });
        toast.success(`รับสินค้าเข้า ${lines.length} รายการแล้ว`);
      } else {
        // In-transit transfer: stock leaves now, the destination confirms what arrived (สั่งซื้อ & รับของ > โอนย้าย)
        const t = await api.post<{ transferNo: string }>("/purchasing/transfers", {
          fromWarehouseId: Number(from),
          toWarehouseId: Number(to),
          note: reference || undefined,
          items: lines.map((l) => ({ productId: l.product.id, quantity: Number(l.quantity) })),
        });
        toast.success(`ส่งของแล้ว ${t.transferNo} — รอคลังปลายทางกดรับ`);
      }
      invalidate();
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent
      title={action === "receive" ? "รับสินค้าเข้าคลัง" : "โอนย้ายสินค้าระหว่างคลัง"}
      description={action === "receive" ? "ใส่ต้นทุนต่อหน่วยเพื่อให้ระบบคำนวณต้นทุนถัวเฉลี่ยใหม่" : "สต๊อกต้นทางต้องพอ ไม่เช่นนั้นจะไม่โอนทั้งชุด"}
      className="max-w-2xl"
    >
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <WarehouseSelect id="from" label={action === "receive" ? "คลังที่รับเข้า" : "จากคลัง"} value={from} onChange={setFrom} warehouses={warehouses} />
          {action === "transfer" ? (
            <WarehouseSelect id="to" label="ไปคลัง" value={to} onChange={setTo} warehouses={warehouses} />
          ) : (
            <div className="space-y-2">
              <Label htmlFor="ref">เลขที่เอกสาร / ผู้ขาย</Label>
              <Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="เช่น INV-2026-001" />
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Label>เพิ่มสินค้า</Label>
          <ProductPicker
            exclude={lines.map((l) => l.product.id)}
            onPick={(p) => setLines((ls) => [...ls, { product: p, quantity: "1", unitCost: action === "receive" ? String(p.cost) : "", expiryDate: "" }])}
          />
        </div>
        {lines.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {lines.map((l, i) => (
              <li key={l.product.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <div className="min-w-40 flex-1">
                  <p className="font-medium">{l.product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {l.product.sku} · คงเหลือรวม {formatNumber(l.product.onHand)}
                  </p>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  จำนวน
                  <Input className="h-9 w-20" inputMode="decimal" value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} />
                </label>
                {action === "receive" && (
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    ต้นทุน/หน่วย
                    <Input className="h-9 w-24" inputMode="decimal" value={l.unitCost} onChange={(e) => update(i, { unitCost: e.target.value })} />
                  </label>
                )}
                {action === "receive" && l.product.trackExpiry && (
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    หมดอายุ
                    <Input
                      type="date"
                      className="h-9 w-36"
                      value={l.expiryDate}
                      onChange={(e) => update(i, { expiryDate: e.target.value })}
                      required={l.product.shelfLifeDays == null}
                      title={l.product.shelfLifeDays != null ? `เว้นว่าง = วันนี้ + ${l.product.shelfLifeDays} วัน` : "ต้องใส่วันหมดอายุ"}
                      aria-label={`วันหมดอายุ ${l.product.name}`}
                    />
                  </label>
                )}
                <button
                  onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                  className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent"
                  aria-label="นำออก"
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {action === "transfer" && from === to && <p className="text-sm text-danger">คลังต้นทางและปลายทางต้องต่างกัน</p>}
        <div className="flex justify-end">
          <Button onClick={submit} disabled={!valid || busy}>
            {busy && <Loader2 className="animate-spin" />}
            {action === "receive" ? "ยืนยันรับเข้า" : "ยืนยันโอนย้าย"}
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}

export function AdjustDialog({ warehouses, onDone }: { warehouses: Warehouse[]; onDone: () => void }) {
  const invalidate = useInvalidate();
  const [warehouseId, setWarehouseId] = useState(String(warehouses[0]?.id ?? ""));
  const [product, setProduct] = useState<Product | null>(null);
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("ตรวจนับสต๊อก");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!product) return;
    setBusy(true);
    try {
      const r = await api.post<{ before?: number; after?: number; unchanged?: boolean }>("/inventory/adjust", {
        warehouseId: Number(warehouseId),
        productId: product.id,
        countedQuantity: Number(counted),
        reason,
      });
      toast.success(r.unchanged ? "ยอดตรงกับระบบอยู่แล้ว" : `ปรับยอดจาก ${r.before} เป็น ${r.after}`);
      invalidate();
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent title="ปรับยอดสต๊อก" description="ใส่จำนวนที่นับได้จริง ระบบจะบันทึกส่วนต่างเป็นรายการปรับยอด">
      <div className="grid gap-4">
        <WarehouseSelect id="wh" label="คลัง" value={warehouseId} onChange={setWarehouseId} warehouses={warehouses} />
        <div className="space-y-2">
          <Label>สินค้า</Label>
          {product ? (
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
              <span>
                <b className="font-medium">{product.name}</b> <span className="text-muted-foreground">({product.sku})</span>
              </span>
              <button onClick={() => setProduct(null)} className="text-xs text-primary hover:underline">
                เปลี่ยน
              </button>
            </div>
          ) : (
            <ProductPicker onPick={setProduct} />
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="counted">จำนวนที่นับได้</Label>
            <Input id="counted" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reason">เหตุผล</Label>
            <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={submit} disabled={!product || counted === "" || Number(counted) < 0 || !reason.trim() || busy}>
            {busy && <Loader2 className="animate-spin" />}
            บันทึกการปรับยอด
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}
