"use client";

import { Plus, Sparkles } from "lucide-react";
import type { CatalogItem, PromoSuggestion } from "@/lib/types";
import { cn, formatMoney } from "@/lib/utils";

/**
 * Up-sell hints from the cart quote: deals the customer has started but not completed
 * ("2 ชิ้น ฿39" with one piece, a coffee without its pastry). Tapping a product adds it.
 */
export function Upsell({
  suggestions,
  onAdd,
  className,
  disabled,
}: {
  suggestions: PromoSuggestion[];
  onAdd: (item: CatalogItem, qty: number) => void;
  className?: string;
  disabled?: boolean;
}) {
  if (!suggestions.length) return null;
  return (
    <div className={cn("space-y-2 rounded-xl border border-success/30 bg-success-soft/40 p-3", className)} data-testid="upsell">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-success">
        <Sparkles className="size-3.5" /> แนะนำลูกค้าซื้อเพิ่ม
      </p>
      {suggestions.map((s) => (
        <div key={s.promotionId} className="space-y-1.5">
          <p className="text-sm">
            <span className="font-medium">{s.name}</span> <span className="rounded bg-success px-1.5 py-0.5 text-[11px] font-semibold text-white">{s.label}</span>
            <span className="block text-xs text-muted-foreground">{s.message}</span>
          </p>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {s.items.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={disabled}
                onClick={() => onAdd(item, s.need)}
                className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-left text-xs hover:border-success hover:text-success disabled:opacity-50"
              >
                <Plus className="size-3.5 shrink-0" />
                <span className="max-w-36 truncate font-medium">{item.name}</span>
                <span className="tabular-nums text-muted-foreground">{formatMoney(item.price)}</span>
                {s.need > 1 && <span className="font-semibold">×{s.need}</span>}
                {!!item.saving && <span className="font-semibold text-success">−{formatMoney(item.saving)}</span>}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
