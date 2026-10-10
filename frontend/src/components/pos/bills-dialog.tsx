"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { PosOrder, PosOrderRow } from "@/lib/types";
import { formatDateTime, formatMoney } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Input } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";
import { METHOD_LABEL } from "./receipt";
import { SHIFT_KEY } from "./shift";

export function BillsDialog({ onReprint }: { onReprint: (o: PosOrder) => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const bills = useQuery({ queryKey: ["pos", "orders"], queryFn: () => api.get<PosOrderRow[]>("/pos/orders", { scope: "shift", limit: 50 }) });
  const [voiding, setVoiding] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const reprint = async (id: number) => onReprint(await api.get<PosOrder>(`/pos/orders/${id}`));

  const doVoid = async (id: number) => {
    setBusy(true);
    try {
      await api.post(`/pos/orders/${id}/void`, { reason });
      toast.success("ยกเลิกบิลและคืนสต๊อกแล้ว");
      setVoiding(null);
      setReason("");
      void qc.invalidateQueries({ queryKey: ["pos"] });
      void qc.invalidateQueries({ queryKey: SHIFT_KEY });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ยกเลิกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent title="บิลในกะนี้" className="max-w-2xl">
      {bills.isPending ? (
        <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
      ) : bills.data?.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">ยังไม่มีบิลในกะนี้</p>
      ) : (
        <ul className="divide-y divide-border">
          {bills.data?.map((b) => (
            <li key={b.id} className="py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-medium">{b.orderNo}</span>
                {b.status === "cancelled" ? <Badge tone="danger">ยกเลิก</Badge> : <Badge tone="success">สำเร็จ</Badge>}
                <span className="text-muted-foreground">
                  {formatDateTime(b.orderedAt)} · {b.items} ชิ้น · {METHOD_LABEL[b.method ?? ""] ?? b.method}
                </span>
                <span className="ml-auto font-semibold tabular-nums">{formatMoney(b.total)}</span>
              </div>
              <div className="mt-2 flex gap-2">
                <Button variant="outline" size="sm" onClick={() => void reprint(b.id)}>
                  <Printer /> พิมพ์ซ้ำ
                </Button>
                {can("pos:manage") && b.status === "completed" && (
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
      {!can("pos:manage") && <p className="mt-3 text-xs text-muted-foreground">การยกเลิกบิลต้องให้ผู้จัดการทำ (สิทธิ์ pos:manage)</p>}
    </DialogContent>
  );
}
