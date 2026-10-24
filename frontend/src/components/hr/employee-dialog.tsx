"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Employee } from "@/lib/types";
import { todayStr } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";

interface Lookups {
  users: { id: number; name: string; email: string; employeeId: number | null }[];
  branches: { id: number; name: string }[];
}

const num = (v: string) => (v === "" ? 0 : Number(v));

/** Add or edit a staff record: identity, job, pay, social security, tax allowances, bank, login link. */
export function EmployeeDialog({ employee, onDone }: { employee: Employee | null; onDone: () => void }) {
  const qc = useQueryClient();
  const lookups = useQuery({ queryKey: ["hr", "lookups"], queryFn: () => api.get<Lookups>("/hr/lookups") });
  const e = employee;
  const [f, setF] = useState({
    empCode: e?.empCode ?? "",
    title: e?.title ?? "",
    fullName: e?.fullName ?? "",
    nationalId: e?.nationalId ?? "",
    birthDate: e?.birthDate ?? "",
    phone: e?.phone ?? "",
    email: e?.email ?? "",
    address: e?.address ?? "",
    position: e?.position ?? "",
    department: e?.department ?? "",
    branchId: e?.branchId ? String(e.branchId) : "",
    userId: e?.userId ? String(e.userId) : "",
    payType: e?.payType ?? "monthly",
    baseSalary: e ? String(e.baseSalary) : "",
    startDate: e?.startDate ?? todayStr(),
    endDate: e?.endDate ?? "",
    ssoEnrolled: e?.ssoEnrolled ?? true,
    taxExtraDeductions: e ? String(e.taxExtraDeductions || "") : "",
    bankName: e?.bankName ?? "",
    bankAccount: e?.bankAccount ?? "",
    annualLeaveDays: e ? String(e.annualLeaveDays) : "6",
    note: e?.note ?? "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: ev.target.value });

  const save = async () => {
    setBusy(true);
    const body = {
      empCode: f.empCode || undefined,
      title: f.title || null,
      fullName: f.fullName,
      nationalId: f.nationalId || null,
      birthDate: f.birthDate || null,
      phone: f.phone || null,
      email: f.email || null,
      address: f.address || null,
      position: f.position || null,
      department: f.department || null,
      branchId: f.branchId ? Number(f.branchId) : null,
      userId: f.userId ? Number(f.userId) : null,
      payType: f.payType,
      baseSalary: num(f.baseSalary),
      startDate: f.startDate,
      endDate: f.endDate || null,
      ssoEnrolled: f.ssoEnrolled,
      taxExtraDeductions: num(f.taxExtraDeductions),
      bankName: f.bankName || null,
      bankAccount: f.bankAccount || null,
      annualLeaveDays: num(f.annualLeaveDays),
      note: f.note || null,
    };
    try {
      if (e) await api.put(`/hr/employees/${e.id}`, body);
      else await api.post("/hr/employees", body);
      void qc.invalidateQueries({ queryKey: ["hr"] });
      toast.success(e ? "บันทึกข้อมูลพนักงานแล้ว" : "เพิ่มพนักงานแล้ว");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const field = (k: keyof typeof f, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`emp-${k}`}>{label}</Label>
      <Input id={`emp-${k}`} value={String(f[k])} onChange={set(k)} {...props} />
    </div>
  );

  return (
    <DialogContent title={e ? `แก้ไข ${e.displayName}` : "เพิ่มพนักงาน"} className="max-w-2xl">
      <div className="grid max-h-[70dvh] gap-4 overflow-y-auto pr-1">
        <section className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="emp-title">คำนำหน้า</Label>
            <NativeSelect id="emp-title" className="h-10 w-full" value={f.title} onChange={set("title")}>
              <option value="">-</option>
              {["นาย", "นาง", "นางสาว"].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="sm:col-span-2">{field("fullName", "ชื่อ-นามสกุล")}</div>
          {field("empCode", "รหัสพนักงาน", { placeholder: "เว้นว่าง = ออกให้อัตโนมัติ" })}
          {field("nationalId", "เลขบัตรประชาชน", { inputMode: "numeric", maxLength: 13 })}
          {field("birthDate", "วันเกิด", { type: "date" })}
          {field("phone", "เบอร์โทร", { inputMode: "tel" })}
          <div className="sm:col-span-2">{field("email", "อีเมล", { type: "email" })}</div>
          <div className="space-y-1.5 sm:col-span-3">
            <Label htmlFor="emp-address">ที่อยู่ (ใช้ใน ภ.ง.ด.1ก / 50 ทวิ)</Label>
            <Textarea id="emp-address" rows={2} value={f.address} onChange={set("address")} />
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          {field("position", "ตำแหน่ง")}
          {field("department", "แผนก")}
          <div className="space-y-1.5">
            <Label htmlFor="emp-branch">สาขา</Label>
            <NativeSelect id="emp-branch" className="h-10 w-full" value={f.branchId} onChange={set("branchId")}>
              <option value="">-</option>
              {lookups.data?.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          {field("startDate", "วันเริ่มงาน", { type: "date" })}
          {field("endDate", "วันที่ลาออก (ถ้ามี)", { type: "date" })}
          <div className="space-y-1.5">
            <Label htmlFor="emp-user">ผูกกับบัญชีผู้ใช้ (ยื่นใบลา ดูสลิป)</Label>
            <NativeSelect id="emp-user" className="h-10 w-full" value={f.userId} onChange={set("userId")}>
              <option value="">ไม่ผูก</option>
              {lookups.data?.users
                .filter((u) => !u.employeeId || u.employeeId === e?.id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
            </NativeSelect>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="emp-paytype">จ่ายแบบ</Label>
            <NativeSelect id="emp-paytype" className="h-10 w-full" value={f.payType} onChange={set("payType")}>
              <option value="monthly">รายเดือน</option>
              <option value="daily">รายวัน</option>
            </NativeSelect>
          </div>
          {field("baseSalary", f.payType === "daily" ? "ค่าจ้างต่อวัน" : "เงินเดือน", { inputMode: "decimal" })}
          {field("annualLeaveDays", "วันลาพักร้อน/ปี", { inputMode: "decimal" })}
          <label className="flex min-h-10 items-center gap-2 text-sm sm:col-span-3">
            <input type="checkbox" className="size-5" checked={f.ssoEnrolled} onChange={(ev) => setF({ ...f, ssoEnrolled: ev.target.checked })} />
            เป็นผู้ประกันตนมาตรา 33 (หักประกันสังคม)
          </label>
          <div className="sm:col-span-3">
            {field("taxExtraDeductions", "ค่าลดหย่อนเพิ่มต่อปี (คู่สมรส บุตร ประกัน กองทุน ฯลฯ ตามที่พนักงานแจ้ง)", { inputMode: "decimal", placeholder: "0" })}
          </div>
          {field("bankName", "ธนาคาร")}
          <div className="sm:col-span-2">{field("bankAccount", "เลขบัญชี")}</div>
          <div className="space-y-1.5 sm:col-span-3">
            <Label htmlFor="emp-note">หมายเหตุ</Label>
            <Input id="emp-note" value={f.note} onChange={set("note")} />
          </div>
        </section>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {e && (
          <>
            <Link href={`/hr/employees/${e.id}/certificate?kind=salary`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              <FileText /> หนังสือรับรองเงินเดือน
            </Link>
            <Link href={`/hr/employees/${e.id}/certificate?kind=employment`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              <FileText /> หนังสือรับรองการทำงาน
            </Link>
          </>
        )}
        <Button className="ml-auto" onClick={() => void save()} disabled={busy || !f.fullName.trim() || !f.startDate}>
          {busy && <Loader2 className="animate-spin" />} บันทึก
        </Button>
      </div>
    </DialogContent>
  );
}
