"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { StockCount, StockCountStatus, Warehouse } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, Label, NativeSelect, Skeleton } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { PageHeader } from "@/components/layout/page";
import { useCategories } from "@/components/products/product-form";

export const COUNT_STATUS: Record<StockCountStatus, { label: string; tone: "primary" | "warning" | "success" | "neutral" }> = {
  counting: { label: "กำลังนับ", tone: "primary" },
  review: { label: "รอตรวจ", tone: "warning" },
  approved: { label: "อนุมัติแล้ว", tone: "success" },
  cancelled: { label: "ยกเลิก", tone: "neutral" },
};

export function CountsView() {
  const counts = useQuery({ queryKey: ["inventory", "counts"], queryFn: () => api.get<StockCount[]>("/inventory/counts") });
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="ตรวจนับสต๊อก"
        description="สร้างรอบนับ แล้วให้พนักงานสแกนนับด้วยมือถือ ผู้จัดการตรวจส่วนต่างก่อนปรับสต๊อก"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> สร้างรอบตรวจนับ
          </Button>
        }
      />
      {counts.isPending ? (
        <Skeleton className="h-60 w-full rounded-xl" />
      ) : counts.data?.length === 0 ? (
        <Card className="grid place-items-center gap-3 p-12 text-center">
          <ClipboardList className="size-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">ยังไม่มีรอบตรวจนับ — แนะนำนับทีละหมวดทุกสัปดาห์ (cycle count) แทนการปิดร้านนับทั้งร้าน</p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {counts.data?.map((c) => {
            const pct = c.totalItems ? Math.round(((c.countedItems ?? 0) / c.totalItems) * 100) : 0;
            return (
              <Link key={c.id} href={`/inventory/counts/${c.id}`} className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{c.countNo}</span>
                  <Badge tone={COUNT_STATUS[c.status].tone}>{COUNT_STATUS[c.status].label}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {c.warehouseName} · {c.scope === "full" ? "ทั้งคลัง" : c.categoryName} {c.blind && "· นับแบบไม่เห็นยอด"}
                </p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  นับแล้ว {c.countedItems}/{c.totalItems} รายการ · โดย {c.createdBy} · {formatDateTime(c.createdAt)}
                </p>
              </Link>
            );
          })}
        </div>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        {creating && <CreateCountDialog />}
      </Dialog>
    </>
  );
}

function CreateCountDialog() {
  const router = useRouter();
  const warehouses = useQuery({ queryKey: ["inventory", "warehouses"], queryFn: () => api.get<Warehouse[]>("/inventory/warehouses") });
  const categories = useCategories();
  const [warehouseId, setWarehouseId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [blind, setBlind] = useState(true);
  const [busy, setBusy] = useState(false);
  const wh = warehouseId || String(warehouses.data?.[0]?.id ?? "");

  const create = async () => {
    setBusy(true);
    try {
      const c = await api.post<StockCount>("/inventory/counts", {
        warehouseId: Number(wh),
        scope: categoryId ? "category" : "full",
        categoryId: categoryId ? Number(categoryId) : undefined,
        blind,
      });
      router.push(`/inventory/counts/${c.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "สร้างไม่สำเร็จ");
      setBusy(false);
    }
  };

  return (
    <DialogContent title="สร้างรอบตรวจนับ" description="ระบบบันทึกยอดในระบบ ณ ตอนนี้ ขายต่อได้ระหว่างนับ (ระบบหักยอดขายระหว่างนับให้)">
      <div className="grid gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="c-wh">คลัง</Label>
          <NativeSelect id="c-wh" value={wh} onChange={(e) => setWarehouseId(e.target.value)}>
            {warehouses.data?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="c-cat">ขอบเขต</Label>
          <NativeSelect id="c-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">ทั้งคลัง (ทุกสินค้า)</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                เฉพาะหมวด {c.name} ({c.productCount})
              </option>
            ))}
          </NativeSelect>
        </div>
        <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm">
          <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} className="mt-0.5 size-4" />
          <span>
            <span className="block font-medium">นับแบบไม่เห็นยอด (แนะนำ)</span>
            <span className="text-xs text-muted-foreground">พนักงานไม่เห็นยอดในระบบ จึงนับตามจริง ไม่นับตามตัวเลข</span>
          </span>
        </label>
        <Button onClick={create} disabled={busy || !wh}>
          {busy && <Loader2 className="animate-spin" />}
          เริ่มนับ
        </Button>
      </div>
    </DialogContent>
  );
}
