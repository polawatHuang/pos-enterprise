"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Employee, HrOrg, Payslip } from "@/lib/types";
import { formatThaiDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { monthLabel, n2 } from "./labels";

const PAPER =
  "print-a4 relative mx-auto w-full max-w-[210mm] bg-white p-8 text-[13px] leading-relaxed text-neutral-900 shadow-sm ring-1 ring-black/5 max-sm:p-5 sm:p-12";

function Frame({ back, backLabel, title, children }: { back: string; backLabel: string; title: string; children: React.ReactNode }) {
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <Link href={back} className="inline-flex min-h-10 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> {backLabel}
          </Link>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        </div>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer /> พิมพ์ / PDF
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl bg-muted/50 p-2 sm:p-6 print:bg-transparent print:p-0">{children}</div>
    </>
  );
}

function Sign({ label }: { label: string }) {
  return (
    <div className="text-center text-xs">
      <div className="mx-auto mb-2 h-10 w-full max-w-48 border-b border-dotted border-neutral-500" />
      <p>{label}</p>
    </div>
  );
}

/** สลิปเงินเดือน — HR opens any (`mine` false), a staff member their own. */
export function PayslipView({ itemId, mine }: { itemId: number; mine?: boolean }) {
  const q = useQuery({
    queryKey: ["hr", "payslip", itemId, mine],
    queryFn: () => api.get<Payslip>(mine ? `/hr/my/payslips/${itemId}` : `/hr/payslips/${itemId}`),
  });
  if (q.isPending) return <Skeleton className="h-[70vh] w-full rounded-xl" />;
  if (q.isError) return <p className="py-16 text-center text-muted-foreground">{q.error.message}</p>;
  const s = q.data;
  const income: [string, number][] = (
    [
      [s.payType === "daily" ? `ค่าจ้าง (${s.daysWorked ?? 0} วัน)` : "เงินเดือน", s.basePay],
      ["ค่าล่วงเวลา", s.overtime],
      ["เบี้ยเลี้ยง / ค่าตำแหน่ง", s.allowance],
      ["โบนัส", s.bonus],
      ["รายได้อื่น", s.otherIncome],
    ] as [string, number][]
  ).filter(([, v]) => v);
  const deductions: [string, number][] = (
    [
      ["หักขาดงาน / ลา", s.deduction],
      ["ประกันสังคม", s.ssoEmployee],
      ["ภาษีหัก ณ ที่จ่าย", s.wht],
    ] as [string, number][]
  ).filter(([, v]) => v);
  return (
    <Frame
      back={mine ? "/hr/leave?tab=payslips" : `/hr?tab=payroll`}
      backLabel={mine ? "สลิปของฉัน" : "เงินเดือน"}
      title={`สลิปเงินเดือน ${monthLabel(s.period)}`}
    >
      <article className={PAPER}>
        <header className="flex flex-col justify-between gap-2 border-b border-neutral-300 pb-3 sm:flex-row">
          <div>
            <p className="text-lg font-bold">{s.org.legalName || s.org.name}</p>
            {s.org.address && <p className="text-xs">{s.org.address}</p>}
          </div>
          <div className="sm:text-right">
            <p className="text-lg font-bold">สลิปเงินเดือน (Pay Slip)</p>
            <p>ประจำเดือน {monthLabel(s.period)}</p>
            <p className="text-xs">จ่ายวันที่ {formatThaiDate(s.payDate)}</p>
          </div>
        </header>
        <section className="mt-3 grid gap-1 sm:grid-cols-2">
          <p>
            ชื่อ <b>{s.name}</b> ({s.empCode})
          </p>
          <p>ตำแหน่ง {s.position ?? "-"}</p>
          {s.bankAccount && (
            <p>
              โอนเข้า {s.bankName ?? ""} {s.bankAccount}
            </p>
          )}
        </section>
        <section className="mt-4 grid gap-4 sm:grid-cols-2">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-y border-neutral-400 bg-neutral-100 text-left">
                <th className="px-2 py-1.5">รายได้</th>
                <th className="px-2 py-1.5 text-right">จำนวนเงิน</th>
              </tr>
            </thead>
            <tbody>
              {income.map(([l, v]) => (
                <tr key={l} className="border-b border-neutral-200">
                  <td className="px-2 py-1.5">{l}</td>
                  <td className="px-2 py-1.5 text-right">{n2(v)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="px-2 py-1.5">รวมรายได้</td>
                <td className="px-2 py-1.5 text-right">{n2(s.gross + s.deduction)}</td>
              </tr>
            </tbody>
          </table>
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-y border-neutral-400 bg-neutral-100 text-left">
                <th className="px-2 py-1.5">รายการหัก</th>
                <th className="px-2 py-1.5 text-right">จำนวนเงิน</th>
              </tr>
            </thead>
            <tbody>
              {deductions.map(([l, v]) => (
                <tr key={l} className="border-b border-neutral-200">
                  <td className="px-2 py-1.5">{l}</td>
                  <td className="px-2 py-1.5 text-right">{n2(v)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="px-2 py-1.5">รวมรายการหัก</td>
                <td className="px-2 py-1.5 text-right">{n2(s.deduction + s.ssoEmployee + s.wht)}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <p className="mt-4 rounded-md bg-neutral-100 px-3 py-2 text-base font-bold">
          รับสุทธิ {n2(s.net)} บาท ({s.netText})
        </p>
        {s.note && <p className="mt-2 text-xs">หมายเหตุ: {s.note}</p>}
        <p className="mt-3 text-xs text-neutral-600">
          สะสมทั้งปีถึงเดือนนี้: เงินได้ {n2(s.ytd.gross)} · ภาษีหัก ณ ที่จ่าย {n2(s.ytd.wht)} · ประกันสังคม {n2(s.ytd.sso)}
        </p>
        <footer className="mt-12 grid grid-cols-2 gap-6 sm:gap-10">
          <Sign label="ผู้จ่ายเงิน" />
          <Sign label="ผู้รับเงิน" />
        </footer>
      </article>
    </Frame>
  );
}

interface Certificate {
  kind: "salary" | "employment";
  org: HrOrg;
  employee: Employee;
  salaryText: string;
}

/** หนังสือรับรองเงินเดือน / หนังสือรับรองการทำงาน. */
export function CertificateView({ employeeId, kind }: { employeeId: number; kind: "salary" | "employment" }) {
  const q = useQuery({
    queryKey: ["hr", "certificate", employeeId, kind],
    queryFn: () => api.get<Certificate>("/hr/reports/certificate", { employeeId, kind }),
  });
  if (q.isPending) return <Skeleton className="h-[70vh] w-full rounded-xl" />;
  if (q.isError) return <p className="py-16 text-center text-muted-foreground">{q.error.message}</p>;
  const { org, employee: e, salaryText } = q.data;
  const title = kind === "salary" ? "หนังสือรับรองเงินเดือน" : "หนังสือรับรองการทำงาน";
  const today = new Date().toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" });
  return (
    <Frame back="/hr" backLabel="พนักงาน" title={`${title} — ${e.displayName}`}>
      <article className={PAPER}>
        <header className="text-center">
          <p className="text-lg font-bold">{org.legalName || org.name}</p>
          {org.address && <p className="text-xs">{org.address}</p>}
          {org.phone && <p className="text-xs">โทร {org.phone}</p>}
        </header>
        <p className="mt-10 text-right">วันที่ {today}</p>
        <p className="mt-8 text-center text-lg font-bold">{title}</p>
        <p className="mt-8 indent-12 leading-loose">
          หนังสือฉบับนี้ให้ไว้เพื่อรับรองว่า <b>{e.displayName}</b>
          {e.nationalId && <> เลขประจำตัวประชาชน {e.nationalId}</>} เป็นพนักงานของ {org.legalName || org.name} ตั้งแต่วันที่ {formatThaiDate(e.startDate)}
          {e.endDate ? <> ถึงวันที่ {formatThaiDate(e.endDate)}</> : <> จนถึงปัจจุบัน</>} ในตำแหน่ง {e.position ?? "-"}
          {e.department && <> แผนก {e.department}</>}
          {kind === "salary" && (
            <>
              {" "}
              ได้รับ{e.payType === "daily" ? "ค่าจ้างวันละ" : "เงินเดือนเดือนละ"} {n2(e.baseSalary)} บาท ({salaryText})
            </>
          )}
        </p>
        <p className="mt-6 indent-12">ออกให้ไว้เพื่อใช้เป็นหลักฐานตามที่พนักงานร้องขอ</p>
        <footer className="mt-24 flex justify-end">
          <div className="text-center text-xs">
            <div className="mx-auto mb-2 h-10 w-56 border-b border-dotted border-neutral-500" />
            <p>ผู้มีอำนาจลงนาม</p>
            <p className="mt-1">( ..................................................... )</p>
          </div>
        </footer>
      </article>
    </Frame>
  );
}

interface WhtYear {
  year: number;
  org: HrOrg;
  employee: Employee;
  income: number;
  wht: number;
  sso: number;
  months: number;
  whtText: string;
}

/** 50 ทวิ for a year of salary (income type 40(1), ภ.ง.ด.1ก). */
export function SalaryWhtView({ employeeId, year }: { employeeId: number; year: number }) {
  const q = useQuery({ queryKey: ["hr", "wht", employeeId, year], queryFn: () => api.get<WhtYear>("/hr/reports/wht-certificate", { employeeId, year }) });
  if (q.isPending) return <Skeleton className="h-[70vh] w-full rounded-xl" />;
  if (q.isError) return <p className="py-16 text-center text-muted-foreground">{q.error.message}</p>;
  const d = q.data;
  return (
    <Frame back="/hr?tab=reports" backLabel="รายงาน" title={`50 ทวิ ปี ${year + 543} — ${d.employee.displayName}`}>
      <article className={PAPER}>
        <p className="text-center text-lg font-bold">หนังสือรับรองการหักภาษี ณ ที่จ่าย</p>
        <p className="text-center text-xs">ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</p>
        <section className="mt-6 space-y-4">
          <div className="rounded-md border border-neutral-300 p-4">
            <p className="mb-1 text-xs text-neutral-500">ผู้มีหน้าที่หักภาษี ณ ที่จ่าย</p>
            <p className="font-semibold">{d.org.legalName || d.org.name}</p>
            <p>เลขประจำตัวผู้เสียภาษีอากร {d.org.taxId ?? "—"}</p>
            <p>{d.org.address}</p>
          </div>
          <div className="rounded-md border border-neutral-300 p-4">
            <p className="mb-1 text-xs text-neutral-500">ผู้ถูกหักภาษี ณ ที่จ่าย</p>
            <p className="font-semibold">{d.employee.displayName}</p>
            <p>เลขประจำตัวผู้เสียภาษีอากร {d.employee.nationalId ?? "—"}</p>
            <p>{d.employee.address}</p>
            <p>
              ลำดับที่ในแบบ: <b>ภ.ง.ด.1ก</b>
            </p>
          </div>
        </section>
        <table className="mt-6 w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-y border-neutral-400 bg-neutral-100 text-left">
              <th className="px-2 py-2">ประเภทเงินได้พึงประเมินที่จ่าย</th>
              <th className="px-2 py-2">ปีภาษีที่จ่าย</th>
              <th className="px-2 py-2 text-right">จำนวนเงินที่จ่าย</th>
              <th className="px-2 py-2 text-right">ภาษีที่หักและนำส่งไว้</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-neutral-200">
              <td className="px-2 py-2">1. เงินเดือน ค่าจ้าง ฯลฯ ตามมาตรา 40(1)</td>
              <td className="px-2 py-2">{year + 543}</td>
              <td className="px-2 py-2 text-right">{n2(d.income)}</td>
              <td className="px-2 py-2 text-right">{n2(d.wht)}</td>
            </tr>
            <tr className="font-bold">
              <td className="px-2 py-2" colSpan={2}>
                รวม
              </td>
              <td className="px-2 py-2 text-right">{n2(d.income)}</td>
              <td className="px-2 py-2 text-right">{n2(d.wht)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-3 rounded-md bg-neutral-100 px-3 py-2 font-semibold">ภาษีที่หักนำส่ง (ตัวอักษร): {d.whtText}</p>
        <p className="mt-3 text-xs">เงินสมทบจ่ายเข้ากองทุนประกันสังคม {n2(d.sso)} บาท</p>
        <p className="mt-1 text-xs">ผู้จ่ายเงิน: (✓) หัก ณ ที่จ่าย</p>
        <p className="mt-1 text-xs">ขอรับรองว่าข้อความและตัวเลขดังกล่าวข้างต้นถูกต้องตรงกับความจริงทุกประการ</p>
        <footer className="mt-16 flex justify-end">
          <Sign label="ผู้มีหน้าที่หักภาษี ณ ที่จ่าย" />
        </footer>
      </article>
    </Frame>
  );
}
