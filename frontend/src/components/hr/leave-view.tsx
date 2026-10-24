"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus, Printer, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { LeaveRequest, LeaveType } from "@/lib/types";
import { cn, formatMoney, formatThaiDate, todayStr } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, Label, NativeSelect, Skeleton, TabBar } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { PageHeader } from "@/components/layout/page";
import { ErrorNote } from "@/components/dashboard/widgets";
import { useAuth } from "@/components/auth/auth-provider";
import { LEAVE_STATUS, LEAVE_TYPE, monthLabel } from "./labels";

type Tab = "mine" | "payslips" | "approve";

interface Me {
  id: number;
  empCode: string;
  displayName: string;
  position: string | null;
  branchName: string | null;
  startDate: string;
  annualLeaveDays: number;
}
interface Summary {
  year: number;
  used: Record<LeaveType, number>;
  vacationQuota: number;
  vacationLeft: number;
}

/** ใบลา & สลิปเงินเดือน: a staff member's own leave and payslips, plus the approval queue for managers. */
export function LeaveView() {
  const { can } = useAuth();
  const approver = can("leave:approve") || can("hr:manage");
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab | null) ?? (approver && !can("leave:request") ? "approve" : "mine"));
  const me = useQuery({ queryKey: ["hr", "me"], queryFn: () => api.get<Me | null>("/hr/me") });
  return (
    <>
      <PageHeader title="ใบลา & สลิปเงินเดือน" description="ยื่นใบลา ดูวันลาคงเหลือ และเปิดสลิปเงินเดือนของตัวเอง · ผู้จัดการอนุมัติใบลาได้ที่นี่" />
      <Card>
        <div className="px-4 pt-2">
          <TabBar
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "mine", label: "ใบลาของฉัน" },
              { value: "payslips", label: "สลิปของฉัน" },
              ...(approver ? [{ value: "approve" as const, label: "อนุมัติใบลา" }] : []),
            ]}
          />
        </div>
        {tab !== "approve" && me.isSuccess && !me.data ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            บัญชีนี้ยังไม่ได้ผูกกับข้อมูลพนักงาน — ให้ฝ่ายบุคคลเลือกบัญชีผู้ใช้ในหน้าข้อมูลพนักงานก่อน
          </p>
        ) : tab === "mine" ? (
          <MyLeave me={me.data ?? null} />
        ) : tab === "payslips" ? (
          <MyPayslips />
        ) : (
          <Approvals />
        )}
      </Card>
    </>
  );
}

function MyLeave({ me }: { me: Me | null }) {
  const summary = useQuery({ queryKey: ["hr", "leave-summary"], queryFn: () => api.get<Summary | null>("/hr/leave/summary"), enabled: !!me });
  const list = useQuery({
    queryKey: ["hr", "leave", "mine"],
    queryFn: () => api.get<LeaveRequest[]>("/hr/leave", me ? { employeeId: me.id } : {}),
    enabled: !!me,
  });
  const [open, setOpen] = useState(false);
  if (!me) return <Skeleton className="m-4 h-40" />;
  const s = summary.data;
  return (
    <div className="p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">{me.displayName}</p>
          <p className="text-sm text-muted-foreground">{[me.empCode, me.position, `เริ่มงาน ${formatThaiDate(me.startDate)}`].filter(Boolean).join(" · ")}</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus /> ยื่นใบลา
        </Button>
      </div>
      {s && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label={`พักร้อนคงเหลือ ปี ${s.year + 543}`} value={`${s.vacationLeft} / ${s.vacationQuota} วัน`} />
          <Stat label="ลาป่วยแล้ว" value={`${s.used.sick} วัน`} />
          <Stat label="ลากิจแล้ว" value={`${s.used.personal} วัน`} />
          <Stat label="ลาอื่นๆ" value={`${s.used.maternity + s.used.other} วัน`} />
        </div>
      )}
      <LeaveList q={list} mine />
      <Dialog open={open} onOpenChange={setOpen}>
        {open && <LeaveForm onDone={() => setOpen(false)} />}
      </Dialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function LeaveList({
  q,
  mine,
  onDecide,
}: {
  q: ReturnType<typeof useQuery<LeaveRequest[]>>;
  mine?: boolean;
  onDecide?: (l: LeaveRequest, ok: boolean) => void;
}) {
  const qc = useQueryClient();
  if (q.isPending) return <Skeleton className="h-40" />;
  if (q.isError) return <ErrorNote onRetry={() => q.refetch()} error={q.error} />;
  if (!q.data.length) return <p className="py-10 text-center text-sm text-muted-foreground">{mine ? "ยังไม่มีใบลา" : "ไม่มีใบลาที่ต้องอนุมัติ"}</p>;
  const cancel = async (l: LeaveRequest) => {
    if (!window.confirm(`ยกเลิกใบลา ${l.leaveNo}?`)) return;
    try {
      await api.post(`/hr/leave/${l.id}/cancel`);
      void qc.invalidateQueries({ queryKey: ["hr"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ไม่สำเร็จ");
    }
  };
  return (
    <div className="overflow-x-auto">
      <table className="table-cards w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">เลขที่</th>
            {!mine && <th className="px-3 py-2 font-medium">พนักงาน</th>}
            <th className="px-3 py-2 font-medium">ประเภท</th>
            <th className="px-3 py-2 font-medium">วันที่</th>
            <th className="px-3 py-2 text-right font-medium">วัน</th>
            <th className="px-3 py-2 font-medium">เหตุผล</th>
            <th className="px-3 py-2 font-medium">สถานะ</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {q.data.map((l) => (
            <tr key={l.id} className="border-b border-border last:border-0">
              <td className="px-3 py-2 font-medium">{l.leaveNo}</td>
              {!mine && (
                <td data-label="พนักงาน" className="px-3 py-2">
                  {l.employeeName}
                </td>
              )}
              <td data-label="ประเภท" className="px-3 py-2">
                {LEAVE_TYPE[l.leaveType]}
              </td>
              <td data-label="วันที่" className="px-3 py-2">
                {formatThaiDate(l.startDate)}
                {l.endDate !== l.startDate && ` – ${formatThaiDate(l.endDate)}`}
              </td>
              <td data-label="วัน" className="px-3 py-2 text-right tabular-nums">
                {l.days}
              </td>
              <td data-label="เหตุผล" className="px-3 py-2 text-muted-foreground">
                {l.reason ?? "-"}
                {l.rejectReason && <span className="block text-danger">ไม่อนุมัติ: {l.rejectReason}</span>}
              </td>
              <td data-label="สถานะ" className="px-3 py-2">
                <Badge tone={LEAVE_STATUS[l.status].tone}>{LEAVE_STATUS[l.status].label}</Badge>
              </td>
              <td className={cn("px-3 py-2 text-right", l.status !== "pending" && "cards-hide")}>
                {l.status === "pending" && onDecide && (
                  <div className="flex justify-end gap-1">
                    <Button size="sm" onClick={() => onDecide(l, true)}>
                      <Check /> อนุมัติ
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onDecide(l, false)}>
                      <X /> ไม่อนุมัติ
                    </Button>
                  </div>
                )}
                {l.status === "pending" && mine && (
                  <Button size="sm" variant="ghost" onClick={() => void cancel(l)}>
                    ยกเลิก
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LeaveForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ leaveType: "sick" as LeaveType, startDate: todayStr(), endDate: todayStr(), halfDay: false, reason: "" });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.post("/hr/leave", {
        leaveType: f.leaveType,
        startDate: f.startDate,
        endDate: f.endDate,
        ...(f.halfDay && f.startDate === f.endDate ? { days: 0.5 } : {}),
        reason: f.reason || null,
      });
      void qc.invalidateQueries({ queryKey: ["hr"] });
      toast.success("ยื่นใบลาแล้ว รอผู้จัดการอนุมัติ");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ยื่นใบลาไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogContent title="ยื่นใบลา" className="max-w-md">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="lv-type">ประเภทการลา</Label>
          <NativeSelect id="lv-type" className="h-10 w-full" value={f.leaveType} onChange={(e) => setF({ ...f, leaveType: e.target.value as LeaveType })}>
            {(Object.keys(LEAVE_TYPE) as LeaveType[]).map((t) => (
              <option key={t} value={t}>
                {LEAVE_TYPE[t]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lv-start">ตั้งแต่</Label>
          <Input
            id="lv-start"
            type="date"
            value={f.startDate}
            onChange={(e) => setF({ ...f, startDate: e.target.value, endDate: e.target.value > f.endDate ? e.target.value : f.endDate })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lv-end">ถึง</Label>
          <Input id="lv-end" type="date" min={f.startDate} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
        </div>
        {f.startDate === f.endDate && (
          <label className="flex min-h-10 items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="size-5" checked={f.halfDay} onChange={(e) => setF({ ...f, halfDay: e.target.checked })} />
            ลาครึ่งวัน
          </label>
        )}
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="lv-reason">เหตุผล</Label>
          <Input id="lv-reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        </div>
      </div>
      <Button className="mt-4 w-full" onClick={() => void save()} disabled={busy || !f.startDate || !f.endDate}>
        {busy && <Loader2 className="animate-spin" />} ส่งใบลา
      </Button>
    </DialogContent>
  );
}

function MyPayslips() {
  const q = useQuery({
    queryKey: ["hr", "my-payslips"],
    queryFn: () => api.get<{ itemId: number; period: string; payDate: string; gross: number; net: number }[]>("/hr/my/payslips"),
  });
  if (q.isPending) return <Skeleton className="m-4 h-40" />;
  if (q.isError) return <ErrorNote onRetry={() => q.refetch()} error={q.error} />;
  if (!q.data.length) return <p className="py-10 text-center text-sm text-muted-foreground">ยังไม่มีสลิปเงินเดือน</p>;
  return (
    <ul className="divide-y divide-border p-2">
      {q.data.map((p) => (
        <li key={p.itemId}>
          <Link href={`/hr/payslips/${p.itemId}?mine=1`} className="flex min-h-14 items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-muted/50">
            <span>
              <span className="font-medium">{monthLabel(p.period)}</span>
              <span className="block text-xs text-muted-foreground">จ่ายวันที่ {formatThaiDate(p.payDate)}</span>
            </span>
            <span className="flex items-center gap-3 text-right tabular-nums">
              <span>
                <span className="font-semibold">{formatMoney(p.net)}</span>
                <span className="block text-xs text-muted-foreground">รายได้ {formatMoney(p.gross)}</span>
              </span>
              <Printer className="size-4 text-muted-foreground" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Approvals() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<"pending" | "">("pending");
  const q = useQuery({ queryKey: ["hr", "leave", "all", status], queryFn: () => api.get<LeaveRequest[]>("/hr/leave", status ? { status } : {}) });
  const decide = async (l: LeaveRequest, ok: boolean) => {
    let body: Record<string, unknown> = {};
    if (!ok) {
      const reason = window.prompt(`ไม่อนุมัติใบลา ${l.leaveNo} ของ ${l.employeeName} — เหตุผล`);
      if (!reason) return;
      body = { reason };
    }
    try {
      await api.post(`/hr/leave/${l.id}/${ok ? "approve" : "reject"}`, body);
      toast.success(ok ? "อนุมัติแล้ว" : "บันทึกว่าไม่อนุมัติแล้ว");
      void qc.invalidateQueries({ queryKey: ["hr"] });
      void qc.invalidateQueries({ queryKey: ["documents-hub"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ไม่สำเร็จ");
    }
  };
  return (
    <div className="p-4">
      <div className="mb-3 flex justify-end">
        <NativeSelect aria-label="สถานะ" className="h-10" value={status} onChange={(e) => setStatus(e.target.value as "pending" | "")}>
          <option value="pending">รออนุมัติ</option>
          <option value="">ทั้งหมด</option>
        </NativeSelect>
      </div>
      <LeaveList q={q} onDecide={(l, ok) => void decide(l, ok)} />
    </div>
  );
}
