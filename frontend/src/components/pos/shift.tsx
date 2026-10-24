"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { GraduationCap, Loader2, Store, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Branch, CashMovement, CashMoveType, Shift, ShiftReport } from "@/lib/types";
import { cn, formatDateTime, formatMoney } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, Input, Label, NativeSelect } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";
import { METHOD_LABEL, ReceiptBlocks } from "./receipt";
import { shiftReportDoc } from "./receipt-doc";
import { openDrawer } from "./printer";
import { useOfflineBills } from "./offline";
import { POS_SETTINGS_KEY } from "./settings-dialog";

export const SHIFT_KEY = ["pos", "shift"] as const;

export function OpenShiftCard({ onTraining }: { onTraining?: () => void }) {
  const { user, can } = useAuth();
  const qc = useQueryClient();
  const branches = useQuery({ queryKey: ["org", "branches"], queryFn: () => api.get<Branch[]>("/org/branches"), staleTime: 10 * 60_000 });
  const [branchId, setBranchId] = useState(user?.branchId ? String(user.branchId) : "");
  const [cash, setCash] = useState("0");
  const [busy, setBusy] = useState(false);
  const active = branches.data?.filter((b) => b.isActive) ?? [];
  // The user's own branch when it is still active, otherwise the first active one
  const selected = active.some((b) => String(b.id) === branchId) ? branchId : String(active[0]?.id ?? "");

  const open = async () => {
    setBusy(true);
    try {
      await api.post<Shift>("/pos/shift/open", { branchId: Number(selected), openingCash: Number(cash) || 0 });
      toast.success("เปิดกะแล้ว พร้อมขาย");
      await qc.invalidateQueries({ queryKey: SHIFT_KEY });
      // the branch decides which PromptPay / bank account the till charges into
      void qc.invalidateQueries({ queryKey: POS_SETTINGS_KEY });
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
          <NativeSelect id="branch" className="h-10 w-full" value={selected} onChange={(e) => setBranchId(e.target.value)} disabled={!active.length}>
            {active.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </NativeSelect>
          {branches.isError ? (
            <p className="text-sm text-danger">
              โหลดรายชื่อสาขาไม่สำเร็จ{" "}
              <button type="button" onClick={() => branches.refetch()} className="font-medium underline underline-offset-2">
                ลองใหม่
              </button>
            </p>
          ) : (
            branches.data &&
            !active.length && (
              <p className="text-sm text-warning">
                ยังไม่มีสาขาที่เปิดใช้งาน{" "}
                {can("settings:manage") ? (
                  <Link href="/settings/branches" className="font-medium underline underline-offset-2">
                    เพิ่มสาขา
                  </Link>
                ) : (
                  "ติดต่อเจ้าของร้านเพื่อเพิ่มสาขา"
                )}
              </p>
            )
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="opening">เงินทอนเริ่มต้น (บาท)</Label>
          <Input id="opening" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} />
        </div>
        <Button size="lg" onClick={open} disabled={busy || !selected}>
          {busy && <Loader2 className="animate-spin" />}
          เปิดกะ
        </Button>
        {onTraining && (
          <Button variant="outline" onClick={onTraining}>
            <GraduationCap /> ลองฝึกขายก่อน (ไม่บันทึกจริง)
          </Button>
        )}
      </div>
    </Card>
  );
}

const DENOMS = [1000, 500, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.25];
const DENOM_LABEL = (d: number) => (d >= 20 ? `แบงก์ ${d}` : d >= 1 ? `เหรียญ ${d}` : `เหรียญ ${d * 100} สต.`);
const CASH_TYPES: { value: CashMoveType; label: string; hint: string }[] = [
  { value: "pickup", label: "นำเข้าตู้เซฟ", hint: "ลดเงินสดในลิ้นชักเมื่อมีมากเกินไป" },
  { value: "pay_out", label: "จ่ายเงินออก", hint: "เช่น ค่าน้ำแข็ง ค่าส่งของ" },
  { value: "pay_in", label: "นำเงินเข้า", hint: "เช่น เติมเงินทอน" },
];
export const CASH_LABEL: Record<CashMoveType, string> = { pickup: "นำเข้าตู้เซฟ", pay_out: "จ่ายออก", pay_in: "นำเงินเข้า" };

/** Blind close: the cashier counts notes and coins first; the expected amount is revealed afterwards. */
export function CloseShiftDialog({ shift, onClosed }: { shift: Shift; onClosed: (report: ShiftReport) => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  // bills sold offline must reach the system before the day's cash is counted against it
  const unsent = useOfflineBills().filter((b) => b.userId === user?.id).length;
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [note, setNote] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const counted = Math.round(DENOMS.reduce((sum, d) => sum + d * (Number(counts[d]) || 0), 0) * 100) / 100;
  const diff = Math.round((counted - shift.expectedCash) * 100) / 100;
  // same rule as the server: a baht or more off needs a reason before the shift can close
  const needsReason = Math.abs(diff) >= 1;
  const diffWord = diff > 0 ? "เกิน" : "ขาด";

  const close = async () => {
    setBusy(true);
    try {
      const denominations = Object.fromEntries(DENOMS.filter((d) => Number(counts[d]) > 0).map((d) => [String(d), Number(counts[d])]));
      const r = await api.post<ShiftReport>("/pos/shift/close", { denominations, note: note.trim() || undefined });
      const d = r.difference ?? 0;
      if (d === 0) toast.success("ปิดกะแล้ว เงินสดตรงยอด");
      else toast.warning(`ปิดกะแล้ว เงินสด${d > 0 ? "เกิน" : "ขาด"} ${formatMoney(Math.abs(d))}`);
      // hand the report over first: once the shift query refetches, the POS swaps to the open-shift card
      onClosed(r);
      void qc.invalidateQueries({ queryKey: SHIFT_KEY });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ปิดกะไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent title="ปิดกะ · นับเงินในลิ้นชัก" description={`${shift.branchName} · เปิดเมื่อ ${formatDateTime(shift.openedAt)}`} className="max-w-xl">
      <div className="grid grid-cols-3 gap-2">
        {DENOMS.map((d) => (
          <label key={d} className="rounded-lg border border-border p-2 text-xs">
            <span className="text-muted-foreground">{DENOM_LABEL(d)}</span>
            <Input
              inputMode="numeric"
              value={counts[d] ?? ""}
              onChange={(e) => setCounts((c) => ({ ...c, [d]: e.target.value.replace(/\D/g, "") }))}
              placeholder="0"
              className="mt-1 h-9 text-right text-base tabular-nums"
              aria-label={`จำนวน${DENOM_LABEL(d)}`}
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between rounded-xl bg-muted p-3">
        <span className="text-sm">นับได้รวม</span>
        <span className="text-2xl font-semibold tabular-nums" data-testid="counted-total">
          {formatMoney(counted)}
        </span>
      </div>
      {reveal ? (
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <Info label="เงินสดที่ควรมี" value={formatMoney(shift.expectedCash)} strong />
          <Info label={diff === 0 ? "ตรงยอด" : diffWord} value={formatMoney(Math.abs(diff))} strong />
        </dl>
      ) : (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setReveal(true)}>
          นับเสร็จแล้ว ดูยอดที่ควรมี
        </Button>
      )}
      <div className="mt-4 grid gap-3">
        {reveal && needsReason && (
          <p className="rounded-lg bg-danger/10 p-2.5 text-sm font-medium text-danger">
            เงินสด{diffWord} {formatMoney(Math.abs(diff))} — นับใหม่อีกครั้ง หรือระบุสาเหตุก่อนปิดกะ
          </p>
        )}
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={reveal && needsReason ? "สาเหตุที่เงินไม่ตรง (ต้องระบุ) เช่น ทอนเงินผิด" : "หมายเหตุ (ถ้ามี)"}
          aria-label="หมายเหตุ"
          aria-invalid={reveal && needsReason && !note.trim()}
          maxLength={255}
        />
        {unsent > 0 && (
          <p role="alert" className="rounded-lg bg-warning-soft p-2.5 text-sm font-medium text-warning">
            ยังมีบิลออฟไลน์ {unsent} ใบที่ยังไม่ได้ส่งเข้าระบบ — รอให้ส่งเสร็จก่อนปิดกะ (ดูที่แถบสีเหลืองหน้าขาย)
          </p>
        )}
        <Button onClick={close} disabled={busy || !reveal || unsent > 0 || (needsReason && !note.trim())} variant={reveal && needsReason ? "danger" : "default"}>
          {busy && <Loader2 className="animate-spin" />}
          {reveal && needsReason ? `ยืนยันปิดกะ (เงิน${diffWord} ${formatMoney(Math.abs(diff))})` : "ยืนยันปิดกะ และพิมพ์สรุปปิดกะ"}
        </Button>
      </div>
    </DialogContent>
  );
}

export function CashDialog({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  // no default: picking the wrong kind silently moved cash to the safe
  const [type, setType] = useState<CashMoveType | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  // The open shift's movements, so a mistaken one can be removed (the drawer total follows)
  const moves = useQuery({ queryKey: [...SHIFT_KEY, "cash"], queryFn: () => api.get<ShiftReport>("/pos/shift/report").then((r) => r.cashMovements) });
  const remove = async (m: CashMovement) => {
    if (!window.confirm(`ลบรายการ${CASH_LABEL[m.type]} ${formatMoney(m.amount)} (${m.reason})?`)) return;
    setRemoving(m.id);
    try {
      await api.del(`/pos/shift/cash/${m.id}`);
      toast.success("ลบรายการแล้ว");
      await qc.invalidateQueries({ queryKey: SHIFT_KEY });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
    } finally {
      setRemoving(null);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      if (!type) return;
      await api.post("/pos/shift/cash", { type, amount: Number(amount), reason: reason || CASH_LABEL[type] });
      toast.success(`บันทึก${CASH_LABEL[type]} ${formatMoney(Number(amount))} แล้ว`);
      void openDrawer();
      await qc.invalidateQueries({ queryKey: SHIFT_KEY });
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogContent title="เงินเข้า / ออกลิ้นชัก" description="เลือกก่อนว่าเป็นเงินแบบไหน">
      <div className="grid grid-cols-3 gap-2">
        {CASH_TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => setType(t.value)}
            className={cn("rounded-xl border p-3 text-left text-sm", type === t.value ? "border-primary bg-primary-soft text-primary" : "border-border hover:bg-accent")}
          >
            <span className="font-medium">{t.label}</span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">{t.hint}</span>
          </button>
        ))}
      </div>
      <form
        className="mt-4 grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="จำนวนเงิน" className="h-12 text-lg" aria-label="จำนวนเงิน" autoFocus />
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผล" aria-label="เหตุผล" />
        <Button type="submit" disabled={busy || !type || !(Number(amount) > 0)}>
          {busy && <Loader2 className="animate-spin" />}
          {type ? `บันทึก${CASH_LABEL[type]}` : "เลือกประเภทด้านบนก่อน"}
        </Button>
      </form>
      {!!moves.data?.length && (
        <div className="mt-5">
          <p className="mb-1.5 text-sm font-medium">รายการในกะนี้</p>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {moves.data.map((m) => (
              <li key={m.id} className="flex items-center gap-2 p-2 pl-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {CASH_LABEL[m.type]} · {m.reason}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(m.createdAt)}
                    {m.userName ? ` · ${m.userName}` : ""}
                    {m.auto ? " · ยกเลิกได้ที่รายการคืนของบิล" : ""}
                  </span>
                </span>
                <span className={cn("shrink-0 font-medium tabular-nums", m.type !== "pay_in" && "text-danger")}>
                  {formatMoney(m.type === "pay_in" ? m.amount : -m.amount)}
                </span>
                {!m.auto && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-10 shrink-0 text-danger"
                    aria-label="ลบรายการ"
                    disabled={removing === m.id}
                    onClick={() => void remove(m)}
                  >
                    {removing === m.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </DialogContent>
  );
}

/** 80mm X/Z report; printed with the same `.print-receipt` stylesheet as receipts (or on the USB printer). */
export function ShiftReportView({ report }: { report: ShiftReport }) {
  return <ReceiptBlocks blocks={shiftReportDoc(report, METHOD_LABEL)} />;
}

function Info({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-muted px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={strong ? "text-base font-semibold" : "font-medium"}>{value}</dd>
    </div>
  );
}
