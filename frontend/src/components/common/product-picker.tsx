"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { api } from "@/lib/api";
import type { Product } from "@/lib/types";
import { Input } from "@/components/ui/primitives";
import { ScanButton } from "@/components/ui/barcode-scanner";
import { cn, formatNumber } from "@/lib/utils";

/** Search-as-you-type product selector used by inventory dialogs. */
export function ProductPicker({ onPick, exclude = [] }: { onPick: (p: Product) => void; exclude?: number[] }) {
  const [q, setQ] = useState("");
  const { data, isFetching } = useQuery({
    queryKey: ["products", "picker", q],
    queryFn: () => api.get<Product[]>("/products", { q, pageSize: 8, status: "active" }),
    enabled: q.trim().length > 0,
    staleTime: 10_000,
  });
  const results = (data ?? []).filter((p) => !exclude.includes(p.id));

  /** Camera scan: pick straight away on an exact barcode/SKU match, otherwise show the matches as a search. */
  const onScan = async (code: string) => {
    try {
      const found = await api.get<Product[]>("/products", { q: code, pageSize: 8, status: "active" });
      const exact = found.filter((p) => !exclude.includes(p.id) && (p.barcode === code || p.sku === code));
      if (exact.length === 1) {
        onPick(exact[0]);
        setQ("");
        return;
      }
    } catch {
      // fall through to a normal search
    }
    setQ(code);
  };

  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="พิมพ์ชื่อสินค้า / รหัสสินค้า / บาร์โค้ด"
            className="h-11 pl-9"
            aria-label="ค้นหาสินค้า"
          />
        </div>
        <ScanButton title="สแกนบาร์โค้ดเพื่อเลือกสินค้า" onDetected={(code) => void onScan(code)} />
      </div>
      {q.trim() && (
        <ul className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-card shadow-sm">
          {results.length === 0 && (
            <li className="px-3 py-2.5 text-sm text-muted-foreground">{isFetching ? "กำลังค้นหา..." : "ไม่พบสินค้า"}</li>
          )}
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(p);
                  setQ("");
                }}
                className={cn("flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent")}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{p.sku}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">คงเหลือ {formatNumber(p.onHand)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
