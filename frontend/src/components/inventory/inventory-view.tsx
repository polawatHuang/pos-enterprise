"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, ClipboardCheck, PackagePlus, Search, Warehouse as WarehouseIcon } from "lucide-react";
import { api, apiFetch } from "@/lib/api";
import type { MovementType, Paged, StockLevel, StockMovement, Warehouse } from "@/lib/types";
import { formatCompact, formatDateTime, formatMoney, formatNumber } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, NativeSelect, Pagination, Skeleton, TabBar } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/overlays";
import { PageHeader } from "@/components/layout/page";
import { MOVEMENT_META, MovementTypeBadge } from "./movement-badge";
import { AdjustDialog, MultiLineStockDialog, type StockAction } from "./stock-dialogs";

export function InventoryView() {
  const { can } = useAuth();
  const [tab, setTab] = useState<"levels" | "movements">("levels");
  const [warehouseId, setWarehouseId] = useState("");
  const [action, setAction] = useState<StockAction | null>(null);
  const warehouses = useQuery({ queryKey: ["inventory", "warehouses"], queryFn: () => api.get<Warehouse[]>("/inventory/warehouses") });
  const whs = warehouses.data ?? [];
  const totalValue = whs.reduce((s, w) => s + w.stockValue, 0);

  return (
    <>
      <PageHeader
        title="สต๊อกสินค้า"
        description="คงเหลือแยกคลัง ประวัติการเคลื่อนไหว รับเข้า ปรับยอด และโอนย้าย"
        actions={
          can("inventory:write") && (
            <>
              <Button variant="outline" onClick={() => setAction("adjust")}>
                <ClipboardCheck /> ปรับยอด
              </Button>
              <Button variant="outline" onClick={() => setAction("transfer")} disabled={whs.length < 2}>
                <ArrowLeftRight /> โอนย้าย
              </Button>
              <Button onClick={() => setAction("receive")}>
                <PackagePlus /> รับสินค้าเข้า
              </Button>
            </>
          )
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-5">
          <p className="text-sm text-muted-foreground">มูลค่าสต๊อกรวม (ราคาทุน)</p>
          <p className="mt-1 text-2xl font-semibold">{warehouses.isPending ? "–" : formatMoney(totalValue)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{whs.length} คลัง</p>
        </Card>
        {whs.map((w) => (
          <button
            key={w.id}
            onClick={() => setWarehouseId((cur) => (cur === String(w.id) ? "" : String(w.id)))}
            className={`rounded-xl border bg-card p-5 text-left transition-colors ${warehouseId === String(w.id) ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-primary/40"}`}
          >
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <WarehouseIcon className="size-4" /> {w.name}
            </p>
            <p className="mt-1 text-2xl font-semibold">{formatNumber(w.totalUnits)} ชิ้น</p>
            <p className="mt-1 text-xs text-muted-foreground">
              มูลค่า {formatCompact(w.stockValue)} · {w.branchName ?? "ไม่ผูกสาขา"}
            </p>
          </button>
        ))}
      </section>

      <Card className="mt-4">
        <div className="px-4 pt-2">
          <TabBar
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "levels", label: "คงเหลือ" },
              { value: "movements", label: "ประวัติการเคลื่อนไหว" },
            ]}
          />
        </div>
        {tab === "levels" ? <LevelsTable warehouseId={warehouseId} warehouses={whs} onWarehouse={setWarehouseId} /> : <MovementsTable warehouseId={warehouseId} />}
      </Card>

      <Dialog open={action !== null} onOpenChange={(o) => !o && setAction(null)}>
        {action === "adjust" && <AdjustDialog warehouses={whs} onDone={() => setAction(null)} />}
        {(action === "receive" || action === "transfer") && <MultiLineStockDialog action={action} warehouses={whs} onDone={() => setAction(null)} />}
      </Dialog>
    </>
  );
}

function LevelsTable({ warehouseId, warehouses, onWarehouse }: { warehouseId: string; warehouses: Warehouse[]; onWarehouse: (v: string) => void }) {
  const [q, setQ] = useState("");
  const [low, setLow] = useState(false);
  const [page, setPage] = useState(1);
  const query = { warehouseId, q, lowStock: low ? "true" : undefined, page, pageSize: 50 };
  const levels = useQuery({
    queryKey: ["inventory", "levels", query],
    queryFn: () => apiFetch<Paged<StockLevel>>("/inventory/levels", { query }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="ค้นหาสินค้า"
            className="h-9 pl-9"
            aria-label="ค้นหาสินค้า"
          />
        </div>
        <NativeSelect aria-label="คลัง" value={warehouseId} onChange={(e) => onWarehouse(e.target.value)}>
          <option value="">ทุกคลังรวมกัน</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </NativeSelect>
        <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm">
          <input
            type="checkbox"
            checked={low}
            onChange={(e) => {
              setLow(e.target.checked);
              setPage(1);
            }}
            className="accent-[var(--primary)]"
          />
          เฉพาะต่ำกว่าจุดสั่งซื้อ
        </label>
      </div>
      {levels.isPending ? (
        <div className="space-y-2 px-4 pb-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-y border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">สินค้า</th>
                <th className="px-4 py-3 text-right font-medium">คงเหลือ</th>
                <th className="px-4 py-3 text-right font-medium">จุดสั่งซื้อ</th>
                <th className="px-4 py-3 text-right font-medium">ต้นทุน/หน่วย</th>
                <th className="px-4 py-3 text-right font-medium">มูลค่า</th>
              </tr>
            </thead>
            <tbody>
              {levels.data?.data.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-muted-foreground">
                    ไม่พบรายการ
                  </td>
                </tr>
              )}
              {levels.data?.data.map((l) => {
                const isLow = l.quantity <= l.reorderPoint;
                return (
                  <tr key={l.productId} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <Link href={`/products/${l.productId}`} className="font-medium hover:text-primary">
                        {l.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{l.sku}</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Badge tone={l.quantity <= 0 ? "danger" : isLow ? "warning" : "neutral"}>
                        {formatNumber(l.quantity)} {l.unit}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{formatNumber(l.reorderPoint)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatMoney(l.cost)}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">{formatMoney(l.value)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {levels.data && <Pagination {...levels.data.meta} onChange={setPage} />}
    </>
  );
}

function MovementsTable({ warehouseId }: { warehouseId: string }) {
  const [type, setType] = useState<MovementType | "">("");
  const movements = useQuery({
    queryKey: ["inventory", "movements", { warehouseId, type }],
    queryFn: () => api.get<StockMovement[]>("/inventory/movements", { warehouseId, type, limit: 100 }),
  });
  return (
    <>
      <div className="flex gap-3 p-4">
        <NativeSelect aria-label="ประเภท" value={type} onChange={(e) => setType(e.target.value as MovementType | "")}>
          <option value="">ทุกประเภท</option>
          {Object.entries(MOVEMENT_META).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </NativeSelect>
        <p className="self-center text-xs text-muted-foreground">แสดง 100 รายการล่าสุด</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-y border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">เวลา</th>
              <th className="px-4 py-3 font-medium">ประเภท</th>
              <th className="px-4 py-3 font-medium">สินค้า</th>
              <th className="px-4 py-3 font-medium">คลัง</th>
              <th className="px-4 py-3 text-right font-medium">จำนวน</th>
              <th className="px-4 py-3 font-medium">โดย</th>
              <th className="px-4 py-3 font-medium">หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>
            {movements.isPending && (
              <tr>
                <td colSpan={7} className="p-4">
                  <Skeleton className="h-40 w-full" />
                </td>
              </tr>
            )}
            {movements.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="py-12 text-center text-muted-foreground">
                  ยังไม่มีความเคลื่อนไหว — ยอดขายเดโมจาก seed ไม่ได้สร้างประวัติสต๊อก
                </td>
              </tr>
            )}
            {movements.data?.map((m) => (
              <tr key={m.id} className="border-b border-border last:border-0">
                <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{formatDateTime(m.createdAt)}</td>
                <td className="px-4 py-2.5">
                  <MovementTypeBadge type={m.type} />
                </td>
                <td className="px-4 py-2.5">
                  <Link href={`/products/${m.productId}`} className="hover:text-primary">
                    {m.productName}
                  </Link>
                </td>
                <td className="px-4 py-2.5">{m.warehouseName}</td>
                <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${m.quantity < 0 ? "text-danger" : "text-success"}`}>
                  {m.quantity > 0 ? "+" : ""}
                  {formatNumber(m.quantity)}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{m.userName ?? "ระบบ"}</td>
                <td className="max-w-56 truncate px-4 py-2.5 text-muted-foreground">{m.note ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
