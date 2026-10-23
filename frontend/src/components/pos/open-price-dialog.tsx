"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { CatalogItem } from "@/lib/types";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";

/**
 * Sell something by typing its price: photocopies, a fee, a thing whose barcode will not scan.
 * `item` set = that open-price item was scanned or tapped; otherwise the cashier picks one.
 */
export function OpenPriceDialog({ item, onAdd }: { item: CatalogItem | null; onAdd: (item: CatalogItem, price: number, name: string, qty: number) => void }) {
  const list = useQuery({
    queryKey: ["pos", "catalog", "open-price"],
    queryFn: () => api.get<CatalogItem[]>("/pos/catalog", { openPrice: "1", limit: 50 }),
    enabled: !item,
  });
  const choices = item ? [item] : (list.data ?? []);
  const [pickedId, setPickedId] = useState<number | null>(item?.id ?? null);
  const picked = choices.find((c) => c.id === pickedId) ?? choices[0] ?? null;
  const [price, setPrice] = useState("");
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const p = Number(price);
  const q = Number(qty);
  const ok = picked && p > 0 && q > 0;

  return (
    <DialogContent title="ขายแบบระบุราคาเอง" description="ใช้กับของที่ไม่มีบาร์โค้ด หรือค่าบริการ เช่น ถ่ายเอกสาร — ไม่ตัดสต๊อก" className="max-w-md">
      {!item && list.isPending ? (
        <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
      ) : !picked ? (
        <p className="rounded-xl bg-muted p-4 text-sm">
          ยังไม่มีสินค้าแบบระบุราคา — ผู้จัดการเพิ่มได้ที่เมนู <b>สินค้า → เพิ่มสินค้า</b> แล้วเลือก <b>ระบุราคาตอนขาย</b> (เช่น &quot;สินค้าทั่วไป&quot;, &quot;ค่าถ่ายเอกสาร&quot;)
        </p>
      ) : (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok) onAdd(picked, Math.round(p * 100) / 100, name.trim() || picked.name, q);
          }}
        >
          {choices.length > 1 && (
            <div className="space-y-1.5">
              <Label htmlFor="op-item">ประเภท</Label>
              <NativeSelect id="op-item" value={String(picked.id)} onChange={(e) => setPickedId(Number(e.target.value))}>
                {choices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="op-price">ราคาต่อชิ้น (บาท)</Label>
            <Input id="op-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="h-14 text-2xl tabular-nums" autoFocus />
          </div>
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="op-name">รายละเอียด (ไม่บังคับ)</Label>
              <Input id="op-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={picked.name} maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="op-qty">จำนวน</Label>
              <Input id="op-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ""))} />
            </div>
          </div>
          <Button type="submit" size="lg" disabled={!ok}>
            ใส่ตะกร้า {ok ? formatMoney(p * q) : ""}
          </Button>
        </form>
      )}
    </DialogContent>
  );
}
