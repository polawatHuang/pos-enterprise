"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CheckCircle2, XCircle } from "lucide-react";
import { api, apiFetch } from "@/lib/api";
import type { BalanceSheet, BalanceSheetLine, BalanceSheetSection, JournalEntry, Paged, Pnl, PnlLine, StockLedger, TrialBalance, Warehouse } from "@/lib/types";
import { cn, formatMoney, formatThaiDate, monthRange, todayStr } from "@/lib/utils";
import { Badge, Card, CardContent, CardHeader, CardTitle, Input, NativeSelect, Pagination, Segmented, Skeleton, TabBar } from "@/components/ui/primitives";
import { PageHeader } from "@/components/layout/page";
import { EmptyState, ErrorNote } from "@/components/dashboard/widgets";
import { PrintHeading, ReportActions } from "./report-actions";

type Preset = "this" | "last" | "quarter" | "year";
type Tab = "pnl" | "bs" | "tb" | "journal" | "stock";

function presetRange(p: Preset) {
  if (p === "this") return monthRange(0);
  if (p === "last") return monthRange(-1);
  const now = new Date();
  if (p === "quarter") return { from: monthRange(-2).from, to: monthRange(0).to };
  return { from: `${now.getFullYear()}-01-01`, to: monthRange(0).to };
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Last day of the month before the one containing `date` (YYYY-MM-DD). */
function previousMonthEnd(date: string) {
  const [y, m] = date.split("-").map(Number);
  return ymd(new Date(y, m - 1, 0));
}

export function ReportsView() {
  // the documents hub links straight to a tab: /accounting/reports?tab=stock
  const initial = useSearchParams().get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(initial && ["pnl", "bs", "tb", "journal", "stock"].includes(initial) ? initial : "pnl");
  return (
    <>
      <PageHeader title="รายงานการเงิน" description="สร้างจากบัญชีแยกประเภท (ลงบัญชีคู่อัตโนมัติจาก POS เอกสาร และรายรับ-รายจ่าย)" />
      <div className="print:hidden">
        <TabBar
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "pnl", label: "งบกำไรขาดทุน" },
            { value: "bs", label: "งบแสดงฐานะการเงิน" },
            { value: "tb", label: "งบทดลอง" },
            { value: "journal", label: "สมุดรายวัน" },
            { value: "stock", label: "รายงานสินค้าและวัตถุดิบ" },
          ]}
        />
      </div>
      <div className="mt-4">
        {tab === "pnl" ? (
          <PnlPanel />
        ) : tab === "bs" ? (
          <BalanceSheetPanel />
        ) : tab === "tb" ? (
          <TrialBalancePanel />
        ) : tab === "stock" ? (
          <StockLedgerPanel />
        ) : (
          <JournalPanel />
        )}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- P&L */

function PnlPanel() {
  const [preset, setPreset] = useState<Preset>("this");
  const range = presetRange(preset);
  const q = useQuery({
    queryKey: ["accounting", "pnl", range],
    queryFn: () => api.get<Pnl>("/accounting/reports/pnl", range),
    placeholderData: keepPreviousData,
  });
  const d = q.data;
  const period = `${formatThaiDate(range.from)} – ${formatThaiDate(range.to)}`;
  const empty = d && d.revenue.length + d.cogs.length + d.expenses.length === 0;
  return (
    <Card className="print-report">
      <CardHeader className="flex-col sm:flex-row print:hidden">
        <div>
          <CardTitle>งบกำไรขาดทุน</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{period}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <ReportActions csvPath="/accounting/reports/pnl.csv" query={range} filename={`pnl-${range.from}-${range.to}.csv`} disabled={!d} />
        </div>
      </CardHeader>
      <CardContent>
        <PrintHeading title="งบกำไรขาดทุน" subtitle={`สำหรับงวด ${period}`} />
        {q.isPending ? (
          <Skeleton className="h-72 w-full" />
        ) : !d ? (
          <ErrorNote onRetry={() => void q.refetch()} />
        ) : (
          <>
            {q.isError && <StaleNote onRetry={() => void q.refetch()} />}
            {empty && (
              <p className="mb-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground print:hidden">ยังไม่มีรายการบัญชีรายได้หรือค่าใช้จ่ายในช่วงนี้</p>
            )}
            <table className={cn("w-full max-w-2xl text-sm print:max-w-none", q.isFetching && "opacity-60")}>
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
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** A refetch failed but older data is still on screen. */
function StaleNote({ onRetry }: { onRetry: () => void }) {
  return (
    <p className="mb-3 rounded-lg bg-warning-soft p-3 text-sm text-warning print:hidden">
      โหลดข้อมูลล่าสุดไม่สำเร็จ — กำลังแสดงข้อมูลเดิม{" "}
      <button onClick={onRetry} className="font-medium underline underline-offset-2">
        ลองใหม่
      </button>
    </p>
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

/* ------------------------------------------------------- balance sheet */

function BalanceSheetPanel() {
  const [asOf, setAsOf] = useState(todayStr());
  const [compare, setCompare] = useState(true);
  const compareTo = compare && asOf ? previousMonthEnd(asOf) : undefined;
  const query = { asOf, compareTo };
  const q = useQuery({
    queryKey: ["accounting", "bs", asOf, compareTo],
    queryFn: () => api.get<BalanceSheet>("/accounting/reports/balance-sheet", query),
    enabled: Boolean(asOf),
    placeholderData: keepPreviousData,
  });
  const d = q.data;
  const cmp = Boolean(d?.compareTo);
  return (
    <Card className="print-report">
      <CardHeader className="flex-col sm:flex-row print:hidden">
        <div>
          <CardTitle>งบแสดงฐานะการเงิน</CardTitle>
          {d && <BalanceBadge balanced={d.balanced} difference={d.difference} className="mt-1.5" />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            ณ วันที่
            <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="h-9 w-44" />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="size-4 accent-primary" />
            เทียบสิ้นเดือนก่อน
          </label>
          <ReportActions csvPath="/accounting/reports/balance-sheet.csv" query={query} filename={`balance-sheet-${asOf}.csv`} disabled={!d || !asOf} />
        </div>
      </CardHeader>
      <CardContent>
        <PrintHeading title="งบแสดงฐานะการเงิน" subtitle={asOf ? `ณ วันที่ ${formatThaiDate(asOf)}` : ""} />
        {!asOf ? (
          <EmptyState text="เลือกวันที่ที่ต้องการดูงบ" />
        ) : q.isPending ? (
          <Skeleton className="h-96 w-full" />
        ) : !d ? (
          <ErrorNote onRetry={() => void q.refetch()} />
        ) : (
          <>
            {q.isError && <StaleNote onRetry={() => void q.refetch()} />}
            <div className="overflow-x-auto">
              <table className={cn("w-full min-w-[480px] max-w-3xl text-sm print:min-w-0 print:max-w-none", q.isFetching && "opacity-60")}>
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="py-2 text-left font-medium">รายการ</th>
                    <th className="w-36 py-2 text-right font-medium">{formatThaiDate(d.asOf)}</th>
                    {cmp && <th className="w-36 py-2 text-right font-medium">{formatThaiDate(d.compareTo!)}</th>}
                  </tr>
                </thead>
                <tbody>
                  <Heading title="สินทรัพย์" cmp={cmp} />
                  <BsSection title="สินทรัพย์หมุนเวียน" totalLabel="รวมสินทรัพย์หมุนเวียน" section={d.assets.current} cmp={cmp} />
                  <BsSection title="สินทรัพย์ไม่หมุนเวียน" totalLabel="รวมสินทรัพย์ไม่หมุนเวียน" section={d.assets.nonCurrent} cmp={cmp} optional />
                  <BsTotal label="รวมสินทรัพย์" value={d.totals.assets} previous={d.assets.previousTotal} cmp={cmp} final />

                  <Heading title="หนี้สินและส่วนของเจ้าของ" cmp={cmp} />
                  <BsSection title="หนี้สินหมุนเวียน" totalLabel="รวมหนี้สินหมุนเวียน" section={d.liabilities.current} cmp={cmp} />
                  <BsSection title="หนี้สินไม่หมุนเวียน" totalLabel="รวมหนี้สินไม่หมุนเวียน" section={d.liabilities.nonCurrent} cmp={cmp} optional />
                  <BsTotal label="รวมหนี้สิน" value={d.totals.liabilities} previous={d.liabilities.previousTotal} cmp={cmp} emphasize />
                  <BsSection
                    title="ส่วนของเจ้าของ"
                    totalLabel="รวมส่วนของเจ้าของ"
                    section={{
                      lines: [...d.equity.lines, d.equity.retainedEarnings, d.equity.currentProfit],
                      total: d.equity.total,
                      previousTotal: d.equity.previousTotal,
                    }}
                    cmp={cmp}
                  />
                  <BsTotal
                    label="รวมหนี้สินและส่วนของเจ้าของ"
                    value={d.totals.liabilitiesAndEquity}
                    previous={cmp ? d.liabilities.previousTotal! + d.equity.previousTotal! : null}
                    cmp={cmp}
                    final
                  />
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <BalanceBadge balanced={d.balanced} difference={d.difference} />
              {d.comparison && !d.comparison.balanced && (
                <span className="text-danger">
                  ณ {formatThaiDate(d.comparison.asOf)} ไม่สมดุล ผลต่าง {formatMoney(d.comparison.difference)}
                </span>
              )}
              <span>กำไรงวดปีปัจจุบันนับตั้งแต่ {formatThaiDate(d.fiscalYearStart)} (รอบบัญชีตามปีปฏิทิน)</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function BalanceBadge({ balanced, difference, className }: { balanced: boolean; difference: number; className?: string }) {
  return (
    <Badge tone={balanced ? "success" : "danger"} className={className}>
      {balanced ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
      {balanced ? "สมดุล" : `ไม่สมดุล — ผลต่าง ${formatMoney(difference)}`}
    </Badge>
  );
}

function Heading({ title, cmp }: { title: string; cmp: boolean }) {
  return (
    <tr>
      <td colSpan={cmp ? 3 : 2} className="pb-1 pt-5 text-sm font-semibold">
        {title}
      </td>
    </tr>
  );
}

function BsSection({
  title,
  totalLabel,
  section,
  cmp,
  optional,
}: {
  title: string;
  totalLabel: string;
  section: BalanceSheetSection;
  cmp: boolean;
  optional?: boolean;
}) {
  if (optional && section.lines.length === 0) return null;
  return (
    <>
      <tr>
        <td colSpan={cmp ? 3 : 2} className="pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </td>
      </tr>
      {section.lines.length === 0 && (
        <tr>
          <td className="py-1 pl-4 text-muted-foreground">—</td>
          <td />
          {cmp && <td />}
        </tr>
      )}
      {section.lines.map((l) => (
        <BsLine key={l.code ?? l.name} line={l} cmp={cmp} />
      ))}
      <BsTotal label={totalLabel} value={section.total} previous={section.previousTotal} cmp={cmp} />
    </>
  );
}

function BsLine({ line, cmp }: { line: BalanceSheetLine; cmp: boolean }) {
  return (
    <tr className="break-inside-avoid">
      <td className="py-1 pl-4">
        {line.code ? <span className="mr-2 text-xs text-muted-foreground">{line.code}</span> : <span className="mr-2 inline-block w-8" />}
        {line.name}
      </td>
      <td className={cn("py-1 text-right tabular-nums", line.amount < 0 && "text-danger")}>{formatMoney(line.amount)}</td>
      {cmp && <td className="py-1 text-right tabular-nums text-muted-foreground">{formatMoney(line.previous ?? 0)}</td>}
    </tr>
  );
}

function BsTotal({
  label,
  value,
  previous,
  cmp,
  emphasize,
  final,
}: {
  label: string;
  value: number;
  previous: number | null;
  cmp: boolean;
  emphasize?: boolean;
  final?: boolean;
}) {
  const strong = emphasize || final;
  return (
    <tr className={cn("break-inside-avoid border-t border-border", final && "border-b-4 border-double")}>
      <td className={cn("py-2", strong && "font-semibold")}>{label}</td>
      <td className={cn("py-2 text-right tabular-nums", strong && "font-semibold")}>{formatMoney(value)}</td>
      {cmp && <td className={cn("py-2 text-right tabular-nums text-muted-foreground", strong && "font-semibold")}>{formatMoney(previous ?? 0)}</td>}
    </tr>
  );
}

/* ------------------------------------------------------- trial balance */

function TrialBalancePanel() {
  const [asOf, setAsOf] = useState(todayStr());
  const q = useQuery({
    queryKey: ["accounting", "tb", asOf],
    queryFn: () => api.get<TrialBalance>("/accounting/reports/trial-balance", { asOf }),
    enabled: Boolean(asOf),
    placeholderData: keepPreviousData,
  });
  const d = q.data;
  return (
    <Card className="print-report">
      <CardHeader className="flex-col sm:flex-row print:hidden">
        <div>
          <CardTitle>งบทดลอง</CardTitle>
          {d && (
            <p className={cn("mt-1 flex items-center gap-1 text-xs", d.balanced ? "text-success" : "text-danger")}>
              {d.balanced ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
              {d.balanced ? "เดบิตเท่ากับเครดิต" : "ไม่สมดุล — กรุณาตรวจสอบ"}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" aria-label="ณ วันที่" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="h-9 w-44" />
          <ReportActions csvPath="/accounting/reports/trial-balance.csv" query={{ asOf }} filename={`trial-balance-${asOf}.csv`} disabled={!d || !asOf} />
        </div>
      </CardHeader>
      <div className="px-5 print:px-0">
        <PrintHeading title="งบทดลอง" subtitle={asOf ? `ณ วันที่ ${formatThaiDate(asOf)}` : ""} />
      </div>
      {!asOf ? (
        <EmptyState text="เลือกวันที่ที่ต้องการดูงบ" />
      ) : q.isPending ? (
        <Skeleton className="mx-5 mb-5 h-72" />
      ) : !d ? (
        <ErrorNote onRetry={() => void q.refetch()} />
      ) : d.accounts.length === 0 ? (
        <EmptyState text="ยังไม่มีรายการบัญชี ณ วันที่นี้" />
      ) : (
        <div className={cn("overflow-x-auto", q.isFetching && "opacity-60")}>
          {q.isError && (
            <div className="px-5">
              <StaleNote onRetry={() => void q.refetch()} />
            </div>
          )}
          <table className="w-full min-w-[560px] text-sm print:min-w-0">
            <thead>
              <tr className="border-y border-border text-left text-xs text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">รหัส</th>
                <th className="px-5 py-2.5 font-medium">ชื่อบัญชี</th>
                <th className="px-5 py-2.5 text-right font-medium">เดบิต</th>
                <th className="px-5 py-2.5 text-right font-medium">เครดิต</th>
              </tr>
            </thead>
            <tbody>
              {d.accounts.map((a) => (
                <tr key={a.code} className="break-inside-avoid border-b border-border last:border-0">
                  <td className="px-5 py-2 text-muted-foreground">{a.code}</td>
                  <td className="px-5 py-2">{a.name}</td>
                  <td className="px-5 py-2 text-right tabular-nums">{a.debit ? formatMoney(a.debit) : ""}</td>
                  <td className="px-5 py-2 text-right tabular-nums">{a.credit ? formatMoney(a.credit) : ""}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td colSpan={2} className="px-5 py-3">
                  รวม
                </td>
                <td className="px-5 py-3 text-right tabular-nums">{formatMoney(d.totalDebit)}</td>
                <td className="px-5 py-3 text-right tabular-nums">{formatMoney(d.totalCredit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------- journal */

function JournalPanel() {
  const [page, setPage] = useState(1);
  const [range, setRange] = useState(() => monthRange(0));
  const valid = Boolean(range.from && range.to && range.from <= range.to);
  const setDate = (key: "from" | "to", value: string) => {
    setRange((r) => ({ ...r, [key]: value }));
    setPage(1);
  };
  const q = useQuery({
    queryKey: ["accounting", "journal", range, page],
    queryFn: () => apiFetch<Paged<JournalEntry>>("/accounting/reports/journal", { query: { ...range, page, pageSize: 15 } }),
    enabled: valid,
    placeholderData: keepPreviousData,
  });
  const period = valid ? `${formatThaiDate(range.from)} – ${formatThaiDate(range.to)}` : "";
  return (
    <Card className="print-report">
      <CardHeader className="flex-col sm:flex-row print:hidden">
        <div>
          <CardTitle>สมุดรายวันทั่วไป</CardTitle>
          {q.data && <p className="mt-1 text-xs text-muted-foreground">{q.data.meta.total.toLocaleString("th-TH")} รายการ</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            aria-label="ตั้งแต่วันที่"
            value={range.from}
            max={range.to || undefined}
            onChange={(e) => setDate("from", e.target.value)}
            className="h-9 w-40"
          />
          <span className="text-xs text-muted-foreground">ถึง</span>
          <Input
            type="date"
            aria-label="ถึงวันที่"
            value={range.to}
            min={range.from || undefined}
            onChange={(e) => setDate("to", e.target.value)}
            className="h-9 w-40"
          />
          <ReportActions
            csvPath="/accounting/reports/journal.csv"
            query={range}
            filename={`journal-${range.from}-${range.to}.csv`}
            disabled={!valid || !q.data}
          />
        </div>
      </CardHeader>
      <div className="px-5 print:px-0">
        <PrintHeading title="สมุดรายวันทั่วไป" subtitle={`${period}${q.data && q.data.meta.total > q.data.data.length ? ` (หน้า ${page})` : ""}`} />
      </div>
      {!valid ? (
        <EmptyState text="กรุณาเลือกช่วงวันที่ให้ถูกต้อง (วันเริ่มต้องไม่เกินวันสิ้นสุด)" />
      ) : q.isPending ? (
        <Skeleton className="mx-5 mb-5 h-64" />
      ) : !q.data ? (
        <ErrorNote onRetry={() => void q.refetch()} />
      ) : q.data.data.length === 0 ? (
        <EmptyState text="ไม่มีรายการบัญชีในช่วงวันที่นี้" />
      ) : (
        <>
          {q.isError && (
            <div className="px-5">
              <StaleNote onRetry={() => void q.refetch()} />
            </div>
          )}
          <div className={cn("divide-y divide-border border-t border-border", q.isFetching && "opacity-60")}>
            {q.data.data.map((e) => (
              <div key={e.id} className="break-inside-avoid px-5 py-3 print:px-0">
                <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
                  <span className="font-medium">{e.entryNo}</span>
                  <span className="text-muted-foreground">{formatThaiDate(e.date)}</span>
                  <span className="min-w-0 flex-1 truncate print:whitespace-normal">{e.description}</span>
                  {e.status && e.status !== "posted" && <Badge>{e.status === "void" ? "ยกเลิก" : "ร่าง"}</Badge>}
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
          <div className="print:hidden">
            <Pagination {...q.data.meta} onChange={setPage} />
          </div>
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------- รายงานสินค้าและวัตถุดิบ (ม.87(3)) */

const qtyFmt = (v: number) => (v ? v.toLocaleString("th-TH", { maximumFractionDigits: 3 }) : "");

/** Required of VAT-registered shops that sell goods: receipts, issues and balance per product, per place of business. */
function StockLedgerPanel() {
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [warehouseId, setWarehouseId] = useState("");
  const warehouses = useQuery({ queryKey: ["inventory", "warehouses"], queryFn: () => api.get<Warehouse[]>("/inventory/warehouses") });
  const wh = warehouseId || String(warehouses.data?.[0]?.id ?? "");
  const query = { month, warehouseId: wh };
  const q = useQuery({
    queryKey: ["accounting", "stock-ledger", query],
    queryFn: () => api.get<StockLedger>("/accounting/reports/stock-ledger", query),
    enabled: !!wh && /^\d{4}-\d{2}$/.test(month),
    placeholderData: keepPreviousData,
  });
  const d = q.data;
  const [y, m] = month.split("-").map(Number);
  const monthLabel = new Date(y, (m || 1) - 1, 1).toLocaleDateString("th-TH", { month: "long", year: "numeric" });
  return (
    <Card className="print-report">
      <CardHeader className="flex-col gap-3 sm:flex-row print:hidden">
        <div>
          <CardTitle>รายงานสินค้าและวัตถุดิบ</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">ตามมาตรา 87(3) แห่งประมวลรัษฎากร · แยกตามสถานประกอบการ (คลัง) · ขายหน้าร้านรวมเป็นยอดต่อวัน</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="month" aria-label="เดือน" className="h-9 w-40" value={month} onChange={(e) => setMonth(e.target.value)} />
          <NativeSelect aria-label="คลัง" className="h-9" value={wh} onChange={(e) => setWarehouseId(e.target.value)}>
            {(warehouses.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </NativeSelect>
          <ReportActions csvPath="/accounting/reports/stock-ledger.csv" query={query} filename={`stock-ledger-${month}.csv`} disabled={!d} />
        </div>
      </CardHeader>
      <CardContent>
        <PrintHeading
          title="รายงานสินค้าและวัตถุดิบ"
          subtitle={`เดือน ${monthLabel} · ${d?.warehouse.name ?? ""}${d?.warehouse.branchName ? ` (${d.warehouse.branchName})` : ""}`}
        />
        {q.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : q.isError ? (
          <ErrorNote onRetry={() => q.refetch()} error={q.error} />
        ) : !d?.products.length ? (
          <EmptyState text="ไม่มีการเคลื่อนไหวของสินค้าในเดือนนี้" />
        ) : (
          <div className="space-y-6">
            {d.products.map((p) => (
              <section key={p.productId} className="break-inside-avoid">
                <h3 className="mb-1 text-sm font-semibold">
                  {p.name}{" "}
                  <span className="font-normal text-muted-foreground">
                    ({p.sku} · หน่วย: {p.unit})
                  </span>
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="px-2 py-1.5 font-medium">วันที่</th>
                        <th className="px-2 py-1.5 font-medium">เอกสารอ้างอิง</th>
                        <th className="px-2 py-1.5 font-medium">รายการ</th>
                        <th className="px-2 py-1.5 text-right font-medium">รับ</th>
                        <th className="px-2 py-1.5 text-right font-medium">จ่าย</th>
                        <th className="px-2 py-1.5 text-right font-medium">คงเหลือ</th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      <tr className="border-b border-border text-muted-foreground">
                        <td className="px-2 py-1.5">{formatThaiDate(`${month}-01`)}</td>
                        <td className="px-2 py-1.5" />
                        <td className="px-2 py-1.5">ยอดยกมา</td>
                        <td className="px-2 py-1.5" />
                        <td className="px-2 py-1.5" />
                        <td className="px-2 py-1.5 text-right">{p.opening.toLocaleString("th-TH")}</td>
                      </tr>
                      {p.lines.map((l, i) => (
                        <tr key={i} className="border-b border-border">
                          <td className="whitespace-nowrap px-2 py-1.5">{formatThaiDate(l.date)}</td>
                          <td className="px-2 py-1.5">{l.docNo}</td>
                          <td className="px-2 py-1.5">{l.description}</td>
                          <td className="px-2 py-1.5 text-right text-success">{qtyFmt(l.qtyIn)}</td>
                          <td className="px-2 py-1.5 text-right text-danger">{qtyFmt(l.qtyOut)}</td>
                          <td className="px-2 py-1.5 text-right">{l.balance.toLocaleString("th-TH")}</td>
                        </tr>
                      ))}
                      <tr className="font-semibold">
                        <td className="px-2 py-1.5" colSpan={3}>
                          รวม / ยอดยกไป
                        </td>
                        <td className="px-2 py-1.5 text-right">{qtyFmt(p.totalIn) || "0"}</td>
                        <td className="px-2 py-1.5 text-right">{qtyFmt(p.totalOut) || "0"}</td>
                        <td className="px-2 py-1.5 text-right">{p.closing.toLocaleString("th-TH")}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
