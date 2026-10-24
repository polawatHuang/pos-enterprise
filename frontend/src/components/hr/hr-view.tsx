"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Employee, PayrollRun } from "@/lib/types";
import { cn, formatMoney, formatThaiDate, todayStr } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, Label, Skeleton, TabBar } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { PageHeader } from "@/components/layout/page";
import { ErrorNote } from "@/components/dashboard/widgets";
import { EmployeeDialog } from "./employee-dialog";
import { HrReports } from "./hr-reports";
import { RUN_STATUS, monthLabel } from "./labels";

type Tab = "employees" | "payroll" | "reports" | "settings";

/** พนักงาน & เงินเดือน: staff records, monthly payroll, the PND1 / social security reports, settings. */
export function HrView() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab | null) ?? "employees");
  return (
    <>
      <PageHeader
        title="พนักงาน & เงินเดือน"
        description="ข้อมูลพนักงาน · ทำเงินเดือนรายเดือน (คำนวณประกันสังคมและภาษีหัก ณ ที่จ่ายให้) · สลิปเงินเดือน · ภ.ง.ด.1 / ภ.ง.ด.1ก / สปส.1-10 / 50 ทวิ"
      />
      <Card>
        <div className="px-4 pt-2">
          <TabBar
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "employees", label: "พนักงาน" },
              { value: "payroll", label: "เงินเดือน" },
              { value: "reports", label: "รายงานภาษี / ประกันสังคม" },
              { value: "settings", label: "ตั้งค่า" },
            ]}
          />
        </div>
        {tab === "employees" && <EmployeesPanel />}
        {tab === "payroll" && <PayrollPanel />}
        {tab === "reports" && <HrReports />}
        {tab === "settings" && <SettingsPanel />}
      </Card>
    </>
  );
}

function EmployeesPanel() {
  const [q, setQ] = useState("");
  const [showResigned, setShowResigned] = useState(false);
  const list = useQuery({
    queryKey: ["hr", "employees", showResigned],
    queryFn: () => api.get<Employee[]>("/hr/employees", showResigned ? {} : { status: "active" }),
  });
  const [editing, setEditing] = useState<Employee | "new" | null>(null);
  const rows = (list.data ?? []).filter((e) => !q || `${e.empCode} ${e.fullName} ${e.position ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ / รหัส / ตำแหน่ง" className="h-10 pl-9" aria-label="ค้นหาพนักงาน" />
        </div>
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" className="size-5" checked={showResigned} onChange={(e) => setShowResigned(e.target.checked)} /> รวมคนที่ลาออกแล้ว
        </label>
        <Button className="ml-auto" onClick={() => setEditing("new")}>
          <Plus /> เพิ่มพนักงาน
        </Button>
      </div>
      {list.isPending ? (
        <Skeleton className="h-40" />
      ) : list.isError ? (
        <ErrorNote onRetry={() => list.refetch()} error={list.error} />
      ) : !rows.length ? (
        <p className="py-10 text-center text-sm text-muted-foreground">ยังไม่มีพนักงาน — กด “เพิ่มพนักงาน” เพื่อเริ่มทำเงินเดือน</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-cards w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">พนักงาน</th>
                <th className="px-3 py-2.5 font-medium">ตำแหน่ง / สาขา</th>
                <th className="px-3 py-2.5 text-right font-medium">ค่าจ้าง</th>
                <th className="px-3 py-2.5 font-medium">เริ่มงาน</th>
                <th className="px-3 py-2.5 font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/40" onClick={() => setEditing(e)}>
                  <td className="px-3 py-2.5">
                    <span className="font-medium">{e.displayName}</span>
                    <span className="block text-xs text-muted-foreground">
                      {e.empCode}
                      {e.userEmail ? ` · ${e.userEmail}` : ""}
                    </span>
                  </td>
                  <td data-label="ตำแหน่ง" className="px-3 py-2.5">
                    {e.position ?? "-"}
                    {e.branchName && <span className="block text-xs text-muted-foreground">{e.branchName}</span>}
                  </td>
                  <td data-label="ค่าจ้าง" className="px-3 py-2.5 text-right tabular-nums">
                    {formatMoney(e.baseSalary)}
                    <span className="block text-xs text-muted-foreground">{e.payType === "daily" ? "ต่อวัน" : "ต่อเดือน"}</span>
                  </td>
                  <td data-label="เริ่มงาน" className="px-3 py-2.5 text-muted-foreground">
                    {formatThaiDate(e.startDate)}
                  </td>
                  <td data-label="สถานะ" className="px-3 py-2.5">
                    <Badge tone={e.status === "active" ? "success" : "neutral"}>{e.status === "active" ? "ทำงานอยู่" : "ลาออก"}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && <EmployeeDialog employee={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </div>
  );
}

function PayrollPanel() {
  const router = useRouter();
  const qc = useQueryClient();
  const runs = useQuery({ queryKey: ["hr", "payroll"], queryFn: () => api.get<PayrollRun[]>("/hr/payroll") });
  const [creating, setCreating] = useState(false);
  const monthEnd = (p: string) => {
    const [y, m] = p.split("-").map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  };
  const [period, setPeriod] = useState(todayStr().slice(0, 7));
  const [payDate, setPayDate] = useState(() => monthEnd(todayStr().slice(0, 7)));
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const r = await api.post<PayrollRun>("/hr/payroll", { period, payDate });
      void qc.invalidateQueries({ queryKey: ["hr"] });
      void qc.invalidateQueries({ queryKey: ["documents-hub"] });
      setCreating(false);
      router.push(`/hr/payroll/${r.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "สร้างรอบเงินเดือนไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="p-4">
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus /> ทำเงินเดือนเดือนใหม่
        </Button>
      </div>
      {runs.isPending ? (
        <Skeleton className="h-40" />
      ) : runs.isError ? (
        <ErrorNote onRetry={() => runs.refetch()} error={runs.error} />
      ) : !runs.data.length ? (
        <p className="py-10 text-center text-sm text-muted-foreground">ยังไม่มีรอบเงินเดือน</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-cards w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">เดือน</th>
                <th className="px-3 py-2.5 font-medium">จ่ายวันที่</th>
                <th className="px-3 py-2.5 text-right font-medium">รายได้รวม</th>
                <th className="px-3 py-2.5 text-right font-medium">ภาษี / ประกันสังคม</th>
                <th className="px-3 py-2.5 text-right font-medium">จ่ายสุทธิ</th>
                <th className="px-3 py-2.5 font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {runs.data.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                  <td className="px-3 py-2.5">
                    <Link href={`/hr/payroll/${r.id}`} className={cn("font-medium text-primary hover:underline", r.status === "void" && "line-through")}>
                      {monthLabel(r.period)}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {r.runNo} · {r.headcount} คน
                    </span>
                  </td>
                  <td data-label="จ่ายวันที่" className="px-3 py-2.5 text-muted-foreground">
                    {formatThaiDate(r.payDate)}
                  </td>
                  <td data-label="รายได้รวม" className="px-3 py-2.5 text-right tabular-nums">
                    {formatMoney(r.totalGross)}
                  </td>
                  <td data-label="ภาษี / ประกันสังคม" className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                    {formatMoney(r.totalWht)} / {formatMoney(r.totalSsoEmployee)}
                  </td>
                  <td data-label="จ่ายสุทธิ" className="px-3 py-2.5 text-right font-medium tabular-nums">
                    {formatMoney(r.totalNet)}
                  </td>
                  <td data-label="สถานะ" className="px-3 py-2.5">
                    <Badge tone={RUN_STATUS[r.status].tone}>{RUN_STATUS[r.status].label}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        {creating && (
          <DialogContent
            title="ทำเงินเดือน"
            description="ระบบดึงพนักงานที่ทำงานในเดือนนั้นทุกคน พร้อมคำนวณประกันสังคมและภาษีหัก ณ ที่จ่าย — แก้ไขได้ก่อนอนุมัติ"
            className="max-w-sm"
          >
            <div className="grid gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="run-period">เงินเดือนประจำเดือน</Label>
                <Input
                  id="run-period"
                  type="month"
                  value={period}
                  onChange={(e) => {
                    setPeriod(e.target.value);
                    // pay date follows the month (last day) — still editable below
                    if (/^\d{4}-\d{2}$/.test(e.target.value)) setPayDate(monthEnd(e.target.value));
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="run-pay">วันที่จ่าย</Label>
                <Input id="run-pay" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </div>
              <Button onClick={() => void create()} disabled={busy || !/^\d{4}-\d{2}$/.test(period)}>
                {busy && <Loader2 className="animate-spin" />} สร้างรอบเงินเดือน
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function SettingsPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["hr", "settings"], queryFn: () => api.get<{ sso: { rate: number; floor: number; ceiling: number } }>("/hr/settings") });
  if (q.isPending) return <Skeleton className="m-4 h-40" />;
  if (q.isError) return <ErrorNote onRetry={() => q.refetch()} error={q.error} />;
  return <SsoForm key={JSON.stringify(q.data.sso)} initial={q.data.sso} onSaved={() => void qc.invalidateQueries({ queryKey: ["hr", "settings"] })} />;
}

function SsoForm({ initial, onSaved }: { initial: { rate: number; floor: number; ceiling: number }; onSaved: () => void }) {
  const [rate, setRate] = useState(String(initial.rate));
  const [floor, setFloor] = useState(String(initial.floor));
  const [ceiling, setCeiling] = useState(String(initial.ceiling));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.put("/hr/settings", { sso: { rate: Number(rate), floor: Number(floor), ceiling: Number(ceiling) } });
      toast.success("บันทึกแล้ว — มีผลกับรอบเงินเดือนที่สร้างหรือแก้ไขหลังจากนี้");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid max-w-md gap-3 p-4">
      <p className="text-sm text-muted-foreground">
        ประกันสังคมมาตรา 33: นายจ้างและลูกจ้างจ่ายฝ่ายละ {rate}% ของค่าจ้าง โดยคิดค่าจ้างไม่ต่ำกว่าฐานต่ำสุดและไม่เกินเพดาน (ปี 2569 เพดาน 17,500 บาท สมทบสูงสุด
        875 บาท) — ปรับได้เมื่อประกาศเปลี่ยน
      </p>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="sso-rate">อัตรา (%)</Label>
          <Input id="sso-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sso-floor">ฐานต่ำสุด</Label>
          <Input id="sso-floor" inputMode="decimal" value={floor} onChange={(e) => setFloor(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sso-ceiling">เพดาน</Label>
          <Input id="sso-ceiling" inputMode="decimal" value={ceiling} onChange={(e) => setCeiling(e.target.value)} />
        </div>
      </div>
      <Button onClick={() => void save()} disabled={busy}>
        {busy && <Loader2 className="animate-spin" />} บันทึก
      </Button>
    </div>
  );
}
