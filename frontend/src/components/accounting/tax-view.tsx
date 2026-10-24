"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileCheck2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { PP30, WhtReport } from "@/lib/types";
import { formatMoney, formatThaiDate } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, NativeSelect, Skeleton, TabBar } from "@/components/ui/primitives";
import { PageHeader } from "@/components/layout/page";
import { ErrorNote } from "@/components/dashboard/widgets";
import { THAI_MONTHS } from "./labels";
import { PrintHeading, ReportActions } from "./report-actions";

const STATUS_LABEL = { draft: "ร่าง", ready: "พร้อมยื่น", filed: "ยื่นแล้ว" } as const;

export function TaxView() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [tab, setTab] = useState<"PP30" | "PND53" | "PND3">("PP30");
  const years = [now.getFullYear() - 1, now.getFullYear()];

  return (
    <>
      <PageHeader
        title="ภาษี"
        description="ร่างแบบ ภ.พ.30, ภ.ง.ด.3 และ ภ.ง.ด.53 จากข้อมูลในระบบ — ใช้ประกอบการยื่นผ่าน e-Filing ของกรมสรรพากร"
        actions={
          <>
            <NativeSelect aria-label="เดือน" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {THAI_MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="ปี" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y + 543}
                </option>
              ))}
            </NativeSelect>
          </>
        }
      />
      <div className="mb-4 flex gap-2 rounded-lg bg-warning-soft p-3 text-sm text-warning print:hidden">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        ตัวเลขเป็นร่างที่ระบบคำนวณจากข้อมูลที่บันทึกไว้ ควรให้ผู้ทำบัญชีตรวจทานก่อนยื่นจริง
      </div>
      <div className="print:hidden">
        <TabBar
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "PP30", label: "ภ.พ.30 (VAT)" },
            { value: "PND53", label: "ภ.ง.ด.53 (นิติบุคคล)" },
            { value: "PND3", label: "ภ.ง.ด.3 (บุคคลธรรมดา)" },
          ]}
        />
      </div>
      <div className="mt-4">{tab === "PP30" ? <Pp30Panel year={year} month={month} /> : <WhtPanel form={tab} year={year} month={month} />}</div>
    </>
  );
}

function StatusControl({ formType, year, month, saved }: { formType: string; year: number; month: number; saved: PP30["saved"] }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const set = async (status: "ready" | "filed") => {
    try {
      await api.post("/accounting/tax/reports", { formType, year, month, status });
      toast.success(status === "filed" ? "บันทึกว่ายื่นแล้ว" : "บันทึกสถานะพร้อมยื่น");
      void qc.invalidateQueries({ queryKey: ["accounting", "tax"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ไม่สำเร็จ");
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {saved ? (
        <Badge tone={saved.status === "filed" ? "success" : "primary"}>
          {saved.status === "filed" && <CheckCircle2 className="size-3" />}
          {STATUS_LABEL[saved.status]}
          {saved.filed_at ? ` ${formatThaiDate(saved.filed_at)}` : ""}
        </Badge>
      ) : (
        <Badge>ยังไม่ยื่น</Badge>
      )}
      {can("tax:file") && saved?.status !== "filed" && (
        <>
          <Button size="sm" variant="outline" onClick={() => void set("ready")}>
            ตรวจแล้ว พร้อมยื่น
          </Button>
          <Button size="sm" onClick={() => void set("filed")}>
            <FileCheck2 /> บันทึกว่ายื่นแล้ว
          </Button>
        </>
      )}
    </div>
  );
}

function Pp30Panel({ year, month }: { year: number; month: number }) {
  const q = useQuery({ queryKey: ["accounting", "tax", "pp30", year, month], queryFn: () => api.get<PP30>("/accounting/tax/pp30", { year, month }) });
  if (q.isPending) return <Skeleton className="h-80 w-full rounded-xl" />;
  if (q.isError) return <ErrorNote onRetry={() => void q.refetch()} />;
  const d = q.data;
  const b = d.sales.breakdown;
  const period = `${THAI_MONTHS[month - 1]} ${year + 543}`;
  return (
    <div className="print-report grid gap-4 lg:grid-cols-3 print:block">
      <PrintHeading title="ภ.พ.30 — แบบแสดงรายการภาษีมูลค่าเพิ่ม (ร่าง)" subtitle={`เดือนภาษี ${period}`} />
      <Card className="lg:col-span-2">
        <CardHeader className="print:hidden">
          <div>
            <CardTitle>ภ.พ.30 — {period}</CardTitle>
            <CardDescription>{d.dueNote}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusControl formType="PP30" year={year} month={month} saved={d.saved} />
            <ReportActions csvPath="/accounting/tax/pp30.csv" query={{ year, month }} filename={`PP30-${year}-${String(month).padStart(2, "0")}.csv`} />
          </div>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="pb-1 text-left font-medium">รายการ</th>
                <th className="pb-1 text-right font-medium">มูลค่าก่อนภาษี</th>
                <th className="w-32 pb-1 text-right font-medium">ภาษีมูลค่าเพิ่ม</th>
              </tr>
            </thead>
            <tbody>
              <Section title="ภาษีขาย" />
              <Line label={`ยอดขายหน้าร้านและออนไลน์ (${b.orders.count} ออร์เดอร์)`} base={b.orders.base} vat={b.orders.vat} />
              <Line label={`ใบกำกับภาษีที่ออก (${b.taxInvoices.count} ใบ)`} base={b.taxInvoices.base} vat={b.taxInvoices.vat} />
              <Line label={`รายได้อื่นที่มี VAT (${b.otherIncome.count} รายการ)`} base={b.otherIncome.base} vat={b.otherIncome.vat} />
              <Line label={`หัก ใบลดหนี้ (${b.creditNotes.count} ใบ)`} base={-b.creditNotes.base} vat={-b.creditNotes.vat} />
              <Line label="รวมภาษีขาย" base={d.sales.base} vat={d.sales.vat} strong />
              <Section title="ภาษีซื้อ" />
              <Line label={`ค่าใช้จ่ายที่มีใบกำกับภาษี (${d.purchases.count} รายการ)`} base={d.purchases.base} vat={d.purchases.vat} strong />
              {d.purchases.unclaimableVat > 0 && (
                <tr>
                  <td colSpan={3} className="pb-2 text-xs text-muted-foreground">
                    ไม่รวม VAT {formatMoney(d.purchases.unclaimableVat)} จากเอกสารที่ไม่ใช่ใบกำกับเต็มรูป
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card className="flex flex-col justify-center p-6 text-center print:mt-6">
        {d.vatPayable > 0 ? (
          <>
            <p className="text-sm text-muted-foreground">ภาษีที่ต้องชำระ</p>
            <p className="mt-1 text-4xl font-semibold text-danger">{formatMoney(d.vatPayable)}</p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">ภาษีชำระเกิน (เครดิตยกไป)</p>
            <p className="mt-1 text-4xl font-semibold text-success">{formatMoney(d.vatCredit)}</p>
          </>
        )}
        <p className="mt-3 text-xs text-muted-foreground">ภาษีขาย {formatMoney(d.sales.vat)} − ภาษีซื้อ {formatMoney(d.purchases.vat)}</p>
      </Card>
    </div>
  );
}

function Section({ title }: { title: string }) {
  return (
    <tr>
      <td colSpan={3} className="pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:pt-0">
        {title}
      </td>
    </tr>
  );
}

function Line({ label, base, vat, strong }: { label: string; base: number; vat: number; strong?: boolean }) {
  return (
    <tr className={strong ? "border-t border-border font-semibold" : ""}>
      <td className="py-1.5 pr-3">{label}</td>
      <td className="py-1.5 text-right tabular-nums">{formatMoney(base)}</td>
      <td className="w-32 py-1.5 text-right tabular-nums">{formatMoney(vat)}</td>
    </tr>
  );
}

function WhtPanel({ form, year, month }: { form: "PND3" | "PND53"; year: number; month: number }) {
  const q = useQuery({
    queryKey: ["accounting", "tax", form, year, month],
    queryFn: () => api.get<WhtReport>("/accounting/tax/wht", { form, year, month }),
  });
  if (q.isPending) return <Skeleton className="h-80 w-full rounded-xl" />;
  if (q.isError) return <ErrorNote onRetry={() => void q.refetch()} />;
  const d = q.data;
  const title = form === "PND53" ? "ภ.ง.ด.53" : "ภ.ง.ด.3";
  return (
    <Card className="print-report">
      <CardHeader className="print:hidden">
        <div>
          <CardTitle>
            {title} — {THAI_MONTHS[month - 1]} {year + 543}
          </CardTitle>
          <CardDescription>{d.dueNote}</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusControl formType={form} year={year} month={month} saved={d.saved} />
          <ReportActions csvPath="/accounting/tax/wht.csv" query={{ form, year, month }} filename={`${form}-${year}-${String(month).padStart(2, "0")}.csv`} />
        </div>
      </CardHeader>
      <div className="px-5 print:px-0">
        <PrintHeading title={`${title} — รายการภาษีหัก ณ ที่จ่าย (ร่าง)`} subtitle={`เดือนภาษี ${THAI_MONTHS[month - 1]} ${year + 543}`} />
      </div>
      {d.warnings.length > 0 && (
        <div className="mx-5 mb-3 rounded-lg bg-warning-soft p-3 text-sm text-warning print:hidden">
          {d.warnings.map((w) => (
            <p key={w}>⚠️ {w}</p>
          ))}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm print:min-w-0">
          <thead>
            <tr className="border-y border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-2.5 font-medium">#</th>
              <th className="px-5 py-2.5 font-medium">ผู้มีเงินได้</th>
              <th className="px-5 py-2.5 font-medium">วันที่จ่าย</th>
              <th className="px-5 py-2.5 font-medium">ประเภทเงินได้</th>
              <th className="px-5 py-2.5 text-right font-medium">จำนวนเงิน</th>
              <th className="px-5 py-2.5 text-right font-medium">ภาษีที่หัก</th>
              <th className="px-5 py-2.5 font-medium">50 ทวิ</th>
            </tr>
          </thead>
          <tbody>
            {d.items.length === 0 && (
              <tr>
                <td colSpan={7} className="py-12 text-center text-muted-foreground">
                  ไม่มีรายการหัก ณ ที่จ่ายในเดือนนี้
                </td>
              </tr>
            )}
            {d.items.map((i) => (
              <tr key={`${i.source ?? "transaction"}-${i.transactionId ?? i.voucherId}`} className="border-b border-border last:border-0">
                <td className="px-5 py-2.5">{i.seq}</td>
                <td className="px-5 py-2.5">
                  <p className="font-medium">{i.payee ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">{i.taxId ?? "ไม่มีเลขผู้เสียภาษี"}</p>
                </td>
                <td className="px-5 py-2.5 text-muted-foreground">{formatThaiDate(i.date)}</td>
                <td className="px-5 py-2.5">
                  {i.incomeType ?? "–"} {i.rate != null && <span className="text-muted-foreground">({i.rate}%)</span>}
                </td>
                <td className="px-5 py-2.5 text-right tabular-nums">{formatMoney(i.amount)}</td>
                <td className="px-5 py-2.5 text-right font-medium tabular-nums">{formatMoney(i.wht)}</td>
                <td className="px-5 py-2.5">
                  {i.certificateId ? (
                    <Link href={`/accounting/documents/${i.certificateId}`} className="text-primary hover:underline">
                      ดู
                    </Link>
                  ) : i.voucherId ? (
                    <Link href={`/accounting/payables/vouchers/${i.voucherId}`} className="text-xs text-primary hover:underline">
                      ออกจากใบสำคัญจ่าย
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">ยังไม่ออก</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {d.items.length > 0 && (
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td colSpan={4} className="px-5 py-3">
                  รวม {d.totals.count} ราย
                </td>
                <td className="px-5 py-3 text-right tabular-nums">{formatMoney(d.totals.amount)}</td>
                <td className="px-5 py-3 text-right tabular-nums">{formatMoney(d.totals.wht)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  );
}
