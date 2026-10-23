"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  Clapperboard,
  Coins,
  Flame,
  MessageCircle,
  MessagesSquare,
  Package,
  Receipt,
  RefreshCw,
  ShoppingBag,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { api } from "@/lib/api";
import type {
  ActivityItem,
  Branch,
  CashflowPoint,
  ChannelMix,
  DashboardSummary,
  InboxChannel,
  LowStockItem,
  TopProduct,
  TrendingProduct,
  TrendPoint,
} from "@/lib/types";
import { cn, formatCompact, formatNumber, formatRelativeTime, formatTHB, pctChange } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, NativeSelect, Segmented, Skeleton } from "@/components/ui/primitives";
import { PageHeader } from "@/components/layout/page";
import { CashflowChart, ChannelDonut, SalesTrendChart } from "./charts";
import { channelLabel, Delta, EmptyState, ErrorNote, KpiCard, ListSkeleton, OpsTile } from "./widgets";

type Range = 7 | 30 | 90;
const REFRESH_MS = 60_000;

function useDashboard<T>(path: string, params: Record<string, number | undefined>) {
  return useQuery({
    queryKey: ["dashboard", path, params],
    queryFn: () => api.get<T>(`/dashboard/${path}`, params),
    refetchInterval: REFRESH_MS,
  });
}

export function DashboardView() {
  const [days, setDays] = useState<Range>(30);
  const [branchId, setBranchId] = useState<number | undefined>(undefined);
  const scope = { branchId };
  const ranged = { branchId, days };

  const branches = useQuery({ queryKey: ["org", "branches"], queryFn: () => api.get<Branch[]>("/org/branches"), staleTime: 10 * 60_000 });
  const summary = useDashboard<DashboardSummary>("summary", scope);
  const trend = useDashboard<TrendPoint[]>("sales-trend", ranged);
  const mix = useDashboard<ChannelMix[]>("channel-mix", ranged);
  const top = useDashboard<TopProduct[]>("top-products", { ...ranged, limit: 6 });
  const cashflow = useDashboard<CashflowPoint[]>("cashflow", { branchId, months: 6 });
  const lowStock = useDashboard<LowStockItem[]>("low-stock", { limit: 6 });
  const inbox = useDashboard<InboxChannel[]>("inbox", {});
  const trending = useDashboard<TrendingProduct[]>("trending", { limit: 5 });
  const activity = useDashboard<ActivityItem[]>("activity", { limit: 8 });

  const s = summary.data;
  const refreshAll = () => {
    for (const q of [summary, trend, mix, top, cashflow, lowStock, inbox, trending, activity]) void q.refetch();
  };
  const rangeTotal = trend.data?.reduce((acc, p) => acc + p.revenue, 0) ?? 0;
  const rangeOrders = trend.data?.reduce((acc, p) => acc + p.orders, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="ภาพรวมร้าน"
        description="ภาพรวมยอดขาย บัญชี สต๊อก แชต และการตลาด จากทุกโมดูล"
        actions={
          <>
            <NativeSelect
              aria-label="เลือกสาขา"
              value={branchId ?? ""}
              onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : undefined)}
            >
              <option value="">ทุกสาขา</option>
              {branches.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </NativeSelect>
            <Segmented<Range>
              label="ช่วงเวลา"
              value={days}
              onChange={setDays}
              options={[
                { value: 7, label: "7 วัน" },
                { value: 30, label: "30 วัน" },
                { value: 90, label: "90 วัน" },
              ]}
            />
            <Button variant="outline" size="icon" onClick={refreshAll} aria-label="รีเฟรชข้อมูล" title="รีเฟรช">
              <RefreshCw className={cn(summary.isFetching && "animate-spin")} />
            </Button>
          </>
        }
      />

      {/* KPI row */}
      <section aria-label="ตัวชี้วัดหลัก" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="ยอดขายวันนี้"
          icon={Banknote}
          loading={summary.isPending}
          value={s ? formatTHB(s.today.revenue) : null}
          footer={s && <Delta value={pctChange(s.today.revenue, s.yesterdaySamePeriod.revenue)} suffix="เทียบเมื่อวาน ณ เวลาเดียวกัน" />}
        />
        <KpiCard
          label="ยอดขายเดือนนี้"
          icon={TrendingUp}
          tone="success"
          loading={summary.isPending}
          value={s ? formatTHB(s.monthToDate.revenue) : null}
          footer={s && <Delta value={pctChange(s.monthToDate.revenue, s.previousMonthToDate.revenue)} suffix="เทียบเดือนก่อน" />}
        />
        <KpiCard
          label="กำไรขั้นต้นเดือนนี้"
          icon={Coins}
          tone="info"
          loading={summary.isPending}
          value={s ? formatTHB(s.monthToDate.grossProfit) : null}
          footer={
            s && (
              <span className="text-xs text-muted-foreground">
                มาร์จิ้น{" "}
                <b className="font-medium text-foreground">
                  {s.monthToDate.revenue ? ((s.monthToDate.grossProfit / s.monthToDate.revenue) * 100).toFixed(1) : "0"}%
                </b>{" "}
                · หลังหัก VAT ต้นทุน และค่าธรรมเนียม
              </span>
            )
          }
        />
        <KpiCard
          label="ออร์เดอร์เดือนนี้"
          icon={ShoppingBag}
          tone="warning"
          loading={summary.isPending}
          value={s ? formatNumber(s.monthToDate.orders) : null}
          footer={
            s && (
              <span className="text-xs text-muted-foreground">
                เฉลี่ย <b className="font-medium text-foreground">{formatTHB(s.monthToDate.avgOrderValue)}</b> / บิล
              </span>
            )
          }
        />
      </section>

      {/* Module status strip */}
      <section aria-label="สถานะโมดูล" className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <OpsTile
          href="/inbox"
          icon={MessagesSquare}
          label="แชตที่เปิดอยู่"
          value={s ? formatNumber(s.inbox.open) : "–"}
          hint={s ? `${s.inbox.unread} ข้อความยังไม่อ่าน` : " "}
        />
        <OpsTile
          href="/inbox"
          icon={MessageCircle}
          label="รอแอดมินรับเรื่อง"
          value={s ? formatNumber(s.inbox.needsHuman) : "–"}
          hint="AI ส่งต่อให้คน"
          alert={!!s && s.inbox.needsHuman > 0}
        />
        <OpsTile
          href="/inventory"
          icon={Package}
          label="สินค้าใกล้หมด"
          value={s ? formatNumber(s.inventory.lowStock) : "–"}
          hint="ต่ำกว่าจุดสั่งซื้อ"
          alert={!!s && s.inventory.lowStock > 0}
        />
        <OpsTile
          href="/social"
          icon={CalendarClock}
          label="โพสต์ที่ตั้งเวลา"
          value={s ? formatNumber(s.social.scheduled) : "–"}
          hint={s ? `โพสต์แล้ว ${s.social.published7d} ใน 7 วัน` : " "}
        />
        <OpsTile
          href="/videos"
          icon={Clapperboard}
          label="วิดีโอ AI"
          value={s ? formatNumber(s.video.inProgress) : "–"}
          hint={s ? `กำลังสร้าง · พร้อมโพสต์ ${s.video.ready}` : " "}
        />
        <OpsTile
          href="/accounting"
          icon={Wallet}
          label="กำไรสุทธิเดือนนี้"
          value={s ? formatCompact(s.monthToDate.netProfit) : "–"}
          hint={s ? `ค่าใช้จ่าย ${formatCompact(s.monthToDate.expenses)}` : " "}
          alert={!!s && s.monthToDate.netProfit < 0}
        />
      </section>

      {/* Charts */}
      <section className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>แนวโน้มยอดขาย</CardTitle>
              <CardDescription>
                {days} วันล่าสุด · รวม {formatTHB(rangeTotal)} จาก {formatNumber(rangeOrders)} ออร์เดอร์
              </CardDescription>
            </div>
            <div className="hidden gap-3 text-xs text-muted-foreground sm:flex">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-chart-1" /> ยอดขาย
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-chart-5" /> กำไรขั้นต้น
              </span>
            </div>
          </CardHeader>
          <CardContent>
            {trend.isPending ? <Skeleton className="h-72 w-full" /> : trend.isError ? <ErrorNote onRetry={() => trend.refetch()} /> : <SalesTrendChart data={trend.data} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>ยอดขายตามช่องทาง</CardTitle>
              <CardDescription>{days} วันล่าสุด</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {mix.isPending ? (
              <ListSkeleton />
            ) : mix.isError ? (
              <ErrorNote onRetry={() => mix.refetch()} />
            ) : mix.data.length ? (
              <ChannelDonut data={mix.data} />
            ) : (
              <EmptyState text="ยังไม่มียอดขายในช่วงนี้" />
            )}
          </CardContent>
        </Card>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>รายรับ – รายจ่าย</CardTitle>
              <CardDescription>6 เดือนล่าสุด · รายรับ = ยอดขายสุทธิ VAT + รายได้อื่น</CardDescription>
            </div>
            <Badge tone="primary">
              <Receipt className="size-3" /> บัญชี
            </Badge>
          </CardHeader>
          <CardContent>
            {cashflow.isPending ? <Skeleton className="h-64 w-full" /> : cashflow.isError ? <ErrorNote onRetry={() => cashflow.refetch()} /> : <CashflowChart data={cashflow.data} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>สินค้าขายดี</CardTitle>
              <CardDescription>เรียงตามยอดขาย {days} วัน</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {top.isPending ? (
              <ListSkeleton rows={6} />
            ) : !top.data?.length ? (
              <EmptyState text="ยังไม่มีข้อมูล" />
            ) : (
              <ol className="space-y-3">
                {top.data.map((p, i) => {
                  const max = top.data[0].revenue || 1;
                  return (
                    <li key={p.id}>
                      <div className="flex items-baseline gap-2 text-sm">
                        <span className="w-4 text-xs text-muted-foreground">{i + 1}</span>
                        <span className="truncate font-medium">{p.name}</span>
                        <span className="ml-auto shrink-0 tabular-nums">{formatTHB(p.revenue)}</span>
                      </div>
                      <div className="ml-6 mt-1.5 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${(p.revenue / max) * 100}%` }} />
                        </div>
                        <span className="w-14 text-right text-[11px] text-muted-foreground">{formatNumber(p.quantity)} ชิ้น</span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>สต๊อกต่ำกว่าจุดสั่งซื้อ</CardTitle>
              <CardDescription>ทุกคลังรวมกัน</CardDescription>
            </div>
            <AlertTriangle className="size-4 text-warning" />
          </CardHeader>
          <CardContent>
            {lowStock.isPending ? (
              <ListSkeleton />
            ) : !lowStock.data?.length ? (
              <EmptyState text="สต๊อกเพียงพอทุกรายการ 🎉" />
            ) : (
              <ul className="divide-y divide-border">
                {lowStock.data.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{item.name}</p>
                      <p className="text-[11px] text-muted-foreground">{item.sku}</p>
                    </div>
                    <Badge tone={item.onHand === 0 ? "danger" : "warning"} className="ml-auto shrink-0">
                      {formatNumber(item.onHand)} / {formatNumber(item.reorderPoint)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Unified Inbox</CardTitle>
              <CardDescription>แชตที่ยังเปิดอยู่ตามช่องทาง</CardDescription>
            </div>
            <MessagesSquare className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {inbox.isPending ? (
              <ListSkeleton />
            ) : !inbox.data?.length ? (
              <EmptyState text="ไม่มีแชตค้าง" />
            ) : (
              <ul className="space-y-2.5">
                {inbox.data.map((c) => (
                  <li key={c.platform} className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{channelLabel(c.platform)}</span>
                    {c.unread > 0 && <Badge tone="danger">{c.unread} ใหม่</Badge>}
                    <span className="ml-auto text-muted-foreground">{c.open} ห้อง</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>สินค้าเทรนด์ Affiliate</CardTitle>
              <CardDescription>จาก Data Scraping</CardDescription>
            </div>
            <Flame className="size-4 text-chart-4" />
          </CardHeader>
          <CardContent>
            {trending.isPending ? (
              <ListSkeleton />
            ) : !trending.data?.length ? (
              <EmptyState text="ยังไม่ได้ตั้งค่าแหล่งข้อมูล" />
            ) : (
              <ul className="space-y-3">
                {trending.data.map((t) => (
                  <li key={t.id} className="text-sm">
                    <p className="truncate font-medium">{t.title}</p>
                    <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                      <span>{channelLabel(t.platform)}</span>
                      {t.soldCount != null && <span>ขายแล้ว {formatCompact(t.soldCount)}</span>}
                      {t.commissionRate != null && <span className="text-success">คอม {t.commissionRate}%</span>}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>กิจกรรมล่าสุด</CardTitle>
              <CardDescription>จากทุกโมดูล</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {activity.isPending ? (
              <ListSkeleton />
            ) : !activity.data?.length ? (
              <EmptyState text="ยังไม่มีกิจกรรม" />
            ) : (
              <ul className="space-y-3">
                {activity.data.map((a) => (
                  <li key={`${a.kind}-${a.refId}`} className="flex gap-3 text-sm">
                    <ActivityDot kind={a.kind} />
                    <div className="min-w-0">
                      <p className="truncate">
                        <ActivityText item={a} />
                      </p>
                      <p className="text-[11px] text-muted-foreground">{formatRelativeTime(a.at)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        ข้อมูลอัปเดตอัตโนมัติทุก 1 นาที · ต้องการรายงานเชิงลึก?{" "}
        <Link href="/accounting" className="text-primary hover:underline">
          ไปที่โมดูลบัญชี
        </Link>
      </p>
    </>
  );
}

function ActivityDot({ kind }: { kind: ActivityItem["kind"] }) {
  const cls = {
    order: "bg-primary",
    conversation: "bg-chart-2",
    post: "bg-chart-4",
    expense: "bg-chart-3",
  }[kind];
  return <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", cls)} />;
}

function ActivityText({ item }: { item: ActivityItem }) {
  switch (item.kind) {
    case "order":
      return (
        <>
          ออร์เดอร์ <b className="font-medium">{item.title}</b> จาก {channelLabel(item.detail ?? "")} · {formatTHB(item.amount ?? 0)}
        </>
      );
    case "conversation":
      return (
        <>
          ข้อความจาก <b className="font-medium">{item.title}</b> ทาง {channelLabel(item.detail ?? "")}
        </>
      );
    case "post":
      return (
        <>
          โพสต์ {item.detail === "failed" ? "ล้มเหลว" : "เผยแพร่แล้ว"}: {item.title}
        </>
      );
    case "expense":
      return (
        <>
          บันทึกรายจ่าย {item.detail} · {formatTHB(item.amount ?? 0)}
        </>
      );
  }
}
