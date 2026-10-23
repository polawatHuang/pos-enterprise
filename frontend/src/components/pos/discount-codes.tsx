"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, TicketPercent, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { DiscountCode } from "@/lib/types";
import { cn, formatDateTime, formatMoney, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Input, Label, Segmented } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";
import { r2 } from "./cart";

export const CODES_KEY = ["pos", "discount-codes"] as const;

/** Baht the code takes off `subtotal` (after line discounts) — same rule as the backend. */
export const codeAmount = (c: DiscountCode, subtotal: number) => r2(Math.min(subtotal, c.type === "percent" ? (subtotal * c.value) / 100 : c.value));

/** Why the code cannot be used on this cart right now, or null (the backend re-checks at checkout). */
export function codeProblem(c: DiscountCode, subtotal: number, memberId: number | null) {
  if (subtotal + 1e-9 < c.minSpend) return `ใช้ได้เมื่อซื้อครบ ${formatMoney(c.minSpend)} บาท`;
  if (c.customerId && memberId && c.customerId !== memberId) return "โค้ดนี้เป็นของลูกค้าคนอื่น";
  return null;
}

export const codeLabel = (c: DiscountCode) => (c.type === "percent" ? `ลด ${formatNumber(c.value)}%` : `ลด ${formatMoney(c.value)}`);

function codeStatus(c: DiscountCode): { label: string; tone: "success" | "neutral" | "danger" | "warning" } {
  if (!c.isActive) return { label: "ปิดใช้งาน", tone: "neutral" };
  if (c.expiresAt && new Date(c.expiresAt) < new Date()) return { label: "หมดอายุ", tone: "danger" };
  if (c.remaining === 0) return { label: "ใช้ครบแล้ว", tone: "warning" };
  return { label: "ใช้ได้", tone: "success" };
}

/** Manager's list of codes: create a code, see how many uses are left, switch it off. */
export function DiscountCodesDialog({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<"active" | "all">("active");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const codes = useQuery({ queryKey: [...CODES_KEY, status, q], queryFn: () => api.get<DiscountCode[]>("/pos/discount-codes", { status, q }) });

  const toggle = async (c: DiscountCode) => {
    try {
      await api.patch(`/pos/discount-codes/${c.id}`, { isActive: !c.isActive });
      toast.success(c.isActive ? `ปิดโค้ด ${c.code} แล้ว` : `เปิดโค้ด ${c.code} แล้ว`);
      void qc.invalidateQueries({ queryKey: CODES_KEY });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    }
  };

  // Only a code that was never used goes away; one with history is switched off instead (the server checks)
  const remove = async (c: DiscountCode) => {
    if (!window.confirm(`ลบโค้ด ${c.code}?`)) return;
    try {
      await api.del(`/pos/discount-codes/${c.id}`);
      toast.success(`ลบโค้ด ${c.code} แล้ว`);
      void qc.invalidateQueries({ queryKey: CODES_KEY });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
    }
  };

  return (
    <DialogContent title="โค้ดส่วนลด" description="ลูกค้ากรอกหรือแจ้งโค้ดที่หน้าร้าน — ระบบตรวจยอดขั้นต่ำ วันหมดอายุ และจำนวนครั้งให้เอง" className="max-w-2xl">
      {creating ? (
        <CodeForm
          onDone={(c) => {
            setCreating(false);
            if (c) {
              setStatus("active");
              setQ("");
              void qc.invalidateQueries({ queryKey: CODES_KEY });
            }
          }}
        />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Segmented
              label="สถานะ"
              value={status}
              onChange={setStatus}
              options={[
                { value: "active", label: "ใช้ได้" },
                { value: "all", label: "ทั้งหมด" },
              ]}
            />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาโค้ด" className="h-9 min-w-0 flex-1 basis-32" />
            {canManage && (
              <Button size="sm" className="h-9" onClick={() => setCreating(true)}>
                <Plus /> สร้างโค้ด
              </Button>
            )}
          </div>
          {codes.isPending ? (
            <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
          ) : !codes.data?.length ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <TicketPercent className="mx-auto mb-2 size-8 opacity-50" />
              {status === "active" ? "ยังไม่มีโค้ดที่ใช้ได้" : "ยังไม่มีโค้ด"}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {codes.data.map((c) => {
                const st = codeStatus(c);
                return (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm">
                    <span className="rounded-md border border-dashed border-primary/50 bg-primary/5 px-2 py-0.5 font-mono font-semibold tracking-wide">{c.code}</span>
                    <span className="font-medium">{codeLabel(c)}</span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {c.issuedBy === "ai" && <Badge tone="primary">AI แชต</Badge>}
                    <span className="basis-full text-xs text-muted-foreground sm:basis-auto">
                      {[
                        c.description,
                        c.minSpend > 0 ? `ขั้นต่ำ ${formatMoney(c.minSpend)}` : null,
                        c.maxUses ? `ใช้แล้ว ${formatNumber(c.usedCount)}/${formatNumber(c.maxUses)}` : `ใช้แล้ว ${formatNumber(c.usedCount)} ครั้ง`,
                        c.expiresAt ? `ถึง ${formatDateTime(c.expiresAt)}` : null,
                        c.customerName ? `เฉพาะ ${c.customerName}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {canManage && (
                      <span className="ml-auto flex gap-1">
                        <Button variant="ghost" size="sm" className={cn("h-10", c.isActive && "text-danger")} onClick={() => void toggle(c)}>
                          {c.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                        </Button>
                        {c.usedCount === 0 && (
                          <Button variant="ghost" size="sm" className="h-10 text-danger" onClick={() => void remove(c)}>
                            <Trash2 /> ลบ
                          </Button>
                        )}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </DialogContent>
  );
}

function randomCode() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => abc[b % abc.length]).join("");
}

function CodeForm({ onDone }: { onDone: (c: DiscountCode | null) => void }) {
  const [code, setCode] = useState(randomCode);
  const [type, setType] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("10");
  const [minSpend, setMinSpend] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const v = Number(value);
  const valid = /^[A-Za-z0-9_-]{3,50}$/.test(code.trim()) && v > 0 && (type === "fixed" || v <= 100);

  const save = async () => {
    setBusy(true);
    try {
      const c = await api.post<DiscountCode>("/pos/discount-codes", {
        code: code.trim(),
        type,
        value: v,
        minSpend: Number(minSpend) || 0,
        maxUses: Number(maxUses) > 0 ? Math.floor(Number(maxUses)) : null,
        expiresAt: expiresAt || null,
        description: description.trim() || null,
      });
      toast.success(`สร้างโค้ด ${c.code} แล้ว`);
      onDone(c);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "สร้างโค้ดไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="space-y-1.5">
        <Label htmlFor="dc-code">โค้ด</Label>
        <div className="flex gap-2">
          <Input id="dc-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="font-mono uppercase tracking-wide" maxLength={50} />
          <Button variant="outline" type="button" onClick={() => setCode(randomCode())}>
            สุ่ม
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">ใช้ได้เฉพาะ A-Z 0-9 - _ อย่างน้อย 3 ตัว เช่น NEWYEAR10</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>ประเภทส่วนลด</Label>
          <Segmented
            label="ประเภทส่วนลด"
            value={type}
            onChange={setType}
            options={[
              { value: "percent", label: "เปอร์เซ็นต์ (%)" },
              { value: "fixed", label: "จำนวนเงิน (บาท)" },
            ]}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dc-value">{type === "percent" ? "ลดกี่ %" : "ลดกี่บาท"}</Label>
          <Input id="dc-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dc-min">ยอดซื้อขั้นต่ำ (บาท)</Label>
          <Input id="dc-min" inputMode="decimal" value={minSpend} onChange={(e) => setMinSpend(e.target.value)} placeholder="ไม่มีขั้นต่ำ" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dc-max">ใช้ได้กี่ครั้ง</Label>
          <Input id="dc-max" inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="ไม่จำกัด" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dc-exp">ใช้ได้ถึงวันที่</Label>
          <Input id="dc-exp" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dc-desc">หมายเหตุ</Label>
          <Input id="dc-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="เช่น แจกในเพจช่วงปีใหม่" maxLength={191} />
        </div>
      </div>
      {type === "percent" && v > 100 && <p className="text-sm text-danger">ส่วนลดเปอร์เซ็นต์ต้องไม่เกิน 100</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => onDone(null)}>
          ยกเลิก
        </Button>
        <Button disabled={!valid || busy} onClick={() => void save()}>
          {busy && <Loader2 className="animate-spin" />} สร้างโค้ด
        </Button>
      </div>
    </div>
  );
}
