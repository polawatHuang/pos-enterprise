"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, BellRing, ClipboardCheck, ClipboardList, Loader2, PackagePlus, Search, Undo2, Warehouse as WarehouseIcon } from "lucide-react";
import { toast } from "sonner";
import { api, apiFetch } from "@/lib/api";
import type { MovementType, Paged, StockLevel, StockMovement, StockStatus, Warehouse } from "@/lib/types";
import { cn, formatCompact, formatDateTime, formatMoney, formatNumber } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, Label, NativeSelect, Pagination, Skeleton, TabBar } from "@/components/ui/primitives";
import { ScanButton } from "@/components/ui/barcode-scanner";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { PageHeader } from "@/components/layout/page";
import { ErrorNote } from "@/components/dashboard/widgets";
import { Sparkline } from "@/components/common/sparkline";
import { AlertSettingsDialog } from "./alert-settings";
import { MOVEMENT_META, MovementTypeBadge } from "./movement-badge";
import { AdjustDialog, MultiLineStockDialog, type StockAction } from "./stock-dialogs";

export function InventoryView() {
  const { can } = useAuth();
  const [tab, setTab] = useState<"levels" | "movements">("levels");
  // Links from stock alerts open the right warehouse and filter (e.g. /inventory?warehouseId=2&status=low)
  const params = useSearchParams();
  const [warehouseId, setWarehouseId] = useState(params.get("warehouseId") ?? "");
  const [action, setAction] = useState<StockAction | "alerts" | null>(null);
  const warehouses = useQuery({ queryKey: ["inventory", "warehouses"], queryFn: () => api.get<Warehouse[]>("/inventory/warehouses") });
  const whs = warehouses.data ?? [];
  const totalValue = whs.reduce((s, w) => s + w.stockValue, 0);

  return (
    <>
      <PageHeader
        title="สต๊อกสินค้า"
        description="คงเหลือแยกคลัง ยอดขายต่อวัน พอขายอีกกี่วัน ประวัติการเคลื่อนไหว รับเข้า ปรับยอด และโอนย้าย"
        actions={
          <>
            {can("inventory:count") && (
              <Button variant="outline" asChild>
                <Link href="/inventory/counts">
                  <ClipboardList /> ตรวจนับสต๊อก
                </Link>
              </Button>
            )}
            {can("inventory:write") && (
              <Button variant="outline" onClick={() => setAction("alerts")}>
                <BellRing /> แจ้งเตือน
              </Button>
            )}
            {can("inventory:write") && (
            <>
              <Button variant="outline" onClick={() => setAction("adjust")}>
                <ClipboardCheck /> ปรับยอด
              </Button>
              {/* Transfers are posted by the purchasing module (purchasing:write) */}
              {can("purchasing:write") && (
                <Button variant="outline" onClick={() => setAction("transfer")} disabled={whs.length < 2}>
                  <ArrowLeftRight /> โอนย้าย
                </Button>
              )}
              <Button onClick={() => setAction("receive")}>
                <PackagePlus /> รับสินค้าเข้า
              </Button>
            </>
            )}
          </>
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
        {tab === "levels" ? (
          <LevelsTable
            warehouseId={warehouseId}
            warehouses={whs}
            onWarehouse={setWarehouseId}
            initialStatus={(params.get("status") as StatusFilter | null) ?? ""}
            editable={can("inventory:write")}
          />
        ) : (
          <MovementsTable warehouseId={warehouseId} editable={can("inventory:write")} />
        )}
      </Card>

      <Dialog open={action !== null} onOpenChange={(o) => !o && setAction(null)}>
        {action === "alerts" && <AlertSettingsDialog onDone={() => setAction(null)} />}
        {action === "adjust" && <AdjustDialog warehouses={whs} onDone={() => setAction(null)} />}
        {(action === "receive" || action === "transfer") && <MultiLineStockDialog action={action} warehouses={whs} onDone={() => setAction(null)} />}
      </Dialog>
    </>
  );
}

type StatusFilter = "" | "out" | "low";
const STATUS_META: Record<StockStatus, { label: string; tone: "danger" | "warning" | "neutral" | "success" }> = {
  out: { label: "หมด", tone: "danger" },
  low: { label: "ใกล้หมด", tone: "warning" },
  slow: { label: "ขายไม่ออก", tone: "neutral" },
  ok: { label: "ปกติ", tone: "success" },
};

function LevelsTable({
  warehouseId,
  warehouses,
  onWarehouse,
  initialStatus,
  editable,
}: {
  warehouseId: string;
  warehouses: Warehouse[];
  onWarehouse: (v: string) => void;
  initialStatus: StatusFilter;
  editable: boolean;
}) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>(initialStatus);
  const [page, setPage] = useState(1);
  const query = { warehouseId, q, status: status || undefined, page, pageSize: 50 };
  const levels = useQuery({
    queryKey: ["inventory", "levels", query],
    queryFn: () => apiFetch<Paged<StockLevel>>("/inventory/levels", { query }),
    placeholderData: keepPreviousData,
  });

  const saveReorder = async (l: StockLevel, value: string) => {
    const n = value === "" ? null : Number(value);
    if (n !== null && (!Number.isFinite(n) || n < 0)) return;
    if (n === l.reorderPoint) return;
    try {
      await api.patch("/inventory/levels", { warehouseId: Number(warehouseId), productId: l.productId, reorderPoint: n });
      toast.success(`ตั้งจุดสั่งซื้อ ${l.name} แล้ว`);
      void qc.invalidateQueries({ queryKey: ["inventory", "levels"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    }
  };

  return (
    <>
      <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
        <div className="flex w-full gap-2 lg:max-w-xs">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="ค้นหาสินค้า / SKU / บาร์โค้ด"
              className="h-11 pl-9 lg:h-9"
              aria-label="ค้นหาสินค้า"
            />
          </div>
          <ScanButton
            title="สแกนบาร์โค้ดเพื่อค้นหา"
            className="lg:size-9"
            onDetected={(code) => {
              setQ(code);
              setPage(1);
            }}
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
        <div className="flex gap-1.5" role="radiogroup" aria-label="สถานะสต๊อก">
          {(
            [
              ["", "ทั้งหมด"],
              ["low", "ต่ำกว่าจุดสั่งซื้อ"],
              ["out", "หมด"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              role="radio"
              aria-checked={status === v}
              onClick={() => {
                setStatus(v);
                setPage(1);
              }}
              className={cn(
                "h-9 rounded-lg border px-3 text-sm",
                status === v ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-accent",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {levels.isPending ? (
        <div className="space-y-2 px-4 pb-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : levels.isError && !levels.data ? (
        <ErrorNote onRetry={() => levels.refetch()} />
      ) : (
        <div className="overflow-x-auto">
          <table className="table-cards w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-y border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">สินค้า</th>
                <th className="px-4 py-3 text-right font-medium">คงเหลือ</th>
                <th className="px-4 py-3 font-medium">ยอดขาย 14 วัน</th>
                <th className="px-4 py-3 text-right font-medium">ขาย/วัน</th>
                <th className="px-4 py-3 text-right font-medium">พอขายอีก</th>
                <th className="px-4 py-3 text-right font-medium">จุดสั่งซื้อ</th>
                <th className="px-4 py-3 text-right font-medium">มูลค่า</th>
              </tr>
            </thead>
            <tbody>
              {levels.data?.data.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-muted-foreground">
                    ไม่พบรายการ
                  </td>
                </tr>
              )}
              {levels.data?.data.map((l) => {
                const meta = STATUS_META[l.status];
                return (
                  <tr key={l.productId} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <Link href={`/products/${l.productId}`} className="font-medium hover:text-primary">
                        {l.name}
                      </Link>
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {l.sku}
                        {l.status !== "ok" && <Badge tone={meta.tone} className="px-1.5 py-0 text-[10px]">{meta.label}</Badge>}
                      </p>
                    </td>
                    <td data-label="คงเหลือ" className="px-4 py-3 text-right">
                      <Badge tone={l.status === "out" ? "danger" : l.status === "low" ? "warning" : "neutral"}>
                        {formatNumber(l.quantity)} {l.unit}
                      </Badge>
                    </td>
                    <td data-label="ยอดขาย 14 วัน" className="px-4 py-3">
                      <Sparkline values={l.spark} />
                    </td>
                    <td data-label="ขาย/วัน" className="px-4 py-3 text-right tabular-nums">{l.avgDaily ? l.avgDaily.toFixed(1) : "–"}</td>
                    <td data-label="พอขายอีก"
                      className={cn(
                        "px-4 py-3 text-right font-medium tabular-nums",
                        l.daysCover !== null && l.daysCover < 3 ? "text-danger" : l.daysCover !== null && l.daysCover < 7 ? "text-warning" : "",
                      )}
                    >
                      {l.daysCover === null ? "–" : `${formatNumber(l.daysCover)} วัน`}
                    </td>
                    <td data-label="จุดสั่งซื้อ" className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {editable && warehouseId ? (
                        <Input
                          key={`${l.productId}-${l.reorderPoint}`}
                          defaultValue={l.reorderPoint}
                          inputMode="numeric"
                          onBlur={(e) => void saveReorder(l, e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                          className={cn("ml-auto h-8 w-20 text-right", l.reorderOverride && "border-primary")}
                          aria-label={`จุดสั่งซื้อ ${l.name}`}
                          title={l.reorderOverride ? "ตั้งเฉพาะคลังนี้" : "ใช้ค่าตั้งต้นของสินค้า"}
                        />
                      ) : (
                        formatNumber(l.reorderPoint)
                      )}
                    </td>
                    <td data-label="มูลค่า" className="px-4 py-3 text-right font-medium tabular-nums">{formatMoney(l.value)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editable && !warehouseId && <p className="px-4 pb-2 text-xs text-muted-foreground">เลือกคลังเพื่อตั้งจุดสั่งซื้อเฉพาะคลังนั้นได้ในตาราง</p>}
      {levels.data && <Pagination {...levels.data.meta} onChange={setPage} />}
    </>
  );
}

function MovementsTable({ warehouseId, editable }: { warehouseId: string; editable: boolean }) {
  const [type, setType] = useState<MovementType | "">("");
  const [reversing, setReversing] = useState<StockMovement | null>(null);
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
        <table className="table-cards w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-y border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">เวลา</th>
              <th className="px-4 py-3 font-medium">ประเภท</th>
              <th className="px-4 py-3 font-medium">สินค้า</th>
              <th className="px-4 py-3 font-medium">คลัง</th>
              <th className="px-4 py-3 text-right font-medium">จำนวน</th>
              <th className="px-4 py-3 font-medium">โดย</th>
              <th className="px-4 py-3 font-medium">หมายเหตุ</th>
              <th className="px-4 py-3 font-medium">
                <span className="sr-only">จัดการ</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {movements.isPending && (
              <tr>
                <td colSpan={8} className="p-4">
                  <Skeleton className="h-40 w-full" />
                </td>
              </tr>
            )}
            {movements.isError && !movements.data && (
              <tr>
                <td colSpan={8}>
                  <ErrorNote onRetry={() => movements.refetch()} />
                </td>
              </tr>
            )}
            {movements.data?.length === 0 && (
              <tr>
                <td colSpan={8} className="py-12 text-center text-muted-foreground">
                  ยังไม่มีความเคลื่อนไหวของสต๊อก — การขาย รับของ โอนย้าย และปรับสต๊อกจะแสดงที่นี่
                </td>
              </tr>
            )}
            {movements.data?.map((m) => (
              <tr key={m.id} className="border-b border-border last:border-0">
                <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{formatDateTime(m.createdAt)}</td>
                <td data-label="ประเภท" className="px-4 py-2.5">
                  <MovementTypeBadge type={m.type} />
                </td>
                <td data-label="สินค้า" className="px-4 py-2.5">
                  <Link href={`/products/${m.productId}`} className="hover:text-primary">
                    {m.productName}
                  </Link>
                </td>
                <td data-label="คลัง" className="px-4 py-2.5">{m.warehouseName}</td>
                <td data-label="จำนวน" className={`px-4 py-2.5 text-right font-medium tabular-nums ${m.quantity < 0 ? "text-danger" : "text-success"}`}>
                  {m.quantity > 0 ? "+" : ""}
                  {formatNumber(m.quantity)}
                </td>
                <td data-label="โดย" className="px-4 py-2.5 text-muted-foreground">{m.userName ?? "ระบบ"}</td>
                <td data-label="หมายเหตุ" className="max-w-56 truncate px-4 py-2.5 text-muted-foreground">{m.note ?? "–"}</td>
                <td className="px-4 py-2.5 text-right">
                  {m.reversed ? (
                    <Badge tone="neutral">กลับรายการแล้ว</Badge>
                  ) : (
                    editable &&
                    m.reversible && (
                      <Button variant="outline" className="h-10" onClick={() => setReversing(m)}>
                        <Undo2 /> กลับรายการ
                      </Button>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={reversing !== null} onOpenChange={(o) => !o && setReversing(null)}>
        {reversing && <ReverseAdjustmentDialog movement={reversing} onDone={() => setReversing(null)} />}
      </Dialog>
    </>
  );
}

/** Undo a mistaken quick adjustment with the opposite quantity; both rows stay in the history. */
function ReverseAdjustmentDialog({ movement, onDone }: { movement: StockMovement; onDone: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const opposite = -movement.quantity;
  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/inventory/movements/${movement.id}/reverse`, { reason: reason.trim() });
      toast.success(`กลับรายการปรับยอด ${movement.productName} แล้ว`);
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogContent title="กลับรายการปรับยอด" description={`${movement.productName} · ${movement.warehouseName}`} className="max-w-sm">
      <div className="grid gap-3">
        <p className="rounded-lg bg-muted px-3 py-2 text-sm">
          ระบบจะบันทึกการปรับยอด {opposite > 0 ? "+" : ""}
          {formatNumber(opposite)} เพื่อหักล้างรายการเดิม ({movement.quantity > 0 ? "+" : ""}
          {formatNumber(movement.quantity)}) — ทั้งสองรายการยังอยู่ในประวัติ
        </p>
        <Label htmlFor="movement-reverse-reason">เหตุผล</Label>
        <Input
          id="movement-reverse-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          placeholder="เช่น กรอกจำนวนผิด"
          className="h-11"
        />
        <Button variant="danger" className="h-11" onClick={save} disabled={busy || !reason.trim()}>
          {busy && <Loader2 className="animate-spin" />}
          ยืนยันกลับรายการ
        </Button>
      </div>
    </DialogContent>
  );
}
