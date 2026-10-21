"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Coins, FileText, Landmark, Receipt, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { api, apiFetch } from "@/lib/api";
import type { AccDocument, AccountingOverview, CashflowPoint, Paged } from "@/lib/types";
import { formatMoney, formatThaiDate, todayStr } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from "@/components/ui/primitives";
import { PageHeader } from "@/components/layout/page";
import { KpiCard, ErrorNote } from "@/components/dashboard/widgets";
import { CashflowChart } from "@/components/dashboard/charts";

export function AccountingOverviewView() {
  const { can } = useAuth();
  const ov = useQuery({ queryKey: ["accounting", "overview"], queryFn: () => api.get<AccountingOverview>("/accounting/reports/overview") });
  const unpaid = useQuery({
    queryKey: ["accounting", "documents", "unpaid"],
    queryFn: () => apiFetch<Paged<AccDocument>>("/accounting/documents", { query: { status: "unpaid", pageSize: 6 } }),
  });
  const cashflow = useQuery({
    queryKey: ["dashboard", "cashflow", { months: 6 }],
    queryFn: () => api.get<CashflowPoint[]>("/dashboard/cashflow", { months: 6 }),
    enabled: can("dashboard:view"),
  });
  const d = ov.data;
  const today = todayStr();

  const shortcuts = [
    { href: "/accounting/transactions", label: "บันทึกรายรับ-รายจ่าย / AI อ่านใบเสร็จ", icon: Wallet },
    { href: "/accounting/documents/new?type=tax_invoice", label: "ออกใบกำกับภาษี", icon: FileText },
    { href: "/accounting/tax", label: "ภ.พ.30 / ภ.ง.ด.3 / ภ.ง.ด.53", icon: Landmark },
    { href: "/accounting/reports", label: "งบกำไรขาดทุน / งบทดลอง", icon: Receipt },
  ];

  return (
    <>
      <PageHeader title="ภาพรวมบัญชี" description="ตัวเลขเดือนนี้จากบัญชีแยกประเภท" />
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="รายได้เดือนนี้" icon={TrendingUp} tone="success" loading={ov.isPending} value={d && formatMoney(d.month.revenue)} />
        <KpiCard label="ค่าใช้จ่ายเดือนนี้ (รวมต้นทุนขาย)" icon={TrendingDown} tone="warning" loading={ov.isPending} value={d && formatMoney(d.month.expense)} />
        <KpiCard
          label={d && d.month.netProfit < 0 ? "ขาดทุนสุทธิ" : "กำไรสุทธิ"}
          icon={Coins}
          tone={d && d.month.netProfit < 0 ? "danger" : "primary"}
          loading={ov.isPending}
          value={d && formatMoney(d.month.netProfit)}
        />
        <KpiCard
          label="VAT ต้องชำระ (ประมาณการ)"
          icon={Landmark}
          tone="info"
          loading={ov.isPending}
          value={d && formatMoney(Math.max(d.vat.estimatedPayable, 0))}
          footer={
            d && (
              <span className="text-xs text-muted-foreground">
                ภาษีขาย {formatMoney(d.vat.output)} · ภาษีซื้อ {formatMoney(d.vat.input)} · หัก ณ ที่จ่ายรอนำส่ง {formatMoney(d.whtToRemit)}
              </span>
            )
          }
        />
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>รายรับ – รายจ่าย 6 เดือน</CardTitle>
              <CardDescription>รายรับ = ยอดขายสุทธิ VAT + รายได้อื่น</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {!can("dashboard:view") ? (
              <p className="py-10 text-center text-sm text-muted-foreground">ต้องมีสิทธิ์ดู Dashboard</p>
            ) : cashflow.data ? (
              <CashflowChart data={cashflow.data} />
            ) : cashflow.isError ? (
              <ErrorNote onRetry={() => cashflow.refetch()} error={cashflow.error} />
            ) : (
              <Skeleton className="h-64 w-full" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>ลูกหนี้ค้างชำระ</CardTitle>
              <CardDescription>
                {d ? `${d.receivables.count} ใบ · ${formatMoney(d.receivables.amount)}` : " "}
                {d && d.receivables.overdue > 0 && <span className="text-danger"> · เกินกำหนด {d.receivables.overdue} ใบ</span>}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {unpaid.isError && <ErrorNote onRetry={() => unpaid.refetch()} error={unpaid.error} />}
            {unpaid.data?.data.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">ไม่มียอดค้างชำระ 🎉</p>}
            <ul className="divide-y divide-border">
              {unpaid.data?.data.map((doc) => {
                const overdue = doc.dueDate && doc.dueDate < today;
                return (
                  <li key={doc.id}>
                    <Link href={`/accounting/documents/${doc.id}`} className="flex items-center gap-3 py-2.5 text-sm hover:text-primary">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{doc.partyName}</p>
                        <p className="text-xs text-muted-foreground">
                          {doc.docNo}
                          {doc.dueDate && ` · ครบกำหนด ${formatThaiDate(doc.dueDate)}`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold tabular-nums">{formatMoney(doc.total)}</p>
                        {overdue && <Badge tone="danger">เกินกำหนด</Badge>}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </section>

      <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {shortcuts.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className="group flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-sm font-medium hover:border-primary/40">
            <span className="grid size-10 place-items-center rounded-lg bg-primary-soft text-primary">
              <Icon className="size-5" />
            </span>
            <span className="flex-1">{label}</span>
            <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
      </section>
    </>
  );
}
