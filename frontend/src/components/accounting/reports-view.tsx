"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CheckCircle2, XCircle } from "lucide-react";
import { api, apiFetch } from "@/lib/api";
import type { JournalEntry, Paged, Pnl, PnlLine, TrialBalance } from "@/lib/types";
import { cn, formatMoney, formatThaiDate, monthRange, todayStr } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, Input, Pagination, Segmented, Skeleton, TabBar } from "@/components/ui/primitives";
import { PageHeader } from "@/components/layout/page";

type Preset = "this" | "last" | "quarter" | "year";

function presetRange(p: Preset) {
  if (p === "this") return monthRange(0);
  if (p === "last") return monthRange(-1);
  const now = new Date();
  if (p === "quarter") return { from: monthRange(-2).from, to: monthRange(0).to };
  return { from: `${now.getFullYear()}-01-01`, to: monthRange(0).to };
}

export function ReportsView() {
  const [tab, setTab] = useState<"pnl" | "tb" | "journal">("pnl");
  return (
    <>
      <PageHeader title="รายงานการเงิน" description="สร้างจากบัญชีแยกประเภท (ลงบัญชีคู่อัตโนมัติจาก POS เอกสาร และรายรับ-รายจ่าย)" />
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "pnl", label: "งบกำไรขาดทุน" },
          { value: "tb", label: "งบทดลอง" },
          { value: "journal", label: "สมุดรายวัน" },
        ]}
      />
      <div className="mt-4">{tab === "pnl" ? <PnlPanel /> : tab === "tb" ? <TrialBalancePanel /> : <JournalPanel />}</div>
    </>
  );
}

function PnlPanel() {
  const [preset, setPreset] = useState<Preset>("this");
  const range = presetRange(preset);
  const q = useQuery({
    queryKey: ["accounting", "pnl", range],
    queryFn: () => api.get<Pnl>("/accounting/reports/pnl", range),
    placeholderData: keepPreviousData,
  });
  const d = q.data;
  return (
    <Card>
      <CardHeader className="flex-col sm:flex-row">
        <div>
          <CardTitle>งบกำไรขาดทุน</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatThaiDate(range.from)} – {formatThaiDate(range.to)}
          </p>
        </div>
        <Segmented<Preset>
          label="ช่วงเวลา"
          value={preset}
          onChange={setPreset}
          options={[
            { value: "this", label: "เดือนนี้" },
            { value: "last", label: "เดือนก่อน" },
            { value: "quarter", label: "3 เดือน" },
            { value: "year", label: "ปีนี้" },
          ]}
        />
      </CardHeader>
      <CardContent>
        {!d ? (
          <Skeleton className="h-72 w-full" />
        ) : (
          <table className="w-full max-w-2xl text-sm">
            <tbody>
              <Group title="รายได้" lines={d.revenue} />
              <Total label="รวมรายได้" value={d.totals.revenue} />
              <Group title="ต้นทุนขาย" lines={d.cogs} />
              <Total label="กำไรขั้นต้น" value={d.totals.grossProfit} emphasize />
              <Group title="ค่าใช้จ่ายในการขายและบริหาร" lines={d.expenses} />
              <Total label="รวมค่าใช้จ่าย" value={d.totals.expenses} />
              <Total label={d.totals.netProfit >= 0 ? "กำไรสุทธิ" : "ขาดทุนสุทธิ"} value={d.totals.netProfit} emphasize final />
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function Group({ title, lines }: { title: string; lines: PnlLine[] }) {
  return (
    <>
      <tr>
        <td colSpan={2} className="pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </td>
      </tr>
      {lines.length === 0 && (
        <tr>
          <td className="py-1 pl-4 text-muted-foreground">—</td>
          <td />
        </tr>
      )}
      {lines.map((l) => (
        <tr key={l.code}>
          <td className="py-1 pl-4">
            <span className="mr-2 text-xs text-muted-foreground">{l.code}</span>
            {l.name}
          </td>
          <td className="py-1 text-right tabular-nums">{formatMoney(l.amount)}</td>
        </tr>
      ))}
    </>
  );
}

function Total({ label, value, emphasize, final }: { label: string; value: number; emphasize?: boolean; final?: boolean }) {
  return (
    <tr className={cn("border-t border-border", final && "border-double border-t-4")}>
      <td className={cn("py-2", emphasize && "font-semibold")}>{label}</td>
      <td className={cn("py-2 text-right tabular-nums", emphasize && "font-semibold", final && (value >= 0 ? "text-success" : "text-danger"))}>
        {formatMoney(value)}
      </td>
    </tr>
  );
}

function TrialBalancePanel() {
  const [asOf, setAsOf] = useState(todayStr());
  const q = useQuery({ queryKey: ["accounting", "tb", asOf], queryFn: () => api.get<TrialBalance>("/accounting/reports/trial-balance", { asOf }) });
  const d = q.data;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>งบทดลอง</CardTitle>
          {d && (
            <p className={cn("mt-1 flex items-center gap-1 text-xs", d.balanced ? "text-success" : "text-danger")}>
              {d.balanced ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
              {d.balanced ? "เดบิตเท่ากับเครดิต" : "ไม่สมดุล — กรุณาตรวจสอบ"}
            </p>
          )}
        </div>
        <Input type="date" aria-label="ณ วันที่" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="h-9 w-44" />
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-y border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-2.5 font-medium">รหัส</th>
              <th className="px-5 py-2.5 font-medium">ชื่อบัญชี</th>
              <th className="px-5 py-2.5 text-right font-medium">เดบิต</th>
              <th className="px-5 py-2.5 text-right font-medium">เครดิต</th>
            </tr>
          </thead>
          <tbody>
            {d?.accounts.map((a) => (
              <tr key={a.code} className="border-b border-border last:border-0">
                <td className="px-5 py-2 text-muted-foreground">{a.code}</td>
                <td className="px-5 py-2">{a.name}</td>
                <td className="px-5 py-2 text-right tabular-nums">{a.debit ? formatMoney(a.debit) : ""}</td>
                <td className="px-5 py-2 text-right tabular-nums">{a.credit ? formatMoney(a.credit) : ""}</td>
              </tr>
            ))}
          </tbody>
          {d && (
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td colSpan={2} className="px-5 py-3">
                  รวม
                </td>
                <td className="px-5 py-3 text-right tabular-nums">{formatMoney(d.totalDebit)}</td>
                <td className="px-5 py-3 text-right tabular-nums">{formatMoney(d.totalCredit)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  );
}

function JournalPanel() {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["accounting", "journal", page],
    queryFn: () => apiFetch<Paged<JournalEntry>>("/accounting/reports/journal", { query: { page, pageSize: 15 } }),
    placeholderData: keepPreviousData,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>สมุดรายวันทั่วไป</CardTitle>
      </CardHeader>
      <div className="divide-y divide-border">
        {q.isPending && <Skeleton className="m-5 h-64" />}
        {q.data?.data.map((e) => (
          <div key={e.id} className="px-5 py-3">
            <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
              <span className="font-medium">{e.entryNo}</span>
              <span className="text-muted-foreground">{formatThaiDate(e.date)}</span>
              <span className="min-w-0 flex-1 truncate">{e.description}</span>
            </div>
            <table className="mt-1.5 w-full text-xs">
              <tbody>
                {e.lines.map((l, i) => (
                  <tr key={i}>
                    <td className={cn("w-1/2 py-0.5", l.credit > 0 && "pl-8")}>
                      <span className="mr-1.5 text-muted-foreground">{l.code}</span>
                      {l.name}
                    </td>
                    <td className="py-0.5 text-right tabular-nums">{l.debit ? formatMoney(l.debit) : ""}</td>
                    <td className="w-32 py-0.5 text-right tabular-nums">{l.credit ? formatMoney(l.credit) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      {q.data && <Pagination {...q.data.meta} onChange={setPage} />}
    </Card>
  );
}
