"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, PauseCircle } from "lucide-react";
import { api } from "@/lib/api";
import type { HeldBill } from "@/lib/types";
import { formatMoney, formatRelativeTime } from "@/lib/utils";
import { DialogContent } from "@/components/ui/overlays";

export const HELD_KEY = ["pos", "held"] as const;

export function HeldDialog({ onRecall }: { onRecall: (b: HeldBill) => void }) {
  const held = useQuery({ queryKey: HELD_KEY, queryFn: () => api.get<HeldBill[]>("/pos/held") });
  return (
    <DialogContent title="บิลที่พักไว้" description="เรียกบิลกลับมาขายต่อ (บิลจะถูกนำออกจากรายการนี้)" className="max-w-md">
      {held.isPending ? (
        <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
      ) : held.data?.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">ไม่มีบิลที่พักไว้</p>
      ) : (
        <ul className="space-y-2">
          {held.data?.map((b, i) => (
            <li key={b.id}>
              <button onClick={() => onRecall(b)} className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left hover:border-primary hover:bg-primary-soft/40">
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
            </li>
          ))}
        </ul>
      )}
    </DialogContent>
  );
}
