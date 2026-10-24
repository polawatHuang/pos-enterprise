"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { HrOrg } from "@/lib/types";
import { formatMoney, formatThaiDate, todayStr } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Segmented, Skeleton } from "@/components/ui/primitives";
import { ErrorNote } from "@/components/dashboard/widgets";
import { PrintHeading, ReportActions } from "@/components/accounting/report-actions";
import { monthLabel } from "./labels";

type Kind = "pnd1" | "sso" | "pnd1a";

interface Pnd1 {
  org: HrOrg;
  items: { seq: number; employeeId: number; nationalId: string | null; name: string; payDate: string; income: number; wht: number }[];
  totals: { count: number; income: number; wht: number };
  warnings: string[];
  dueNote: string;
}
interface Sso {
  rate: number;
  ceiling: number;
  items: { seq: number; employeeId: number; ssoNumber: string | null; name: string; wage: number; employee: number; employer: number }[];
  totals: { count: number; wage: number; employee: number; employer: number; total: number };
  dueNote: string;
}
interface Pnd1a {
  year: number;
  items: { seq: number; employeeId: number; nationalId: string | null; name: string; address: string | null; income: number; wht: number; sso: number }[];
  totals: { count: number; income: number; wht: number };
  dueNote: string;
}

/** ภ.ง.ด.1 and สปส.1-10 by month, ภ.ง.ด.1ก and 50 ทวิ by year; remitting the month's amounts. */
export function HrReports() {
  const [kind, setKind] = useState<Kind>("pnd1");
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [year, setYear] = useState(Number(todayStr().slice(0, 4)));
  const [y, m] = month.split("-").map(Number);
  return (
    <div className="p-4 print-report">
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Segmented<Kind>
          label="รายงาน"
          value={kind}
          onChange={setKind}
          options={[
            { value: "pnd1", label: "ภ.ง.ด.1" },
            { value: "sso", label: "สปส.1-10" },
            { value: "pnd1a", label: "ภ.ง.ด.1ก / 50 ทวิ" },
          ]}
        />
        {kind === "pnd1a" ? (
          <NativeSelect aria-label="ปี" className="h-10" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {Array.from({ length: 5 }, (_, i) => Number(todayStr().slice(0, 4)) - i).map((yy) => (
              <option key={yy} value={yy}>
                {yy + 543}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <Input type="month" aria-label="เดือน" className="h-10 w-40" value={month} onChange={(e) => setMonth(e.target.value)} />
        )}
      </div>
      {kind === "pnd1" && <Pnd1Panel year={y} month={m} period={month} />}
      {kind === "sso" && <SsoPanel year={y} month={m} period={month} />}
      {kind === "pnd1a" && <Pnd1aPanel year={year} />}
    </div>
  );
}

function Remit({ kind, period, amount }: { kind: "pnd1" | "sso"; period: string; amount: number }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const remits = useQuery({
    queryKey: ["hr", "remittances", period.slice(0, 4)],
    queryFn: () =>
      api.get<{ kind: string; period: string; amount: number; status: string; remitDate: string }[]>("/hr/remittances", { year: period.slice(0, 4) }),
  });
  const done = (remits.data ?? []).filter((r) => r.kind === kind && r.period === period && r.status === "posted");
  const paid = done.reduce((s, r) => s + r.amount, 0);
  const left = Math.round((amount - paid) * 100) / 100;
  const remit = async () => {
    if (!window.confirm(`บันทึกว่านำส่ง${kind === "pnd1" ? "ภาษี ภ.ง.ด.1" : "เงินสมทบประกันสังคม"} ${formatMoney(left)} แล้ว?`)) return;
    setBusy(true);
    try {
      await api.post("/hr/remittances", { kind, period, remitDate: todayStr(), paymentMethod: "transfer" });
      toast.success("บันทึกการนำส่งและลงบัญชีแล้ว");
      void qc.invalidateQueries({ queryKey: ["hr", "remittances"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };
  if (!(amount > 0)) return null;
  return left > 0.004 ? (
    <Button size="sm" variant="outline" onClick={() => void remit()} disabled={busy}>
      {busy ? <Loader2 className="animate-spin" /> : <Send />} บันทึกว่านำส่งแล้ว {formatMoney(left)}
    </Button>
  ) : (
    <span className="text-sm text-success">นำส่งแล้ว {done[0] ? formatThaiDate(done[0].remitDate) : ""}</span>
  );
}

function Pnd1Panel({ year, month, period }: { year: number; month: number; period: string }) {
  const q = useQuery({ queryKey: ["hr", "pnd1", period], queryFn: () => api.get<Pnd1>("/hr/reports/pnd1", { year, month }) });
  if (q.isPending) return <Skeleton className="h-40" />;
  if (q.isError) return <ErrorNote onRetry={() => q.refetch()} error={q.error} />;
  const d = q.data;
  return (
    <>
      <PrintHeading title="ใบแนบ ภ.ง.ด.1" subtitle={`${d.org.legalName || d.org.name} · เลขผู้เสียภาษี ${d.org.taxId ?? "-"} · เดือน ${monthLabel(period)}`} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <p className="text-sm text-muted-foreground">{d.dueNote}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Remit kind="pnd1" period={period} amount={d.totals.wht} />
          <ReportActions csvPath="/hr/reports/pnd1.csv" query={{ year, month }} filename={`pnd1-${period}.csv`} disabled={!d.items.length} />
        </div>
      </div>
      {d.warnings.map((w) => (
        <p key={w} className="mb-1 text-sm text-warning print:hidden">
          ⚠️ {w}
        </p>
      ))}
      <Table
        head={["ลำดับ", "เลขประจำตัวผู้เสียภาษี", "ชื่อ-นามสกุล", "วันที่จ่าย", "เงินได้", "ภาษีที่หัก"]}
        rows={d.items.map((i) => [i.seq, i.nationalId ?? "-", i.name, formatThaiDate(i.payDate), formatMoney(i.income), formatMoney(i.wht)])}
        foot={["", "", `รวม ${d.totals.count} คน`, "", formatMoney(d.totals.income), formatMoney(d.totals.wht)]}
        empty="ยังไม่มีเงินเดือนที่อนุมัติในเดือนนี้"
      />
    </>
  );
}

function SsoPanel({ year, month, period }: { year: number; month: number; period: string }) {
  const q = useQuery({ queryKey: ["hr", "sso", period], queryFn: () => api.get<Sso>("/hr/reports/sso", { year, month }) });
  if (q.isPending) return <Skeleton className="h-40" />;
  if (q.isError) return <ErrorNote onRetry={() => q.refetch()} error={q.error} />;
  const d = q.data;
  return (
    <>
      <PrintHeading
        title="รายละเอียดการนำส่งเงินสมทบ (สปส.1-10 ส่วนที่ 2)"
        subtitle={`เดือน ${monthLabel(period)} · อัตรา ${d.rate}% · เพดานค่าจ้าง ${formatMoney(d.ceiling)}`}
      />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <p className="text-sm text-muted-foreground">{d.dueNote}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Remit kind="sso" period={period} amount={d.totals.total} />
          <ReportActions csvPath="/hr/reports/sso.csv" query={{ year, month }} filename={`sso-1-10-${period}.csv`} disabled={!d.items.length} />
        </div>
      </div>
      <Table
        head={["ลำดับ", "เลขประจำตัวประชาชน", "ชื่อ-นามสกุล", "ค่าจ้าง", "ผู้ประกันตน", "นายจ้าง"]}
        rows={d.items.map((i) => [i.seq, i.ssoNumber ?? "-", i.name, formatMoney(i.wage), formatMoney(i.employee), formatMoney(i.employer)])}
        foot={[
          "",
          "",
          `รวม ${d.totals.count} คน (นำส่งรวม ${formatMoney(d.totals.total)})`,
          formatMoney(d.totals.wage),
          formatMoney(d.totals.employee),
          formatMoney(d.totals.employer),
        ]}
        empty="ยังไม่มีเงินเดือนที่อนุมัติในเดือนนี้"
      />
    </>
  );
}

function Pnd1aPanel({ year }: { year: number }) {
  const q = useQuery({ queryKey: ["hr", "pnd1a", year], queryFn: () => api.get<Pnd1a>("/hr/reports/pnd1a", { year }) });
  if (q.isPending) return <Skeleton className="h-40" />;
  if (q.isError) return <ErrorNote onRetry={() => q.refetch()} error={q.error} />;
  const d = q.data;
  return (
    <>
      <PrintHeading title="ใบแนบ ภ.ง.ด.1ก" subtitle={`ปีภาษี ${year + 543}`} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <p className="text-sm text-muted-foreground">{d.dueNote}</p>
        <ReportActions csvPath="/hr/reports/pnd1a.csv" query={{ year }} filename={`pnd1a-${year}.csv`} disabled={!d.items.length} />
      </div>
      <Table
        head={["ลำดับ", "เลขประจำตัวผู้เสียภาษี", "ชื่อ-นามสกุล", "เงินได้ทั้งปี", "ภาษีที่หัก", "50 ทวิ"]}
        rows={d.items.map((i) => [
          i.seq,
          i.nationalId ?? "-",
          i.name,
          formatMoney(i.income),
          formatMoney(i.wht),
          <Link key="c" href={`/hr/employees/${i.employeeId}/wht?year=${year}`} className="text-primary hover:underline print:hidden">
            พิมพ์
          </Link>,
        ])}
        foot={["", "", `รวม ${d.totals.count} คน`, formatMoney(d.totals.income), formatMoney(d.totals.wht), ""]}
        empty="ยังไม่มีเงินเดือนในปีนี้"
      />
    </>
  );
}

function Table({ head, rows, foot, empty }: { head: string[]; rows: React.ReactNode[][]; foot: React.ReactNode[]; empty: string }) {
  if (!rows.length) return <p className="py-10 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            {head.map((h, i) => (
              <th key={h} className={`px-3 py-2 font-medium ${i >= 3 ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((r, idx) => (
            <tr key={idx} className="border-b border-border">
              {r.map((c, i) => (
                <td key={i} className={`px-3 py-2 ${i >= 3 ? "text-right" : ""}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            {foot.map((c, i) => (
              <td key={i} className={`px-3 py-2 ${i >= 3 ? "text-right" : ""}`}>
                {c}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
