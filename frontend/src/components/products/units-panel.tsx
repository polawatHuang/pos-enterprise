"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Package, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { ProductUnit } from "@/lib/types";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@/components/ui/primitives";

interface Row {
  name: string;
  factor: string;
  barcode: string;
  price: string;
}

const toRow = (u: ProductUnit): Row => ({ name: u.name, factor: String(u.factor), barcode: u.barcode ?? "", price: u.price == null ? "" : String(u.price) });

/** Pack / carton units: each can carry its own barcode and price, stock is always kept in base units. */
export function UnitsPanel({ productId, baseUnit, basePrice, writable }: { productId: number; baseUnit: string; basePrice: number; writable: boolean }) {
  const qc = useQueryClient();
  const key = ["products", productId, "units"];
  const units = useQuery({ queryKey: key, queryFn: () => api.get<ProductUnit[]>(`/products/${productId}/units`) });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const editing = rows ?? units.data?.map(toRow) ?? [];
  const set = (i: number, patch: Partial<Row>) => setRows(editing.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    setBusy(true);
    try {
      const saved = await api.put<ProductUnit[]>(`/products/${productId}/units`, {
        units: editing
          .filter((r) => r.name.trim() && Number(r.factor) > 1)
          .map((r) => ({ name: r.name.trim(), factor: Number(r.factor), barcode: r.barcode.trim() || null, price: r.price === "" ? null : Number(r.price) })),
      });
      qc.setQueryData(key, saved);
      setRows(null);
      void qc.invalidateQueries({ queryKey: ["pos", "catalog"] });
      toast.success("บันทึกหน่วยขายแล้ว");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="size-4" /> หน่วยขาย (แพ็ก / ลัง)
        </CardTitle>
        <CardDescription>สแกนบาร์โค้ดแพ็กหรือลังที่หน้าร้าน ระบบตัดสต๊อกเป็น{baseUnit}ให้อัตโนมัติ</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {units.isPending && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
        {editing.map((r, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-border p-2 sm:grid-cols-[1fr_110px_1.3fr_120px_auto]">
            <Input value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="ชื่อหน่วย เช่น แพ็ก" disabled={!writable} aria-label="ชื่อหน่วย" />
            <Input value={r.factor} onChange={(e) => set(i, { factor: e.target.value })} inputMode="decimal" placeholder={`กี่${baseUnit}`} disabled={!writable} aria-label="จำนวนต่อหน่วย" />
            <Input value={r.barcode} onChange={(e) => set(i, { barcode: e.target.value })} placeholder="บาร์โค้ดของหน่วยนี้" disabled={!writable} aria-label="บาร์โค้ดหน่วย" />
            <Input
              value={r.price}
              onChange={(e) => set(i, { price: e.target.value })}
              inputMode="decimal"
              placeholder={formatMoney(basePrice * (Number(r.factor) || 1))}
              disabled={!writable}
              aria-label="ราคาหน่วย"
            />
            {writable && (
              <Button variant="ghost" size="icon" onClick={() => setRows(editing.filter((_, j) => j !== i))} aria-label="ลบหน่วย">
                <Trash2 className="text-danger" />
              </Button>
            )}
          </div>
        ))}
        {!units.isPending && editing.length === 0 && <p className="text-sm text-muted-foreground">ขายเป็น{baseUnit}อย่างเดียว</p>}
        {writable && (
          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setRows([...editing, { name: "", factor: "", barcode: "", price: "" }])} disabled={editing.length >= 10}>
              <Plus /> เพิ่มหน่วย
            </Button>
            {rows && (
              <Button size="sm" onClick={save} disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                บันทึกหน่วยขาย
              </Button>
            )}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">ราคาว่าง = ราคาต่อ{baseUnit} × จำนวน</p>
      </CardContent>
    </Card>
  );
}
