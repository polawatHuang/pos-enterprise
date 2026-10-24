"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Banknote, CheckCircle2, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { PayrollItem, PayrollRun } from "@/lib/types";
import { cn, formatMoney, formatThaiDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Input, Label, Skeleton } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { RUN_STATUS, monthLabel } from "./labels";

/** One month's payroll: every line, edit while draft, then approve (books the cost) and pay. */
export function PayrollRunView({ id }: { id: number }) {
  const router = useRouter();
  const qc = useQueryClient();
  const key = ["hr", "payroll", id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<PayrollRun>(`/hr/payroll/${id}`) });
  const [editing, setEditing] = useState<PayrollItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (q.isPending) return <Skeleton className="h-[70vh] w-full rounded-xl" />;
  if (q.isError) return <p className="py-16 text-center text-muted-foreground">{q.error.message}</p>;
  const r = q.data;
  const draft = r.status === "draft";

  const act = async (what: "approve" | "pay" | "void") => {
    let body: Record<string, unknown> = {};
    if (
      what === "approve" &&
      !window.confirm(`อนุมัติเงินเดือน ${monthLabel(r.period)} ยอดจ่ายสุทธิ ${formatMoney(r.totalNet)}? (ลงบัญชีค่าใช้จ่ายของเดือนนี้ หลังจากนี้แก้ไขไม่ได้)`)
    )
      return;
    if (what === "pay" && !window.confirm(`บันทึกว่าโอนเงินเดือนให้พนักงานแล้ว ${formatMoney(r.totalNet)}?`)) return;
    if (what === "pay") body = { paymentMethod: "transfer" };
    if (what === "void") {
      const reason = window.prompt(draft ? "ลบรอบเงินเดือนฉบับร่างนี้ — เหตุผล" : "ยกเลิกรอบเงินเดือน (กลับรายการบัญชี) — เหตุผล");
      if (!reason) return;
      body = { reason };
    }
    setBusy(what);
    try {
      const res = await api.post<PayrollRun & { deleted?: boolean }>(`/hr/payroll/${id}/${what}`, body);
      void qc.invalidateQueries({ queryKey: ["hr"] });
      void qc.invalidateQueries({ queryKey: ["documents-hub"] });
      toast.success(what === "approve" ? "อนุมัติและลงบัญชีแล้ว" : what === "pay" ? "บันทึกจ่ายเงินเดือนแล้ว" : "ยกเลิกแล้ว");
      if (res.deleted) router.push("/hr?tab=payroll");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <Link href="/hr?tab=payroll" className="inline-flex min-h-10 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> เงินเดือน
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">เงินเดือน {monthLabel(r.period)}</h1>
            <Badge tone={RUN_STATUS[r.status].tone}>{RUN_STATUS[r.status].label}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {r.runNo} · จ่ายวันที่ {formatThaiDate(r.payDate)} · {r.headcount} คน
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {draft && (
            <Button onClick={() => void act("approve")} disabled={!!busy}>
              {busy === "approve" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} อนุมัติ
            </Button>
          )}
          {r.status === "approved" && (
            <Button onClick={() => void act("pay")} disabled={!!busy}>
              {busy === "pay" ? <Loader2 className="animate-spin" /> : <Banknote />} บันทึกว่าจ่ายแล้ว
            </Button>
          )}
          {r.status !== "void" && (
            <Button variant="ghost" className="text-danger" onClick={() => void act("void")} disabled={!!busy}>
              <Ban /> {draft ? "ลบฉบับร่าง" : "ยกเลิก"}
            </Button>
          )}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          ["รายได้รวม", r.totalGross],
          ["ภาษีหัก ณ ที่จ่าย", r.totalWht],
          ["ประกันสังคม (ลูกจ้าง)", r.totalSsoEmployee],
          ["ประกันสังคม (นายจ้าง)", r.totalSsoEmployer],
          ["จ่ายสุทธิ", r.totalNet],
        ].map(([label, v]) => (
          <div key={label as string} className="rounded-xl border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold tabular-nums">{formatMoney(v as number)}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="table-cards w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-3 py-2.5 font-medium">พนักงาน</th>
              <th className="px-3 py-2.5 text-right font-medium">ค่าจ้าง</th>
              <th className="px-3 py-2.5 text-right font-medium">OT / เบี้ยเลี้ยง / โบนัส</th>
              <th className="px-3 py-2.5 text-right font-medium">หักขาด/ลา</th>
              <th className="px-3 py-2.5 text-right font-medium">ประกันสังคม</th>
              <th className="px-3 py-2.5 text-right font-medium">ภาษี</th>
              <th className="px-3 py-2.5 text-right font-medium">สุทธิ</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {r.items?.map((i) => {
              const needsDays = i.payType === "daily" && !i.daysWorked;
              return (
                <tr
                  key={i.id}
                  className={cn("border-b border-border last:border-0", draft && "cursor-pointer hover:bg-muted/40")}
                  onClick={draft ? () => setEditing(i) : undefined}
                >
                  <td className="px-3 py-2.5">
                    <span className="font-medium">{i.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {i.empCode} · {i.payType === "daily" ? `รายวัน ${formatMoney(i.rate)} × ${i.daysWorked ?? 0} วัน` : "รายเดือน"}
                    </span>
                    {needsDays && <span className="block text-xs text-warning">ใส่จำนวนวันทำงาน</span>}
                  </td>
                  <td data-label="ค่าจ้าง" className="px-3 py-2.5 text-right">
                    {formatMoney(i.basePay)}
                  </td>
                  <td data-label="OT / เบี้ยเลี้ยง / โบนัส" className="px-3 py-2.5 text-right">
                    {formatMoney(i.overtime + i.allowance + i.bonus + i.otherIncome)}
                  </td>
                  <td data-label="หักขาด/ลา" className="px-3 py-2.5 text-right">
                    {i.deduction ? `-${formatMoney(i.deduction)}` : "-"}
                  </td>
                  <td data-label="ประกันสังคม" className="px-3 py-2.5 text-right">
                    {formatMoney(i.ssoEmployee)}
                  </td>
                  <td data-label="ภาษี" className="px-3 py-2.5 text-right">
                    {formatMoney(i.wht)}
                    {i.whtManual && <span className="ml-1 text-xs text-muted-foreground">(กรอกเอง)</span>}
                  </td>
                  <td data-label="สุทธิ" className="px-3 py-2.5 text-right font-semibold">
                    {formatMoney(i.net)}
                  </td>
                  <td className={cn("px-3 py-2.5 text-right", (draft || r.status === "void") && "cards-hide")}>
                    {!draft && r.status !== "void" && (
                      <Link
                        href={`/hr/payslips/${i.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs text-primary hover:bg-muted"
                        aria-label={`สลิปเงินเดือน ${i.name}`}
                      >
                        <Printer className="size-4" /> สลิป
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {draft && (
        <p className="mt-2 text-xs text-muted-foreground">
          แตะรายชื่อเพื่อใส่วันทำงาน ค่าล่วงเวลา เบี้ยเลี้ยง โบนัส หรือหักขาดงาน — ระบบคำนวณประกันสังคมและภาษีใหม่ให้
        </p>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <ItemDialog
            runId={id}
            item={editing}
            onDone={() => {
              setEditing(null);
              void qc.invalidateQueries({ queryKey: key });
            }}
          />
        )}
      </Dialog>
    </>
  );
}

function ItemDialog({ runId, item, onDone }: { runId: number; item: PayrollItem; onDone: () => void }) {
  const s = (v: number | null) => (v ? String(v) : "");
  const [f, setF] = useState({
    daysWorked: s(item.daysWorked),
    overtime: s(item.overtime),
    allowance: s(item.allowance),
    bonus: s(item.bonus),
    otherIncome: s(item.otherIncome),
    deduction: s(item.deduction),
    wht: item.whtManual ? String(item.wht) : "",
    note: item.note ?? "",
  });
  const [busy, setBusy] = useState(false);
  const n = (v: string) => (v === "" ? 0 : Number(v));
  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/hr/payroll/${runId}/items/${item.id}`, {
        ...(item.payType === "daily" ? { daysWorked: n(f.daysWorked) } : {}),
        overtime: n(f.overtime),
        allowance: n(f.allowance),
        bonus: n(f.bonus),
        otherIncome: n(f.otherIncome),
        deduction: n(f.deduction),
        wht: f.wht === "" ? null : Number(f.wht),
        note: f.note || null,
      });
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };
  const input = (k: keyof typeof f, label: string, hint?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`pi-${k}`}>{label}</Label>
      <Input id={`pi-${k}`} inputMode="decimal" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={hint ?? "0"} />
    </div>
  );
  return (
    <DialogContent
      title={item.name}
      description={item.payType === "daily" ? `ค่าจ้างรายวัน ${formatMoney(item.rate)}` : `เงินเดือน ${formatMoney(item.rate)}`}
      className="max-w-md"
    >
      <div className="grid grid-cols-2 gap-3">
        {item.payType === "daily" && input("daysWorked", "วันทำงาน")}
        {input("overtime", "ค่าล่วงเวลา (OT)")}
        {input("allowance", "เบี้ยเลี้ยง / ค่าตำแหน่ง")}
        {input("bonus", "โบนัส")}
        {input("otherIncome", "รายได้อื่น / ค่าคอมมิชชัน")}
        {input("deduction", "หักขาดงาน / ลาไม่รับค่าจ้าง / สาย")}
        <div className="col-span-2">{input("wht", "ภาษีหัก ณ ที่จ่าย (เว้นว่าง = ให้ระบบคำนวณ)", "คำนวณอัตโนมัติ")}</div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="pi-note">หมายเหตุ (แสดงในสลิป)</Label>
          <Input id="pi-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </div>
      </div>
      <Button className="mt-4 w-full" onClick={() => void save()} disabled={busy}>
        {busy && <Loader2 className="animate-spin" />} บันทึกและคำนวณใหม่
      </Button>
    </DialogContent>
  );
}
