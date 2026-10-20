"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Category } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";
import { CATEGORIES_KEY } from "./product-form";

interface Rule {
  age: boolean;
  block: boolean;
  from: string;
  to: string;
  label: string;
}

/** Per-category rules enforced at the till: no-sale hours (e.g. alcohol) and the age 20+ check. */
export function CategoryRulesDialog({ categories, onDone }: { categories: Category[]; onDone: () => void }) {
  const qc = useQueryClient();
  const [rules, setRules] = useState<Record<number, Rule>>(() =>
    Object.fromEntries(
      categories.map((c) => [
        c.id,
        { age: c.ageRestricted, block: !!c.saleBlock, from: c.saleBlock?.from ?? "00:00", to: c.saleBlock?.to ?? "11:00", label: c.saleBlock?.label ?? "" },
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const set = (id: number, patch: Partial<Rule>) => setRules((r) => ({ ...r, [id]: { ...r[id], ...patch } }));

  const save = async () => {
    setBusy(true);
    try {
      for (const c of categories) {
        const r = rules[c.id];
        const changed = r.age !== c.ageRestricted || r.block !== !!c.saleBlock || (r.block && (r.from !== c.saleBlock?.from || r.to !== c.saleBlock?.to || r.label !== (c.saleBlock?.label ?? "")));
        if (!changed) continue;
        await api.patch(`/products/categories/${c.id}`, {
          ageRestricted: r.age,
          saleBlock: r.block ? { from: r.from, to: r.to, label: r.label || undefined } : null,
        });
      }
      await qc.invalidateQueries({ queryKey: CATEGORIES_KEY });
      void qc.invalidateQueries({ queryKey: ["pos", "catalog"] });
      toast.success("บันทึกกฎการขายแล้ว");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent title="กฎการขายตามหมวด" description="เช่น เครื่องดื่มแอลกอฮอล์: ยืนยันอายุ 20+ และงดขาย 00:00–11:00" className="max-w-2xl">
      <ul className="max-h-[60dvh] space-y-2 overflow-y-auto">
        {categories.map((c) => {
          const r = rules[c.id];
          return (
            <li key={c.id} className="rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="min-w-28 flex-1 font-medium">{c.name}</span>
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={r.age} onChange={(e) => set(c.id, { age: e.target.checked })} /> ต้องยืนยันอายุ 20+
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={r.block} onChange={(e) => set(c.id, { block: e.target.checked })} /> งดขายช่วงเวลา
                </label>
              </div>
              {r.block && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <Input type="time" value={r.from} onChange={(e) => set(c.id, { from: e.target.value })} className="h-9 w-28" aria-label={`${c.name} เริ่มงดขาย`} />
                  ถึง
                  <Input type="time" value={r.to} onChange={(e) => set(c.id, { to: e.target.value })} className="h-9 w-28" aria-label={`${c.name} สิ้นสุดงดขาย`} />
                  <Input value={r.label} onChange={(e) => set(c.id, { label: e.target.value })} placeholder="ข้อความ เช่น ตามกฎหมายควบคุมเครื่องดื่มแอลกอฮอล์" className="h-9 min-w-48 flex-1" />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Button className="mt-4 w-full" onClick={save} disabled={busy}>
        {busy && <Loader2 className="animate-spin" />}
        บันทึก
      </Button>
    </DialogContent>
  );
}
