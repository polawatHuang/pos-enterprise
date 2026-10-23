"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, PauseCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { HeldBill } from "@/lib/types";
import { formatMoney, formatRelativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DialogContent } from "@/components/ui/overlays";

export const HELD_KEY = ["pos", "held"] as const;

export function HeldDialog({ onRecall }: { onRecall: (b: HeldBill) => void }) {
  const qc = useQueryClient();
  const held = useQuery({ queryKey: HELD_KEY, queryFn: () => api.get<HeldBill[]>("/pos/held") });
  const [removing, setRemoving] = useState<number | null>(null);
  // A held bill has no effect on stock or money: discarding it simply deletes it
  const discard = async (b: HeldBill, name: string) => {
    if (!window.confirm(`ลบ "${name}" ทิ้ง? (ยกเลิกไม่ได้)`)) return;
    setRemoving(b.id);
    try {
      await api.del(`/pos/held/${b.id}`);
      toast.success("ลบบิลที่พักไว้แล้ว");
      await qc.invalidateQueries({ queryKey: HELD_KEY });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
    } finally {
      setRemoving(null);
    }
  };
  return (
    <DialogContent title="บิลที่พักไว้" description="เรียกบิลกลับมาขายต่อ (บิลจะถูกนำออกจากรายการนี้)" className="max-w-md">
      {held.isPending ? (
        <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
      ) : held.data?.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">ไม่มีบิลที่พักไว้</p>
      ) : (
        <ul className="space-y-2">
          {held.data?.map((b, i) => (
            <li key={b.id} className="flex items-stretch gap-1.5">
              <button
                onClick={() => onRecall(b)}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-border p-3 text-left hover:border-primary hover:bg-primary-soft/40"
              >
                <span className="grid size-9 place-items-center rounded-full bg-warning-soft text-warning">
                  <PauseCircle className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{b.label || `บิลพัก #${i + 1}`}</span>
                  <span className="text-xs text-muted-foreground">
                    {b.cart.items.length} รายการ · {b.userName} · {formatRelativeTime(b.createdAt)}
                    {b.customerName ? ` · ${b.customerName}` : ""}
                  </span>
                </span>
                <span className="font-semibold tabular-nums">{formatMoney(b.total)}</span>
              </button>
              <Button
                variant="outline"
                className="h-auto min-h-10 w-11 shrink-0 px-0 text-danger"
                aria-label="ลบบิลที่พักไว้"
                title="ลบ"
                disabled={removing === b.id}
                onClick={() => void discard(b, b.label || `บิลพัก #${i + 1}`)}
              >
                {removing === b.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </DialogContent>
  );
}
