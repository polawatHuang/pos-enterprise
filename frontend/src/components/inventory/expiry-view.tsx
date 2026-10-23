"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarX2, Loader2, PackageCheck, Tag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { ExpiryLot, Warehouse, WasteReason, WasteReport } from "@/lib/types";
import { cn, formatMoney, formatNumber, formatThaiDate } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, NativeSelect, Skeleton, TabBar } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { ErrorNote } from "@/components/dashboard/widgets";
import { PageHeader } from "@/components/layout/page";

const GROUPS: { key: string; label: string; test: (d: number) => boolean; tone: string }[] = [
  { key: "expired", label: "หมดอายุแล้ว — ต้องนำออกจากชั้น", test: (d) => d < 0, tone: "border-danger/50 bg-danger-soft/30" },
  { key: "today", label: "หมดวันนี้", test: (d) => d === 0, tone: "border-danger/30" },
  { key: "soon", label: "ภายใน 3 วัน", test: (d) => d >= 1 && d <= 3, tone: "border-warning/40" },
  { key: "week", label: "ภายใน 7 วัน", test: (d) => d >= 4, tone: "border-border" },
];
const REASONS: { value: WasteReason; label: string }[] = [
  { value: "expired", label: "หมดอายุ" },
  { value: "damaged", label: "ชำรุด/เสียหาย" },
  { value: "lost", label: "สูญหาย" },
  { value: "other", label: "อื่นๆ" },
];

/** 7-Eleven style fresh routine: what expires soon, one-tap markdown, write off waste with a reason. */
export function ExpiryView() {
  const params = useSearchParams();
  const [tab, setTab] = useState<"board" | "waste">("board");
  const [warehouseId, setWarehouseId] = useState(params.get("warehouseId") ?? "");
  const warehouses = useQuery({ queryKey: ["inventory", "warehouses"], queryFn: () => api.get<Warehouse[]>("/inventory/warehouses") });
  return (
    <>
      <PageHeader
        title="ใกล้หมดอายุ & ของเสีย"
        description="สินค้าที่ติดตามวันหมดอายุ ล็อตที่หมดอายุก่อนขายออกก่อน · ลดราคาให้หน้าร้านอัตโนมัติ · บันทึกของเสียลงบัญชี"
        actions={
          <NativeSelect aria-label="คลัง" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">ทุกคลัง</option>
            {warehouses.data?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </NativeSelect>
        }
      />
      <Card>
        <div className="px-4 pt-2">
          <TabBar
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "board", label: "ใกล้หมดอายุ" },
              { value: "waste", label: "รายงานของเสีย" },
            ]}
          />
        </div>
        {tab === "board" ? <Board warehouseId={warehouseId} /> : <Waste />}
      </Card>
    </>
  );
}

function Board({ warehouseId }: { warehouseId: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const lots = useQuery({ queryKey: ["inventory", "expiry", warehouseId], queryFn: () => api.get<ExpiryLot[]>("/inventory/expiry", { warehouseId, days: 7 }) });
  const [waste, setWaste] = useState<ExpiryLot | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["inventory"] });
    void qc.invalidateQueries({ queryKey: ["pos", "catalog"] });
  };
  const markdown = async (l: ExpiryLot, pct: number) => {
    setBusy(l.lotId);
    try {
      await api.post(`/inventory/expiry/lots/${l.lotId}/markdown`, { pct });
      toast.success(pct ? `ลด ${pct}% ที่หน้าร้านแล้ว: ${l.name}` : "ยกเลิกลดราคาแล้ว");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };

  if (lots.isPending) return <Skeleton className="m-4 h-60" />;
  if (lots.isError) return <ErrorNote onRetry={() => lots.refetch()} error={lots.error} />;
  if (!lots.data?.length)
    return (
      <div className="grid place-items-center gap-2 p-12 text-center">
        <PackageCheck className="size-10 text-success" />
        <p className="font-medium">ไม่มีสินค้าใกล้หมดอายุใน 7 วัน</p>
        <p className="text-sm text-muted-foreground">เปิด &quot;ติดตามวันหมดอายุ&quot; ที่หน้าสินค้า แล้วใส่วันหมดอายุตอนรับของ</p>
      </div>
    );

  return (
    <div className="space-y-6 p-4">
      {GROUPS.map((g) => {
        const rows = lots.data.filter((l) => g.test(l.daysLeft));
        if (!rows.length) return null;
        return (
          <section key={g.key}>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              {g.key === "expired" && <CalendarX2 className="size-4 text-danger" />}
              {g.label} <Badge tone={g.key === "expired" || g.key === "today" ? "danger" : g.key === "soon" ? "warning" : "neutral"}>{rows.length}</Badge>
              <span className="ml-auto text-xs font-normal text-muted-foreground">มูลค่าทุน {formatMoney(rows.reduce((s, l) => s + l.value, 0))}</span>
            </h2>
            <div className="grid gap-2 md:grid-cols-2">
              {rows.map((l) => (
                <div key={l.lotId} className={cn("flex flex-col gap-2 rounded-xl border p-3", g.tone)} data-testid="expiry-lot">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{l.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {l.warehouseName} · {formatNumber(l.quantity)} {l.unit} · หมด {formatThaiDate(l.expiryDate)}
                        {l.lotNo ? ` · ล็อต ${l.lotNo}` : ""}
                      </p>
                    </div>
                    <span className={cn("text-right text-sm font-semibold", l.daysLeft < 0 ? "text-danger" : l.daysLeft <= 1 ? "text-danger" : "text-warning")}>
                      {l.daysLeft < 0 ? `เลย ${-l.daysLeft} วัน` : l.daysLeft === 0 ? "วันนี้" : `อีก ${l.daysLeft} วัน`}
                    </span>
                  </div>
                  {can("inventory:write") && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {l.daysLeft >= 0 &&
                        [20, 30, 50].map((pct) => (
                          <Button
                            key={pct}
                            size="sm"
                            variant={l.markdownPct === pct ? "default" : "outline"}
                            className="h-8"
                            disabled={busy === l.lotId}
                            onClick={() => void markdown(l, l.markdownPct === pct ? 0 : pct)}
                          >
                            <Tag className="size-3.5" /> {pct}%
                          </Button>
                        ))}
                      {l.markdownPct > 0 && (
                        <span className="text-xs text-success">
                          ขาย {formatMoney(l.price * (1 - l.markdownPct / 100))} (จาก {formatMoney(l.price)})
                        </span>
                      )}
                      <Button size="sm" variant="ghost" className="ml-auto h-8 text-danger" onClick={() => setWaste(l)}>
                        <Trash2 className="size-3.5" /> ทิ้ง
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}
      <Dialog open={waste !== null} onOpenChange={(o) => !o && setWaste(null)}>
        {waste && (
          <WasteDialog
            lot={waste}
            onDone={() => {
              setWaste(null);
              refresh();
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function WasteDialog({ lot, onDone }: { lot: ExpiryLot; onDone: () => void }) {
  const [qty, setQty] = useState(String(lot.quantity));
  const [reason, setReason] = useState<WasteReason>(lot.daysLeft < 0 ? "expired" : "damaged");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ value: number }>(`/inventory/expiry/lots/${lot.lotId}/waste`, { qty: Number(qty), reason });
      toast.success(`บันทึกของเสีย ${formatMoney(r.value)} แล้ว`);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogContent title={`ทิ้ง ${lot.name}`} description={`ล็อตหมดอายุ ${formatThaiDate(lot.expiryDate)} · เหลือ ${formatNumber(lot.quantity)} ${lot.unit}`} className="max-w-sm">
      <div className="grid gap-3">
        <Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className="h-12 text-center text-2xl" aria-label="จำนวนที่ทิ้ง" />
        <div className="grid grid-cols-2 gap-2">
          {REASONS.map((r) => (
            <button
              key={r.value}
              onClick={() => setReason(r.value)}
              className={cn("rounded-lg border p-2 text-sm", reason === r.value ? "border-primary bg-primary-soft text-primary" : "border-border hover:bg-accent")}
            >
              {r.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">มูลค่าทุน ~{formatMoney((Number(qty) || 0) * lot.unitCost)} ลงบัญชีเป็นค่าใช้จ่ายของเสีย และระบบสั่งของรอบหน้าลดลงตามสัดส่วนที่ทิ้ง</p>
        <Button variant="danger" onClick={save} disabled={busy || !(Number(qty) > 0) || Number(qty) > lot.quantity}>
          {busy && <Loader2 className="animate-spin" />}
          ยืนยันทิ้ง
        </Button>
      </div>
    </DialogContent>
  );
}

function Waste() {
  const [month, setMonth] = useState("");
  const report = useQuery({ queryKey: ["inventory", "waste", month], queryFn: () => api.get<WasteReport>("/inventory/expiry/waste", { month: month || undefined }) });
  const d = report.data;
  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input type="month" value={month || d?.month || ""} onChange={(e) => setMonth(e.target.value)} className="h-9 w-44" aria-label="เดือน" />
        {d && (
          <p className="text-sm">
            ของเสียรวม <span className="font-semibold text-danger">{formatMoney(d.total)}</span>
          </p>
        )}
      </div>
      {report.isPending ? (
        <Skeleton className="h-40" />
      ) : report.isError ? (
        <ErrorNote onRetry={() => report.refetch()} error={report.error} />
      ) : !d?.items.length ? (
        <p className="py-10 text-center text-sm text-muted-foreground">ไม่มีของเสียในเดือนนี้ 🎉</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-cards w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">สินค้า</th>
                <th className="py-2 pr-3 font-medium">เหตุผล</th>
                <th className="py-2 pr-3 text-right font-medium">จำนวน</th>
                <th className="py-2 text-right font-medium">มูลค่าทุน</th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((i) => (
                <tr key={`${i.productId}-${i.reason}`} className="border-b border-border last:border-0">
                  <td className="py-2 pr-3">{i.name}</td>
                  <td data-label="เหตุผล" className="py-2 pr-3">
                    <Badge tone={i.reason === "expired" ? "warning" : "neutral"}>{i.reasonLabel}</Badge>
                  </td>
                  <td data-label="จำนวน" className="py-2 pr-3 text-right tabular-nums">
                    {formatNumber(i.qty)} {i.unit}
                  </td>
                  <td data-label="มูลค่าทุน" className="py-2 text-right tabular-nums">{formatMoney(i.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
