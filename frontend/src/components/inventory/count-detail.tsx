"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Loader2, ScanBarcode, Send } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { StockCountDetail, StockCountItem } from "@/lib/types";
import { cn, formatMoney, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, Skeleton } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { ScanButton } from "@/components/ui/barcode-scanner";
import { beep } from "@/components/pos/sound";
import { COUNT_STATUS } from "./counts-view";

interface ScanResult {
  item: StockCountItem;
  added: number;
  unitName: string | null;
  progress: { total: number; counted: number };
}

export function CountDetail({ id }: { id: number }) {
  const qc = useQueryClient();
  const key = ["inventory", "counts", id];
  const count = useQuery({ queryKey: key, queryFn: () => api.get<StockCountDetail>(`/inventory/counts/${id}`) });
  const [code, setCode] = useState("");
  const [step, setStep] = useState("1");
  const [last, setLast] = useState<ScanResult | null>(null);
  const [pulse, setPulse] = useState(0);
  const [tab, setTab] = useState<"todo" | "done">("todo");
  const [editing, setEditing] = useState<StockCountItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const c = count.data;
  const counting = c?.status === "counting";

  /** Returns the product name (or false) so the camera scanner can label its running list. */
  const scan = async (raw: string, qty?: number, refocus = true): Promise<string | false | undefined> => {
    const value = raw.trim();
    if (!value) return;
    try {
      const r = await api.post<ScanResult>(`/inventory/counts/${id}/scan`, { code: value, qty: qty ?? (Number(step) || 1), mode: "add" });
      setLast(r);
      setPulse((p) => p + 1);
      beep("ok");
      if ("vibrate" in navigator) navigator.vibrate(40);
      void qc.invalidateQueries({ queryKey: key });
      return `${r.item.name} +${formatNumber(r.added)}`;
    } catch (err) {
      beep("error");
      toast.error(err instanceof Error ? err.message : "สแกนไม่สำเร็จ");
      return false;
    } finally {
      setCode("");
      // Not while the camera is open: focusing the field would pop up the phone keyboard behind it
      if (refocus) inputRef.current?.focus();
    }
  };

  const setCounted = async (item: StockCountItem, counted: number | null, reason?: string) => {
    try {
      await api.patch(`/inventory/counts/${id}/items/${item.productId}`, { countedQty: counted, ...(reason !== undefined ? { reason } : {}) });
      setEditing(null);
      void qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    }
  };

  const act = async (action: "submit" | "approve" | "cancel") => {
    if (action === "cancel" && !window.confirm("ยกเลิกรอบตรวจนับนี้?")) return;
    setBusy(action);
    try {
      const r = await api.post<{ adjusted?: number; loss?: number; gain?: number }>(`/inventory/counts/${id}/${action}`);
      if (action === "approve") toast.success(`ปรับสต๊อกแล้ว ${r.adjusted} รายการ · ขาด ${formatMoney(r.loss ?? 0)} · เกิน ${formatMoney(r.gain ?? 0)}`);
      else toast.success(action === "submit" ? "ส่งให้ผู้จัดการตรวจแล้ว" : "ยกเลิกแล้ว");
      void qc.invalidateQueries({ queryKey: ["inventory"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };

  if (count.isPending) return <Skeleton className="h-[70vh] w-full rounded-xl" />;
  if (!c) return <p className="text-sm text-muted-foreground">ไม่พบรอบตรวจนับ</p>;

  const todo = c.items.filter((i) => i.counted === null);
  const done = c.items.filter((i) => i.counted !== null);
  const pct = c.total ? Math.round((c.counted / c.total) * 100) : 0;
  const review = !counting && c.canApprove && c.status === "review";
  const showVariance = c.canApprove || !c.blind || c.status !== "counting";

  return (
    <div className="mx-auto max-w-5xl pb-28">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/inventory/counts" aria-label="กลับ">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="mr-auto">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            {c.countNo} <Badge tone={COUNT_STATUS[c.status].tone}>{COUNT_STATUS[c.status].label}</Badge>
          </h1>
          <p className="text-xs text-muted-foreground">
            {c.warehouseName} · {c.scope === "full" ? "ทั้งคลัง" : `หมวด ${c.categoryName}`} {c.blind && "· ไม่เห็นยอดในระบบ"}
          </p>
        </div>
        {(counting || c.status === "review") && (c.canApprove || counting) && (
          <Button variant="ghost" size="sm" className="text-danger" onClick={() => void act("cancel")} disabled={busy !== null}>
            ยกเลิกรอบ
          </Button>
        )}
      </div>

      <Card className="mb-4 p-4">
        <div className="flex items-baseline justify-between">
          <p className="text-sm text-muted-foreground">ความคืบหน้า</p>
          <p className="text-lg font-semibold tabular-nums" data-testid="count-progress">
            {c.counted}/{c.total}
          </p>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-gradient-to-r from-primary to-success transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
        {showVariance && c.diffItems !== null && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
            <Stat label="รายการมีส่วนต่าง" value={formatNumber(c.diffItems)} />
            <Stat label="ขาด (มูลค่า)" value={formatMoney(Math.abs(c.lossValue ?? 0))} tone="danger" />
            <Stat label="เกิน (มูลค่า)" value={formatMoney(c.gainValue ?? 0)} tone="success" />
          </div>
        )}
      </Card>

      {counting && (
        <Card className="mb-4 overflow-hidden">
          <form
            className="flex gap-2 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void scan(code);
            }}
          >
            <div className="relative flex-1">
              <ScanBarcode className="absolute left-3 top-1/2 size-5 -translate-y-1/2 text-primary" />
              <Input
                ref={inputRef}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="สแกนบาร์โค้ด หรือพิมพ์รหัสแล้ว Enter"
                className="h-12 pl-10 text-base"
                aria-label="สแกนบาร์โค้ดเพื่อนับ"
                autoFocus
                inputMode="search"
              />
            </div>
            <Input value={step} onChange={(e) => setStep(e.target.value.replace(/[^\d.]/g, ""))} className="h-12 w-16 text-center text-base" aria-label="จำนวนต่อการสแกน" title="จำนวนต่อการสแกน" />
            {/* Scanners end with Enter; with two inputs, implicit submit needs a submit button */}
            <button type="submit" className="sr-only">
              นับ
            </button>
            <ScanButton mode="continuous" beep={false} title="สแกนนับด้วยกล้อง" className="size-12" onDetected={(v) => scan(v, undefined, false)} />
          </form>
          {last && (
            <div key={pulse} className="mx-3 mb-3 flex animate-[pos-flash_0.6s_ease-out] items-center gap-3 rounded-xl border border-primary/30 p-3" data-testid="last-scan">
              <CheckCircle2 className="size-8 shrink-0 text-success" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{last.item.name}</p>
                <p className="text-xs text-muted-foreground">
                  +{formatNumber(last.added)} {last.item.unit}
                  {last.unitName ? ` (สแกน${last.unitName})` : ""}
                </p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold tabular-nums">{formatNumber(last.item.counted ?? 0)}</p>
                <p className="text-[11px] text-muted-foreground">นับได้รวม</p>
              </div>
            </div>
          )}
        </Card>
      )}

      {review || (!counting && showVariance) ? (
        <VarianceTable count={c} editable={review} onReason={(i, reason) => void setCounted(i, i.counted, reason)} onEdit={setEditing} />
      ) : (
        <Card>
          <div className="grid grid-cols-2 border-b border-border p-1">
            {(["todo", "done"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cn("rounded-lg py-2 text-sm font-medium", tab === t ? "bg-primary-soft text-primary" : "text-muted-foreground")}>
                {t === "todo" ? `ยังไม่นับ (${todo.length})` : `นับแล้ว (${done.length})`}
              </button>
            ))}
          </div>
          <ul className="divide-y divide-border">
            {(tab === "todo" ? todo : done).map((i) => (
              <li key={i.productId}>
                <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/50" onClick={() => counting && setEditing(i)} disabled={!counting}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{i.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {i.barcode ?? i.sku}
                      {i.countedBy ? ` · ${i.countedBy}` : ""}
                    </span>
                  </span>
                  {i.snapshot !== null && <span className="text-xs text-muted-foreground">ระบบ {formatNumber(i.snapshot)}</span>}
                  <span className={cn("w-16 text-right text-lg font-semibold tabular-nums", i.counted === null && "text-muted-foreground")}>
                    {i.counted === null ? "–" : formatNumber(i.counted)}
                  </span>
                </button>
              </li>
            ))}
            {(tab === "todo" ? todo : done).length === 0 && <li className="py-10 text-center text-sm text-muted-foreground">{tab === "todo" ? "นับครบทุกรายการแล้ว 🎉" : "ยังไม่ได้นับ"}</li>}
          </ul>
        </Card>
      )}

      {/* Sticky action bar */}
      {(counting || review) && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 p-3 backdrop-blur lg:left-auto lg:right-6 lg:bottom-6 lg:rounded-2xl lg:border lg:shadow-lg">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <p className="flex-1 text-sm text-muted-foreground lg:hidden">
              นับแล้ว {c.counted}/{c.total}
            </p>
            {counting && (
              <Button size="lg" onClick={() => void act("submit")} disabled={busy !== null || !c.counted}>
                {busy === "submit" ? <Loader2 className="animate-spin" /> : <Send />} ส่งให้ผู้จัดการตรวจ
              </Button>
            )}
            {(review || (counting && c.canApprove)) && (
              <Button size="lg" variant={counting ? "outline" : "default"} onClick={() => void act("approve")} disabled={busy !== null || !c.counted}>
                {busy === "approve" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} อนุมัติและปรับสต๊อก
              </Button>
            )}
          </div>
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && <EditCountDialog item={editing} onSave={(n) => void setCounted(editing, n)} />}
      </Dialog>
    </div>
  );
}

function VarianceTable({
  count,
  editable,
  onReason,
  onEdit,
}: {
  count: StockCountDetail;
  editable: boolean;
  onReason: (i: StockCountItem, reason: string) => void;
  onEdit: (i: StockCountItem) => void;
}) {
  const rows = [...count.items].sort((a, b) => Math.abs(b.value ?? 0) - Math.abs(a.value ?? 0));
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="table-cards w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">สินค้า</th>
              <th className="px-4 py-3 text-right font-medium">ในระบบ</th>
              <th className="px-4 py-3 text-right font-medium">ขาย/รับระหว่างนับ</th>
              <th className="px-4 py-3 text-right font-medium">นับได้</th>
              <th className="px-4 py-3 text-right font-medium">ส่วนต่าง</th>
              <th className="px-4 py-3 text-right font-medium">มูลค่า</th>
              <th className="px-4 py-3 font-medium">เหตุผล</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.productId} className={cn("border-b border-border last:border-0", i.needsReason && "bg-warning-soft/40")}>
                <td className="px-4 py-2.5">
                  <p className="font-medium">{i.name}</p>
                  <p className="text-xs text-muted-foreground">{i.sku}</p>
                </td>
                <td data-label="ในระบบ" className="px-4 py-2.5 text-right tabular-nums">{formatNumber(i.snapshot ?? 0)}</td>
                <td data-label="ขาย/รับระหว่างนับ" className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{i.movedDuringCount ? (i.movedDuringCount > 0 ? "+" : "") + formatNumber(i.movedDuringCount) : "–"}</td>
                <td data-label="นับได้" className="px-4 py-2.5 text-right tabular-nums">
                  {editable ? (
                    <button className="underline decoration-dotted" onClick={() => onEdit(i)}>
                      {i.counted === null ? "ยังไม่นับ" : formatNumber(i.counted)}
                    </button>
                  ) : i.counted === null ? (
                    <span className="text-muted-foreground">ยังไม่นับ</span>
                  ) : (
                    formatNumber(i.counted)
                  )}
                </td>
                <td data-label="ส่วนต่าง" className={cn("px-4 py-2.5 text-right font-semibold tabular-nums", (i.variance ?? 0) < 0 ? "text-danger" : (i.variance ?? 0) > 0 ? "text-success" : "")}>
                  {i.variance === null ? "–" : (i.variance > 0 ? "+" : "") + formatNumber(i.variance)}
                </td>
                <td data-label="มูลค่า" className="px-4 py-2.5 text-right tabular-nums">{i.value ? formatMoney(i.value) : "–"}</td>
                <td data-label="เหตุผล" className="px-4 py-2.5">
                  {editable && i.variance ? (
                    <Input
                      defaultValue={i.reason ?? ""}
                      placeholder={i.needsReason ? "จำเป็น: เช่น ชำรุด สูญหาย" : "เหตุผล"}
                      onBlur={(e) => e.target.value !== (i.reason ?? "") && onReason(i, e.target.value)}
                      className={cn("h-8 min-w-40", i.needsReason && "border-warning")}
                      aria-label={`เหตุผลส่วนต่าง ${i.name}`}
                    />
                  ) : (
                    <span className="text-muted-foreground">{i.reason ?? ""}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && <p className="p-4 text-xs text-muted-foreground">รายการที่ยังไม่นับจะไม่ถูกปรับยอด · ส่วนต่างเกิน 10% ต้องใส่เหตุผลก่อนอนุมัติ · การอนุมัติลงบัญชีสินค้าขาด/เกินให้อัตโนมัติ</p>}
    </Card>
  );
}

function EditCountDialog({ item, onSave }: { item: StockCountItem; onSave: (n: number | null) => void }) {
  const [v, setV] = useState(item.counted === null ? "" : String(item.counted));
  return (
    <DialogContent title={item.name} description={item.barcode ?? item.sku} className="max-w-sm">
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(v === "" ? null : Number(v));
        }}
      >
        <Input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} className="h-14 text-center text-3xl font-semibold" autoFocus onFocus={(e) => e.target.select()} aria-label="จำนวนที่นับได้" />
        <div className="grid grid-cols-4 gap-2">
          {[1, 5, 10, 12].map((n) => (
            <Button key={n} type="button" variant="outline" onClick={() => setV(String((Number(v) || 0) + n))}>
              +{n}
            </Button>
          ))}
        </div>
        <Button type="submit">บันทึกจำนวน {item.unit}</Button>
      </form>
    </DialogContent>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "danger" | "success" }) {
  return (
    <div className="rounded-lg bg-muted px-2 py-2">
      <p className={cn("font-semibold tabular-nums", tone === "danger" && "text-danger", tone === "success" && "text-success")}>{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
