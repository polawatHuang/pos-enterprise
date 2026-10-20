"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";
import { type CartLine, r2 } from "./cart";

/** Edit one cart line: quantity, selling unit (piece/pack/carton) and a line discount. */
export function LineDialog({
  line,
  onSave,
  onRemove,
}: {
  line: CartLine;
  onSave: (patch: { quantity: number; unitId: number | null; discount: number }) => void;
  onRemove: () => void;
}) {
  const [qty, setQty] = useState(String(line.quantity));
  const [unitId, setUnitId] = useState<number | null>(line.unitId);
  const [discount, setDiscount] = useState(line.discount ? String(line.discount) : "");
  const [pct, setPct] = useState(false);
  const units = [{ id: null as number | null, name: line.item.unit, price: line.item.price, factor: 1 }, ...line.item.units];
  const price = units.find((u) => u.id === unitId)?.price ?? line.item.price;
  const q = Math.max(Number(qty) || 0, 0);
  const d = pct ? r2((price * q * (Number(discount) || 0)) / 100) : Number(discount) || 0;

  return (
    <DialogContent title={line.item.name} description={line.item.sku} className="max-w-md">
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (q > 0) onSave({ quantity: q, unitId, discount: Math.min(d, price * q) });
        }}
      >
        {units.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <Label>หน่วยขาย</Label>
            <div className="grid grid-cols-3 gap-2">
              {units.map((u) => (
                <button
                  type="button"
                  key={u.id ?? 0}
                  onClick={() => setUnitId(u.id)}
                  className={cn("rounded-xl border p-2 text-sm", unitId === u.id ? "border-primary bg-primary-soft text-primary" : "border-border hover:bg-accent")}
                >
                  <span className="block font-medium">{u.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {u.factor > 1 ? `${u.factor} ${line.item.unit} · ` : ""}
                    {formatMoney(u.price)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="line-qty">จำนวน</Label>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="h-12 w-12 text-xl" onClick={() => setQty(String(Math.max(q - 1, 1)))}>
              −
            </Button>
            <Input id="line-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className="h-12 text-center text-xl" autoFocus onFocus={(e) => e.target.select()} />
            <Button type="button" variant="outline" className="h-12 w-12 text-xl" onClick={() => setQty(String(q + 1))}>
              +
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="line-disc">ส่วนลดรายการนี้</Label>
          <div className="flex gap-2">
            <Input id="line-disc" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" className="h-10" />
            <div className="flex rounded-lg border border-border p-0.5">
              {(["฿", "%"] as const).map((k) => (
                <button type="button" key={k} onClick={() => setPct(k === "%")} className={cn("w-9 rounded-md text-sm", (k === "%") === pct ? "bg-primary text-primary-foreground" : "")}>
                  {k}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-baseline justify-between rounded-xl bg-muted p-3">
          <span className="text-sm text-muted-foreground">รวมรายการ</span>
          <span className="text-xl font-semibold tabular-nums">{formatMoney(Math.max(price * q - d, 0))}</span>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <Button type="button" variant="outline" className="text-danger" onClick={onRemove} aria-label="ลบรายการ">
            <Trash2 />
          </Button>
          <Button type="submit" disabled={q <= 0}>
            บันทึก
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
