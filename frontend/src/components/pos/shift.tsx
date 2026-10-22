"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Loader2, Store } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Branch, CashMoveType, Shift, ShiftReport } from "@/lib/types";
import { cn, formatDateTime, formatMoney, formatNumber } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, Input, Label, NativeSelect } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";
import { METHOD_LABEL } from "./receipt";
import { POS_SETTINGS_KEY } from "./settings-dialog";

export const SHIFT_KEY = ["pos", "shift"] as const;

export function OpenShiftCard() {
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
      </div>
    </Card>
  );
}

const DENOMS = [1000, 500, 100, 50, 20, 10, 5, 2, 1];
const DENOM_LABEL = (d: number) => (d >= 20 ? `แบงก์ ${d}` : `เหรียญ ${d}`);
const CASH_TYPES: { value: CashMoveType; label: string; hint: string }[] = [
  { value: "pickup", label: "นำเข้าตู้เซฟ", hint: "ลดเงินสดในลิ้นชักเมื่อมีมากเกินไป" },
  { value: "pay_out", label: "จ่ายเงินออก", hint: "เช่น ค่าน้ำแข็ง ค่าส่งของ" },
  { value: "pay_in", label: "นำเงินเข้า", hint: "เช่น เติมเงินทอน" },
];
export const CASH_LABEL: Record<CashMoveType, string> = { pickup: "นำเข้าตู้เซฟ", pay_out: "จ่ายออก", pay_in: "นำเงินเข้า" };

/** Blind close: the cashier counts notes and coins first; the expected amount is revealed afterwards. */
export function CloseShiftDialog({ shift, onClosed }: { shift: Shift; onClosed: (report: ShiftReport) => void }) {
  const qc = useQueryClient();
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [note, setNote] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const counted = DENOMS.reduce((sum, d) => sum + d * (Number(counts[d]) || 0), 0);
  const diff = counted - shift.expectedCash;

  const close = async () => {
    setBusy(true);
    try {
      const denominations = Object.fromEntries(DENOMS.filter((d) => Number(counts[d]) > 0).map((d) => [String(d), Number(counts[d])]));
      const r = await api.post<ShiftReport>("/pos/shift/close", { denominations, note: note || undefined });
      const d = r.difference ?? 0;
      toast.success(d === 0 ? "ปิดกะแล้ว เงินสดตรงยอด" : `ปิดกะแล้ว เงินสด${d > 0 ? "เกิน" : "ขาด"} ${formatMoney(Math.abs(d))}`);
      await qc.invalidateQueries({ queryKey: SHIFT_KEY });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      onClosed(r);
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
          <Info label={diff === 0 ? "ตรงยอด" : diff > 0 ? "เกิน" : "ขาด"} value={formatMoney(Math.abs(diff))} strong />
        </dl>
      ) : (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setReveal(true)}>
          นับเสร็จแล้ว ดูยอดที่ควรมี
        </Button>
      )}
      <div className="mt-4 grid gap-3">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="หมายเหตุ (ถ้ามีส่วนต่าง กรุณาระบุสาเหตุ)" aria-label="หมายเหตุ" />
        <Button onClick={close} disabled={busy || !reveal}>
          {busy && <Loader2 className="animate-spin" />}
          ยืนยันปิดกะ และพิมพ์รายงาน Z
        </Button>
      </div>
    </DialogContent>
  );
}

export function CashDialog({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<CashMoveType>("pickup");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.post("/pos/shift/cash", { type, amount: Number(amount), reason: reason || CASH_LABEL[type] });
      toast.success(`บันทึก${CASH_LABEL[type]} ${formatMoney(Number(amount))} แล้ว`);
      await qc.invalidateQueries({ queryKey: SHIFT_KEY });
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogContent title="เงินเข้า / ออกลิ้นชัก">
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
        <Button type="submit" disabled={busy || !(Number(amount) > 0)}>
          {busy && <Loader2 className="animate-spin" />}
          บันทึก
        </Button>
      </form>
    </DialogContent>
  );
}

/** 80mm X/Z report; printed with the same `.print-receipt` stylesheet as receipts. */
export function ShiftReportView({ report }: { report: ShiftReport }) {
  const c = report.stats.cash;
  return (
    <div className="print-receipt mx-auto w-full max-w-[300px] bg-white p-4 font-mono text-[12px] leading-snug text-black">
      <p className="text-center text-[14px] font-bold">รายงาน {report.kind} {report.kind === "Z" ? "(ปิดกะ)" : "(ระหว่างกะ)"}</p>
      <p className="text-center">{report.branchName}</p>
      <p>พนักงาน {report.cashierName}</p>
      <p>เปิด {new Date(report.openedAt).toLocaleString("th-TH")}</p>
      {report.closedAt && <p>ปิด {new Date(report.closedAt).toLocaleString("th-TH")}</p>}
      <Hr />
      <R label="จำนวนบิล" value={String(report.stats.orders)} />
      <R label="ยอดขายสุทธิ" value={formatMoney(report.stats.sales)} />
      <R label="ส่วนลดท้ายบิล" value={formatMoney(report.discount)} />
      {report.promoDiscount > 0 && <R label="ส่วนลดโปรโมชั่น" value={formatMoney(report.promoDiscount)} />}
      <R label="VAT" value={formatMoney(report.vat)} />
      {report.stats.voided > 0 && <R label="บิลยกเลิก" value={String(report.stats.voided)} />}
      {report.pointsUsed > 0 && <R label="แต้มที่ใช้" value={String(report.pointsUsed)} />}
      <Hr />
      {Object.entries(report.stats.byMethod).map(([m, v]) => (
        <R key={m} label={METHOD_LABEL[m] ?? m} value={formatMoney(v)} />
      ))}
      <Hr />
      <R label="เงินทอนตั้งต้น" value={formatMoney(report.openingCash)} />
      {c.pay_in > 0 && <R label="นำเงินเข้า" value={formatMoney(c.pay_in)} />}
      {c.pay_out > 0 && <R label="จ่ายออก" value={formatMoney(-c.pay_out)} />}
      {c.pickup > 0 && <R label="นำเข้าตู้เซฟ" value={formatMoney(-c.pickup)} />}
      <R label="เงินสดที่ควรมี" value={formatMoney(report.expectedCash)} bold />
      {report.closingCash !== null && (
        <>
          <R label="นับได้จริง" value={formatMoney(report.closingCash)} />
          <R label={(report.difference ?? 0) >= 0 ? "เกิน" : "ขาด"} value={formatMoney(Math.abs(report.difference ?? 0))} bold />
        </>
      )}
      {report.topItems.length > 0 && (
        <>
          <Hr />
          <p className="font-bold">ขายดีในกะ</p>
          {report.topItems.slice(0, 5).map((t) => (
            <R key={t.name} label={`${t.name} x${formatNumber(t.quantity)}`} value={formatMoney(t.amount)} />
          ))}
        </>
      )}
    </div>
  );
}

const Hr = () => <div className="my-2 border-t border-dashed border-black" />;
function R({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <p className={cn("flex justify-between gap-2", bold && "font-bold")}>
      <span className="truncate">{label}</span>
      <span className="shrink-0">{value.replace("฿", "")}</span>
    </p>
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
