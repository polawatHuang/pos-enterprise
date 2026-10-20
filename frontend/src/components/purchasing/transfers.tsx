"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, Truck } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { StockTransfer } from "@/lib/types";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Input, Skeleton } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { TRANSFER_STATUS } from "./labels";

/** Branch transfers: shipped stock is "in transit" until the destination counts what arrived. */
export function TransfersList() {
  const transfers = useQuery({ queryKey: ["purchasing", "transfers"], queryFn: () => api.get<StockTransfer[]>("/purchasing/transfers") });
  const [open, setOpen] = useState<number | null>(null);
  if (transfers.isPending) return <Skeleton className="m-4 h-48" />;
  return (
    <>
      {!transfers.data?.length ? (
        <p className="p-12 text-center text-sm text-muted-foreground">ยังไม่มีใบโอน — สร้างได้จากปุ่ม &quot;โอนย้าย&quot; ในหน้าสต๊อก</p>
      ) : (
        <ul className="divide-y divide-border">
          {transfers.data.map((t) => (
            <li key={t.id}>
              <button className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-muted/40" onClick={() => setOpen(t.id)}>
                <Truck className="size-5 text-muted-foreground" />
                <span className="font-medium">{t.transferNo}</span>
                <span className="flex items-center gap-1.5 text-sm">
                  {t.fromName} <ArrowRight className="size-3.5" /> {t.toName}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t.itemCount} รายการ · {formatDateTime(t.shippedAt)}
                </span>
                {!!t.shortage && <Badge tone="danger">ขาด {formatNumber(t.shortage)}</Badge>}
                <Badge tone={TRANSFER_STATUS[t.status].tone} className="ml-auto">
                  {TRANSFER_STATUS[t.status].label}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        {open !== null && <TransferDialog id={open} onDone={() => setOpen(null)} />}
      </Dialog>
    </>
  );
}

function TransferDialog({ id, onDone }: { id: number; onDone: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const t = useQuery({ queryKey: ["purchasing", "transfers", id], queryFn: () => api.get<StockTransfer>(`/purchasing/transfers/${id}`) });
  const [got, setGot] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const d = t.data;
  const act = async (what: "receive" | "cancel") => {
    if (!d) return;
    setBusy(true);
    try {
      if (what === "receive") {
        await api.post(`/purchasing/transfers/${id}/receive`, {
          items: (d.items ?? []).map((i) => ({ productId: i.productId, quantity: got[i.productId] === undefined ? i.qtySent : Number(got[i.productId]) || 0 })),
        });
        toast.success("รับของเข้าคลังปลายทางแล้ว");
      } else {
        await api.post(`/purchasing/transfers/${id}/cancel`);
        toast.success("ยกเลิกใบโอน คืนของเข้าคลังต้นทางแล้ว");
      }
      void qc.invalidateQueries({ queryKey: ["purchasing"] });
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogContent title={d ? `${d.transferNo} · ${d.fromName} → ${d.toName}` : "ใบโอน"} description={d?.note ?? undefined} className="max-w-lg">
      {!d ? (
        <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
      ) : (
        <>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {d.items?.map((i) => (
              <li key={i.productId} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{i.name}</span>
                <span className="text-muted-foreground">ส่ง {formatNumber(i.qtySent)}</span>
                {d.status === "in_transit" ? (
                  <Input
                    value={got[i.productId] ?? ""}
                    onChange={(e) => setGot((g) => ({ ...g, [i.productId]: e.target.value.replace(/[^\d.]/g, "") }))}
                    placeholder={String(i.qtySent)}
                    className="h-8 w-20 text-right"
                    aria-label={`รับจริง ${i.name}`}
                  />
                ) : (
                  <span className={i.qtyReceived !== null && i.qtyReceived < i.qtySent ? "font-medium text-danger" : "font-medium"}>
                    รับ {i.qtyReceived === null ? "–" : formatNumber(i.qtyReceived)}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {d.status === "in_transit" && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              {can("purchasing:write") && (
                <Button variant="outline" className="text-danger" onClick={() => void act("cancel")} disabled={busy}>
                  ยกเลิก คืนต้นทาง
                </Button>
              )}
              <Button onClick={() => void act("receive")} disabled={busy} className={can("purchasing:write") ? "" : "col-span-2"}>
                {busy && <Loader2 className="animate-spin" />}
                ยืนยันรับของ
              </Button>
              <p className="col-span-2 text-xs text-muted-foreground">ช่องว่าง = มาครบตามที่ส่ง · ใส่จำนวนจริงถ้าของขาด</p>
            </div>
          )}
        </>
      )}
    </DialogContent>
  );
}
