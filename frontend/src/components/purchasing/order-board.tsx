"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Minus, PackageCheck, Plus, Sparkles, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { OrderSuggestion, PurchaseOrder, Supplier, Warehouse } from "@/lib/types";
import { cn, formatMoney, formatNumber } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, NativeSelect, Skeleton } from "@/components/ui/primitives";
import { Sparkline } from "@/components/common/sparkline";

interface AiNote {
  factor: number;
  reason: string;
}

/**
 * 7-Eleven style ordering (tanpin kanri): one card per item with its 14-day sales, stock, what is
 * already on the way and the suggested quantity; +/- in pack steps, AI seasonal adjust, then one
 * purchase order per supplier.
 */
export function OrderBoard({ warehouses, initialWarehouse }: { warehouses: Warehouse[]; initialWarehouse: string }) {
  const { can, user } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  // Default to the warehouse of the user's own branch (the same stock the POS sells from)
  const ownWarehouse = warehouses.find((w) => w.branchId != null && w.branchId === user?.branchId) ?? warehouses[0];
  const [warehouseId, setWarehouseId] = useState(initialWarehouse || String(ownWarehouse?.id ?? ""));
  const [supplierId, setSupplierId] = useState("");
  const [all, setAll] = useState(false);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [ai, setAi] = useState<{ summary: string; notes: Record<number, AiNote> } | null>(null);
  const [busy, setBusy] = useState<"ai" | "create" | null>(null);
  const suppliers = useQuery({ queryKey: ["purchasing", "suppliers"], queryFn: () => api.get<Supplier[]>("/purchasing/suppliers") });
  const query = { warehouseId, supplierId: supplierId || undefined, all: all ? "true" : undefined };
  const rows = useQuery({
    queryKey: ["purchasing", "suggestions", query],
    queryFn: () => api.get<OrderSuggestion[]>("/purchasing/suggestions", query),
    enabled: !!warehouseId,
  });

  const items = rows.data ?? [];
  const qtyOf = (r: OrderSuggestion) => qty[r.productId] ?? r.suggested;
  const picked = items.filter((r) => qtyOf(r) > 0);
  const total = useMemo(() => picked.reduce((s, r) => s + qtyOf(r) * r.cost, 0), [picked, qty]); // eslint-disable-line react-hooks/exhaustive-deps
  const step = (r: OrderSuggestion, dir: 1 | -1) => setQty((q) => ({ ...q, [r.productId]: Math.max(0, qtyOf(r) + dir * (r.packSize || 1)) }));
  const reset = () => {
    setQty({});
    setAi(null);
  };

  const askAi = async () => {
    const list = items.filter((r) => qtyOf(r) > 0 || r.avgDaily > 0).slice(0, 80);
    if (!list.length) return;
    setBusy("ai");
    try {
      const r = await api.post<{ summary: string; items: { productId: number; factor: number; reason: string; quantity: number }[] }>("/purchasing/suggestions/ai", {
        warehouseId: Number(warehouseId),
        items: list.map((x) => ({ productId: x.productId, suggested: qtyOf(x) })),
      });
      const notes: Record<number, AiNote> = {};
      const next = { ...qty };
      for (const i of r.items) {
        if (Math.abs(i.factor - 1) < 0.01) continue;
        notes[i.productId] = { factor: i.factor, reason: i.reason };
        next[i.productId] = i.quantity;
      }
      setQty(next);
      setAi({ summary: r.summary, notes });
      toast.success(`AI ปรับยอดสั่ง ${Object.keys(notes).length} รายการ`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI ปรับยอดไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };

  /** One PO per supplier (items without a supplier go on their own PO). */
  const create = async (send: boolean) => {
    setBusy("create");
    try {
      const groups = new Map<number | null, OrderSuggestion[]>();
      for (const r of picked) groups.set(r.supplierId, [...(groups.get(r.supplierId) ?? []), r]);
      const created: PurchaseOrder[] = [];
      for (const [sid, list] of groups) {
        created.push(
          await api.post<PurchaseOrder>("/purchasing/orders", {
            supplierId: sid,
            warehouseId: Number(warehouseId),
            source: "suggestion",
            send,
            note: ai?.summary ? `AI: ${ai.summary}`.slice(0, 1000) : undefined,
            items: list.map((r) => ({ productId: r.productId, quantity: qtyOf(r), unitCost: r.cost })),
          }),
        );
      }
      toast.success(`สร้างใบสั่งซื้อ ${created.length} ใบ (${created.map((p) => p.poNo).join(", ")})`);
      reset();
      void qc.invalidateQueries({ queryKey: ["purchasing"] });
      if (created.length === 1) router.push(`/purchasing/orders/${created[0].id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "สร้างใบสั่งซื้อไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="pb-28">
      <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
        <NativeSelect aria-label="คลังที่สั่งเข้า" value={warehouseId} onChange={(e) => (setWarehouseId(e.target.value), reset())}>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              สั่งเข้า {w.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="ผู้ขาย" value={supplierId} onChange={(e) => (setSupplierId(e.target.value), reset())}>
          <option value="">ทุกผู้ขาย</option>
          {suppliers.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} (ส่ง {s.leadTimeDays} วัน)
            </option>
          ))}
          <option value="0">ยังไม่ระบุผู้ขาย</option>
        </NativeSelect>
        <label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> แสดงทุกสินค้า
        </label>
        {can("purchasing:write") && (
          <Button variant="outline" className="lg:ml-auto" onClick={askAi} disabled={busy !== null || !items.length}>
            {busy === "ai" ? <Loader2 className="animate-spin" /> : <Sparkles className="text-primary" />} ให้ AI ปรับตามเทศกาล
          </Button>
        )}
      </div>

      {ai && (
        <div className="mx-4 mb-3 flex items-start gap-2 rounded-xl border border-primary/30 bg-primary-soft/40 p-3 text-sm" data-testid="ai-summary">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>{ai.summary}</p>
        </div>
      )}

      {rows.isPending ? (
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-48 rounded-2xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="grid place-items-center gap-2 p-12 text-center">
          <PackageCheck className="size-10 text-success" />
          <p className="font-medium">สต๊อกพอขายทุกรายการ</p>
          <p className="text-sm text-muted-foreground">ยังไม่มีสินค้าที่ต้องสั่ง — เลือก &quot;แสดงทุกสินค้า&quot; เพื่อสั่งเพิ่มเอง</p>
        </div>
      ) : (
        <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((r) => {
            const q = qtyOf(r);
            const note = ai?.notes[r.productId];
            const cover = r.daysCover;
            return (
              <Card key={r.productId} className={cn("flex flex-col p-4 transition-shadow", q > 0 && "border-primary/50 shadow-sm")} data-testid="order-card">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{r.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.categoryName ?? r.sku} · {r.supplierName ?? "ไม่ระบุผู้ขาย"}
                    </p>
                  </div>
                  {r.onHand <= 0 ? (
                    <Badge tone="danger">หมด</Badge>
                  ) : cover !== null && cover < 3 ? (
                    <Badge tone="warning">
                      <TriangleAlert className="size-3" /> {formatNumber(cover)} วัน
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-3 flex items-end justify-between gap-3">
                  <div>
                    <Sparkline values={r.spark} className="h-8 w-[112px]" label={`ยอดขาย 14 วันของ ${r.name}`} />
                    <p className="mt-1 text-[11px] text-muted-foreground">ขาย 14 วัน · เฉลี่ย {r.avgDaily.toFixed(1)}/วัน</p>
                    {r.otherStock > 0 && <p className="text-[11px] font-medium text-primary">คลังอื่นมี {formatNumber(r.otherStock)}</p>}
                  </div>
                  <dl className="grid grid-cols-3 gap-2 text-center text-xs">
                    <Mini label="มี" value={formatNumber(r.onHand)} danger={r.onHand <= 0} />
                    <Mini label="กำลังมา" value={formatNumber(r.onOrder)} />
                    <Mini label="พอขาย" value={cover === null ? "–" : `${formatNumber(cover)}ว`} danger={cover !== null && cover < 3} />
                  </dl>
                </div>
                <p className="mt-2 line-clamp-2 text-[11px] text-muted-foreground" title={r.reason}>
                  {note ? (
                    <span className="font-medium text-primary">
                      <Sparkles className="mr-1 inline size-3" />
                      AI ×{note.factor.toFixed(2)}: {note.reason}
                    </span>
                  ) : (
                    r.reason
                  )}
                </p>
                <div className="mt-auto flex items-center gap-2 pt-3">
                  <Button variant="outline" size="icon" className="size-11 rounded-xl" onClick={() => step(r, -1)} disabled={q <= 0} aria-label={`ลด ${r.name}`}>
                    <Minus />
                  </Button>
                  <div className="flex-1 text-center">
                    <p className={cn("text-2xl font-bold tabular-nums", q > 0 ? "text-primary" : "text-muted-foreground")} data-testid="order-qty">
                      {formatNumber(q)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {r.unit}
                      {r.packSize > 1 ? ` · ทีละ ${formatNumber(r.packSize)}` : ""}
                      {q !== r.suggested ? ` · แนะนำ ${formatNumber(r.suggested)}` : ""}
                    </p>
                  </div>
                  <Button variant="outline" size="icon" className="size-11 rounded-xl" onClick={() => step(r, 1)} aria-label={`เพิ่ม ${r.name}`}>
                    <Plus />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {can("purchasing:write") && picked.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 p-3 backdrop-blur lg:left-auto lg:right-6 lg:bottom-6 lg:w-[520px] lg:rounded-2xl lg:border lg:shadow-lg">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">
                สั่ง {picked.length} รายการ · {new Set(picked.map((r) => r.supplierId)).size} ผู้ขาย
              </p>
              <p className="text-lg font-bold tabular-nums">{formatMoney(total)}</p>
            </div>
            <Button variant="outline" onClick={() => void create(false)} disabled={busy !== null}>
              บันทึกร่าง
            </Button>
            <Button onClick={() => void create(true)} disabled={busy !== null}>
              {busy === "create" && <Loader2 className="animate-spin" />}
              สั่งซื้อเลย
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Mini({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-lg bg-muted px-2 py-1">
      <dd className={cn("text-sm font-semibold tabular-nums", danger && "text-danger")}>{value}</dd>
      <dt className="text-[10px] text-muted-foreground">{label}</dt>
    </div>
  );
}
