"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Store } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Branch, Shift } from "@/lib/types";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, Input, Label, NativeSelect } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";
import { METHOD_LABEL } from "./receipt";

export const SHIFT_KEY = ["pos", "shift"] as const;

export function OpenShiftCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const branches = useQuery({ queryKey: ["org", "branches"], queryFn: () => api.get<Branch[]>("/org/branches"), staleTime: 10 * 60_000 });
  const [branchId, setBranchId] = useState(user?.branchId ? String(user.branchId) : "");
  const [cash, setCash] = useState("0");
  const [busy, setBusy] = useState(false);
  const selected = branchId || String(branches.data?.[0]?.id ?? "");

  const open = async () => {
    setBusy(true);
    try {
      await api.post<Shift>("/pos/shift/open", { branchId: Number(selected), openingCash: Number(cash) || 0 });
      toast.success("เปิดกะแล้ว พร้อมขาย");
      await qc.invalidateQueries({ queryKey: SHIFT_KEY });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เปิดกะไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mx-auto mt-10 max-w-md p-6">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary">
        <Store className="size-7" />
      </div>
      <h2 className="mt-4 text-center text-xl font-semibold">เปิดกะการขาย</h2>
      <p className="mt-1 text-center text-sm text-muted-foreground">นับเงินทอนในลิ้นชักก่อนเริ่มขาย ระบบจะใช้ยอดนี้กระทบยอดตอนปิดกะ</p>
      <div className="mt-6 grid gap-4">
        <div className="space-y-2">
          <Label htmlFor="branch">สาขา</Label>
          <NativeSelect id="branch" className="h-10 w-full" value={selected} onChange={(e) => setBranchId(e.target.value)}>
            {branches.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="opening">เงินทอนเริ่มต้น (บาท)</Label>
          <Input id="opening" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} />
        </div>
        <Button size="lg" onClick={open} disabled={busy || !selected}>
          {busy && <Loader2 className="animate-spin" />}
          เปิดกะ
        </Button>
      </div>
    </Card>
  );
}

export function CloseShiftDialog({ shift, onClosed }: { shift: Shift; onClosed: () => void }) {
  const qc = useQueryClient();
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const diff = counted === "" ? null : Number(counted) - shift.expectedCash;

  const close = async () => {
    setBusy(true);
    try {
      const r = await api.post<Shift>("/pos/shift/close", { closingCash: Number(counted), note: note || undefined });
      const d = r.difference ?? 0;
      toast.success(d === 0 ? "ปิดกะแล้ว เงินสดตรงยอด" : `ปิดกะแล้ว เงินสด${d > 0 ? "เกิน" : "ขาด"} ${formatMoney(Math.abs(d))}`);
      await qc.invalidateQueries({ queryKey: SHIFT_KEY });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      onClosed();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ปิดกะไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent title="ปิดกะ" description={`${shift.branchName} · เปิดเมื่อ ${formatDateTime(shift.openedAt)}`}>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Info label="จำนวนบิล" value={formatNumber(shift.stats.orders)} />
        <Info label="ยอดขาย" value={formatMoney(shift.stats.sales)} />
        {Object.entries(shift.stats.byMethod).map(([m, v]) => (
          <Info key={m} label={`รับชำระ ${METHOD_LABEL[m] ?? m}`} value={formatMoney(v)} />
        ))}
        <Info label="เงินทอนเริ่มต้น" value={formatMoney(shift.openingCash)} />
        <Info label="เงินสดที่ควรมี" value={formatMoney(shift.expectedCash)} strong />
      </dl>
      <div className="mt-5 grid gap-4">
        <div className="space-y-2">
          <Label htmlFor="counted">เงินสดที่นับได้จริง</Label>
          <Input id="counted" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus />
          {diff !== null && (
            <p className={`text-sm font-medium ${diff === 0 ? "text-success" : "text-danger"}`}>
              {diff === 0 ? "ตรงยอด" : `${diff > 0 ? "เกิน" : "ขาด"} ${formatMoney(Math.abs(diff))}`}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="note">หมายเหตุ</Label>
          <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ถ้ามีส่วนต่าง กรุณาระบุสาเหตุ" />
        </div>
        <Button onClick={close} disabled={busy || counted === ""}>
          {busy && <Loader2 className="animate-spin" />}
          ยืนยันปิดกะ
        </Button>
      </div>
    </DialogContent>
  );
}

function Info({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-muted px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={strong ? "text-base font-semibold" : "font-medium"}>{value}</dd>
    </div>
  );
}
