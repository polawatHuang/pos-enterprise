"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Product, PurchaseRequest, Supplier, Warehouse } from "@/lib/types";
import { formatMoney, formatNumber, formatThaiDate } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Input, Label, NativeSelect, Skeleton, Textarea } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { ProductPicker } from "@/components/common/product-picker";
import { ErrorNote } from "@/components/dashboard/widgets";

export const PR_STATUS: Record<PurchaseRequest["status"], { label: string; tone: "warning" | "success" | "danger" | "neutral" }> = {
  pending: { label: "รออนุมัติ", tone: "warning" },
  approved: { label: "อนุมัติแล้ว", tone: "success" },
  rejected: { label: "ไม่อนุมัติ", tone: "danger" },
  cancelled: { label: "ยกเลิก", tone: "neutral" },
};

const KEY = ["purchasing", "requests"] as const;

/** ใบขอซื้อ: anyone who sees the stock asks; a manager approves (a PO draft is made) or rejects. */
export function RequestsList() {
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: KEY, queryFn: () => api.get<PurchaseRequest[]>("/purchasing/requests") });
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: KEY });
    void qc.invalidateQueries({ queryKey: ["purchasing", "orders"] });
    void qc.invalidateQueries({ queryKey: ["documents-hub"] });
  };

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">พนักงานขอซื้อของที่ใกล้หมด ผู้จัดการอนุมัติแล้วระบบสร้างใบสั่งซื้อ (ร่าง) ให้</p>
        <Button onClick={() => setCreating(true)}>
          <Plus /> ขอซื้อ
        </Button>
      </div>
      {list.isPending ? (
        <Skeleton className="h-40" />
      ) : list.isError ? (
        <ErrorNote onRetry={() => list.refetch()} error={list.error} />
      ) : !list.data?.length ? (
        <p className="py-10 text-center text-sm text-muted-foreground">ยังไม่มีใบขอซื้อ</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-cards w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">เลขที่</th>
                <th className="px-3 py-2.5 font-medium">ผู้ขอ</th>
                <th className="px-3 py-2.5 font-medium">คลัง / ผู้ขาย</th>
                <th className="px-3 py-2.5 font-medium">ต้องการภายใน</th>
                <th className="px-3 py-2.5 text-right font-medium">ประมาณการ</th>
                <th className="px-3 py-2.5 font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((r) => (
                <tr key={r.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/40" onClick={() => setOpen(r.id)}>
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-primary">{r.prNo}</span>
                    <span className="block text-xs text-muted-foreground">{r.itemCount} รายการ</span>
                  </td>
                  <td data-label="ผู้ขอ" className="px-3 py-2.5">
                    {r.requestedBy ?? "-"}
                  </td>
                  <td data-label="คลัง / ผู้ขาย" className="px-3 py-2.5">
                    {r.warehouseName}
                    {r.supplierName && <span className="block text-xs text-muted-foreground">{r.supplierName}</span>}
                  </td>
                  <td data-label="ต้องการภายใน" className="px-3 py-2.5 text-muted-foreground">
                    {r.neededBy ? formatThaiDate(r.neededBy) : "-"}
                  </td>
                  <td data-label="ประมาณการ" className="px-3 py-2.5 text-right tabular-nums">
                    {formatMoney(r.estTotal)}
                  </td>
                  <td data-label="สถานะ" className="px-3 py-2.5">
                    <Badge tone={PR_STATUS[r.status].tone}>{PR_STATUS[r.status].label}</Badge>
                    {r.poNo && <span className="ml-1.5 text-xs text-muted-foreground">→ {r.poNo}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        {creating && (
          <NewRequestDialog
            onDone={() => {
              setCreating(false);
              refresh();
            }}
          />
        )}
      </Dialog>
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        {open !== null && (
          <RequestDialog id={open} canDecide={can("purchasing:write")} userId={user?.id ?? 0} onChanged={refresh} onClose={() => setOpen(null)} />
        )}
      </Dialog>
    </div>
  );
}

function useLists() {
  const warehouses = useQuery({ queryKey: ["inventory", "warehouses"], queryFn: () => api.get<Warehouse[]>("/inventory/warehouses") });
  const suppliers = useQuery({ queryKey: ["purchasing", "suppliers"], queryFn: () => api.get<Supplier[]>("/purchasing/suppliers") });
  return { warehouses: warehouses.data ?? [], suppliers: suppliers.data ?? [] };
}

function NewRequestDialog({ onDone }: { onDone: () => void }) {
  const { warehouses, suppliers } = useLists();
  const [warehouseId, setWarehouseId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<{ product: Product; quantity: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const wh = warehouseId || String(warehouses[0]?.id ?? "");
  const valid = !!wh && lines.length > 0 && lines.every((l) => Number(l.quantity) > 0);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post<PurchaseRequest>("/purchasing/requests", {
        warehouseId: Number(wh),
        supplierId: supplierId ? Number(supplierId) : null,
        neededBy: neededBy || null,
        reason: reason || null,
        items: lines.map((l) => ({ productId: l.product.id, quantity: Number(l.quantity) })),
      });
      toast.success(`ส่งใบขอซื้อ ${r.prNo} แล้ว — รอผู้จัดการอนุมัติ`);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ส่งใบขอซื้อไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent title="ขอซื้อสินค้า" description="ผู้จัดการจะเห็นในแท็บใบขอซื้อ และอนุมัติเป็นใบสั่งซื้อ" className="max-w-xl">
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pr-wh">เข้าคลัง</Label>
            <NativeSelect id="pr-wh" className="h-10 w-full" value={wh} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pr-sup">ผู้ขายที่แนะนำ (ไม่บังคับ)</Label>
            <NativeSelect id="pr-sup" className="h-10 w-full" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">ไม่ระบุ</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pr-need">ต้องการภายในวันที่</Label>
            <Input id="pr-need" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pr-reason">เหตุผล</Label>
            <Input id="pr-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ของใกล้หมด ลูกค้าสั่งจอง" />
          </div>
        </div>
        <ProductPicker exclude={lines.map((l) => l.product.id)} onPick={(p) => setLines((ls) => [...ls, { product: p, quantity: "1" }])} />
        {lines.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {lines.map((l, i) => (
              <li key={l.product.id} className="flex items-center gap-3 p-3 text-sm">
                <span className="min-w-0 flex-1 truncate">{l.product.name}</span>
                <Input
                  aria-label={`จำนวน ${l.product.name}`}
                  inputMode="decimal"
                  className="h-10 w-24 text-right"
                  value={l.quantity}
                  onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                />
                <span className="w-10 text-xs text-muted-foreground">{l.product.unit}</span>
                <button
                  type="button"
                  aria-label="ลบรายการ"
                  className="grid size-9 place-items-center rounded-md hover:bg-muted"
                  onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button onClick={() => void submit()} disabled={!valid || busy}>
          {busy && <Loader2 className="animate-spin" />} ส่งใบขอซื้อ
        </Button>
      </div>
    </DialogContent>
  );
}

function RequestDialog({
  id,
  canDecide,
  userId,
  onChanged,
  onClose,
}: {
  id: number;
  canDecide: boolean;
  userId: number;
  onChanged: () => void;
  onClose: () => void;
}) {
  const q = useQuery({ queryKey: [...KEY, id], queryFn: () => api.get<PurchaseRequest>(`/purchasing/requests/${id}`) });
  const { suppliers } = useLists();
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const r = q.data;

  const act = async (what: "approve" | "reject" | "cancel") => {
    setBusy(true);
    try {
      const body =
        what === "approve"
          ? { supplierId: (supplierId ?? String(r?.supplierId ?? "")) ? Number(supplierId ?? r?.supplierId) : null }
          : what === "reject"
            ? { reason }
            : {};
      const res = await api.post<PurchaseRequest>(`/purchasing/requests/${id}/${what}`, body);
      toast.success(what === "approve" ? `อนุมัติแล้ว — สร้างใบสั่งซื้อ ${res.poNo} (ร่าง)` : what === "reject" ? "ไม่อนุมัติแล้ว" : "ยกเลิกแล้ว");
      onChanged();
      void q.refetch();
      if (what !== "approve") onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent title={r ? `ใบขอซื้อ ${r.prNo}` : "ใบขอซื้อ"} className="max-w-xl">
      {!r ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="grid gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={PR_STATUS[r.status].tone}>{PR_STATUS[r.status].label}</Badge>
            <span className="text-muted-foreground">
              {r.requestedBy} · {formatThaiDate(r.requestedAt.slice(0, 10))} · เข้า{r.warehouseName}
            </span>
          </div>
          {r.reason && <p>เหตุผล: {r.reason}</p>}
          {r.rejectReason && <p className="text-danger">ไม่อนุมัติเพราะ: {r.rejectReason}</p>}
          <ul className="divide-y divide-border rounded-lg border border-border">
            {r.items?.map((i) => (
              <li key={i.productId} className="flex items-center justify-between gap-3 p-3">
                <span className="min-w-0">
                  <span className="block truncate">{i.name}</span>
                  <span className="text-xs text-muted-foreground">
                    คงเหลือในคลัง {formatNumber(i.onHand)} {i.unit}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatNumber(i.quantity)} {i.unit} · {formatMoney(i.quantity * i.estUnitCost)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-right font-medium">ประมาณการ {formatMoney(r.estTotal)}</p>
          {r.purchaseOrderId && (
            <Link href={`/purchasing/orders/${r.purchaseOrderId}`} className="text-primary hover:underline">
              เปิดใบสั่งซื้อ {r.poNo} →
            </Link>
          )}
          {r.status === "pending" && canDecide && !rejecting && (
            <div className="grid gap-2 rounded-lg bg-muted p-3">
              <Label htmlFor="pr-approve-sup">สั่งจากผู้ขาย</Label>
              <NativeSelect
                id="pr-approve-sup"
                className="h-10 w-full"
                value={supplierId ?? String(r.supplierId ?? "")}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">ยังไม่ระบุ (เลือกทีหลังในใบสั่งซื้อ)</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => setRejecting(true)} disabled={busy}>
                  <X /> ไม่อนุมัติ
                </Button>
                <Button onClick={() => void act("approve")} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <Check />} อนุมัติ → ใบสั่งซื้อ
                </Button>
              </div>
            </div>
          )}
          {rejecting && (
            <div className="grid gap-2">
              <Label htmlFor="pr-reject">เหตุผลที่ไม่อนุมัติ</Label>
              <Textarea id="pr-reject" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
              <Button variant="danger" onClick={() => void act("reject")} disabled={busy || !reason.trim()}>
                ยืนยันไม่อนุมัติ
              </Button>
            </div>
          )}
          {r.status === "pending" && (r.requestedById === userId || canDecide) && !rejecting && (
            <Button variant="ghost" className="text-danger" onClick={() => void act("cancel")} disabled={busy}>
              ยกเลิกใบขอซื้อ
            </Button>
          )}
        </div>
      )}
    </DialogContent>
  );
}
