"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Loader2, Printer, Search, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { PosOrder, PosOrderRow } from "@/lib/types";
import { formatDateTime, formatMoney } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Input } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";
import { METHOD_LABEL } from "./receipt";
import { ReturnView } from "./return-view";
import { SHIFT_KEY } from "./shift";

function StatusBadge({ b }: { b: PosOrderRow }) {
  if (b.status === "cancelled") return <Badge tone="danger">ยกเลิก</Badge>;
  if (b.status === "refunded") return <Badge tone="warning">คืนทั้งบิล</Badge>;
  if (b.refundedAmount > 0) return <Badge tone="warning">คืนบางส่วน {formatMoney(b.refundedAmount)}</Badge>;
  return <Badge tone="success">สำเร็จ</Badge>;
}

export function BillsDialog({ onReprint }: { onReprint: (o: PosOrder) => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const query = q.trim();
  const bills = useQuery({
    queryKey: ["pos", "orders", query],
    queryFn: () => api.get<PosOrderRow[]>("/pos/orders", { scope: "shift", q: query.length >= 3 ? query : undefined, limit: 50 }),
  });
  const [voiding, setVoiding] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [returning, setReturning] = useState<PosOrder | null>(null);

  const reprint = async (id: number) => onReprint(await api.get<PosOrder>(`/pos/orders/${id}`));
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["pos"] });
    void qc.invalidateQueries({ queryKey: SHIFT_KEY });
    void qc.invalidateQueries({ queryKey: ["inventory"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const startReturn = async (id: number) => {
    try {
      setReturning(await api.get<PosOrder>(`/pos/orders/${id}`));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เปิดบิลไม่สำเร็จ");
    }
  };

  const doVoid = async (id: number) => {
    setBusy(true);
    try {
      await api.post(`/pos/orders/${id}/void`, { reason });
      toast.success("ยกเลิกบิลและคืนสต๊อกแล้ว");
      setVoiding(null);
      setReason("");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ยกเลิกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  if (returning) {
    return (
      <DialogContent title="คืนสินค้า / คืนเงิน" className="max-w-2xl">
        <ReturnView
          order={returning}
          onBack={() => setReturning(null)}
          onDone={(r) => {
            refresh();
            setReturning(null);
            onReprint(r.order);
          }}
        />
      </DialogContent>
    );
  }

  return (
    <DialogContent title={query.length >= 3 ? "ค้นหาบิล" : "บิลในกะนี้"} className="max-w-2xl">
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาเลขที่บิล (บิลวันก่อนๆ ก็ได้) เช่น POS2610" className="pl-9" />
      </div>
      {bills.isPending ? (
        <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
      ) : bills.data?.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{query.length >= 3 ? "ไม่พบบิลที่ค้นหา" : "ยังไม่มีบิลในกะนี้"}</p>
      ) : (
        <ul className="divide-y divide-border">
          {bills.data?.map((b) => (
            <li key={b.id} className="py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-medium">{b.orderNo}</span>
                <StatusBadge b={b} />
                <span className="text-muted-foreground">
                  {formatDateTime(b.orderedAt)} · {b.items} ชิ้น · {METHOD_LABEL[b.method ?? ""] ?? b.method}
                </span>
                <span className="ml-auto font-semibold tabular-nums">{formatMoney(b.total)}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => void reprint(b.id)}>
                  <Printer /> พิมพ์ซ้ำ
                </Button>
                {can("pos:manage") && b.status === "completed" && (
                  <Button variant="outline" size="sm" onClick={() => void startReturn(b.id)}>
                    <Undo2 /> คืนสินค้า
                  </Button>
                )}
                {can("pos:manage") && b.status === "completed" && b.refundedAmount === 0 && (
                  <Button variant="ghost" size="sm" className="text-danger" onClick={() => setVoiding(voiding === b.id ? null : b.id)}>
                    <Ban /> ยกเลิกบิล
                  </Button>
                )}
              </div>
              {voiding === b.id && (
                <div className="mt-2 flex gap-2">
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผลที่ยกเลิก" className="h-9" autoFocus />
                  <Button variant="danger" size="sm" className="h-9" disabled={!reason.trim() || busy} onClick={() => void doVoid(b.id)}>
                    ยืนยัน
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {!can("pos:manage") && <p className="mt-3 text-xs text-muted-foreground">การยกเลิกบิลและคืนสินค้าต้องให้ผู้จัดการทำ (สิทธิ์ pos:manage)</p>}
    </DialogContent>
  );
}
