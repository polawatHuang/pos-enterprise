"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeft, ChevronRight, Lightbulb, TrendingUp } from "lucide-react";
import { api, apiFetch } from "@/lib/api";
import type { CategoryPage, TrendItem, TrendListMeta } from "@/lib/types";
import { cn, formatCompact, formatNumber } from "@/lib/utils";
import { Badge, Card, Input, NativeSelect, Pagination, Skeleton, TabBar } from "@/components/ui/primitives";
import { PhaseChip } from "./lifecycle";
import { TREND_STATUS } from "./labels";
import { Thumb } from "./trends-view";
import { baht, CategoryTable, Growth, periodLabel, periodShort, SelectScoreBadge, SignalBadge, Top3Bar } from "./kalo-ui";

type Group = "bestseller" | "rising" | "new" | "commission";
const GROUPS: { value: Group; label: string; hint: string }[] = [
  { value: "bestseller", label: "ขายดีอยู่แล้ว", hint: "มียอดขายสม่ำเสมอ ใช้ศึกษาวิธีนำเสนอ แต่คู่แข่งเยอะ — ลองดูอันดับ 11 ลงไป" },
  { value: "rising", label: "กำลังโต", hint: "ยอดขายโต 20%+ จากเดือนก่อน อาจเข้าได้ก่อนคู่แข่งหนาแน่น — ตรวจว่ากระแสต่อเนื่องไม่ใช่พุ่งชั่วคราว" },
  { value: "new", label: "สินค้าใหม่น่าจับตา", hint: "วางขายไม่เกิน 90 วัน ข้อมูลยังน้อย เก็บเข้ารายการติดตามก่อนลงทุนเยอะ" },
  { value: "commission", label: "ค่าคอมสูง", hint: "ค่าคอม 15%+ ตรวจราคา ความน่าเชื่อถือของร้าน และเงื่อนไขจริงก่อน อย่าเลือกจากค่าคอมอย่างเดียว" },
];
const CHANNEL = [
  { key: "video", label: "วิดีโอ", color: "var(--chart-1)" },
  { key: "live", label: "ไลฟ์", color: "var(--chart-2)" },
  { key: "mall", label: "หน้าร้าน/การ์ดสินค้า", color: "var(--chart-3)" },
] as const;

/** One category: size and growth over time, channel mix, sub-categories, and its products in four groups. */
export function CategoryDetailView({ id, period: initialPeriod }: { id: string; period?: string }) {
  const [period, setPeriod] = useState(initialPeriod ?? "");
  const q = useQuery({
    queryKey: ["trends", "category", id, period],
    queryFn: () => api.get<CategoryPage>(`/scraping/categories/${id}`, period ? { period } : {}),
    placeholderData: keepPreviousData,
  });
  if (q.isPending) return <Skeleton className="h-[70vh] w-full rounded-xl" />;
  if (q.isError) return <p className="py-16 text-center text-muted-foreground">{q.error.message}</p>;
  const c = q.data;
  const insights = readMarket(c);

  return (
    <div className="space-y-4">
      <div>
        <nav aria-label="ตำแหน่งหมวด" className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          <Link href="/trends" className="inline-flex min-h-10 items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-4" /> รายงานหมวดหมู่
          </Link>
          {c.breadcrumb.slice(0, -1).map((b) => (
            <span key={b.id} className="inline-flex items-center gap-1">
              <ChevronRight className="size-3.5" />
              <Link href={`/trends/categories/${b.id}?period=${c.period}`} className="min-h-10 content-center hover:text-foreground">
                {b.name}
              </Link>
            </span>
          ))}
        </nav>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
              <SignalBadge c={c} />
              <Badge tone="neutral">{c.level === 1 ? "หมวดหลัก" : c.level === 2 ? "หมวดรอง" : "หมวดย่อย"}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">TikTok Shop ไทย · ข้อมูล Kalodata · {periodLabel(c.period)}</p>
          </div>
          <NativeSelect aria-label="เดือน" className="h-10 w-full sm:w-auto" value={c.period} onChange={(e) => setPeriod(e.target.value)}>
            {c.periods.map((p) => (
              <option key={p} value={p}>
                {periodLabel(p)}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Kpi label="ยอดขาย" value={baht(c.revenue)} foot={<Growth value={c.growth} />} />
        <Kpi label="ขายได้" value={c.sale == null ? "—" : `${formatCompact(c.sale)} ชิ้น`} />
        <Kpi label="ราคาเฉลี่ย" value={c.avgPrice == null ? "—" : `฿${formatNumber(Math.round(c.avgPrice))}`} />
        <Kpi label="ร้านที่มียอดขาย" value={c.shopNumber == null ? "—" : formatNumber(c.shopNumber)} />
        <Kpi label="สินค้าที่มียอดขาย" value={c.activeProducts == null ? "—" : formatNumber(c.activeProducts)} />
        <Kpi label="ยอดขายเฉลี่ย/ร้าน" value={baht(c.avgShopRevenue)} />
        <Kpi label="3 ร้านแรกครอง" value={<Top3Bar value={c.top3} />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="p-4 lg:col-span-3">
          <h2 className="font-semibold">ยอดขายรายเดือน</h2>
          <p className="mb-2 text-xs text-muted-foreground">ดูว่าโตต่อเนื่องหรือขึ้นลงตามฤดูกาล — ถ้าตามฤดูกาล ให้ทำคอนเทนต์ล่วงหน้าก่อนช่วงขายดี</p>
          <MonthlyBars history={c.history} current={c.period} />
          {c.dailyTrend.length > 1 && (
            <>
              <p className="mt-3 text-xs text-muted-foreground">รายวันใน{periodLabel(c.period)}</p>
              <DailyLine points={c.dailyTrend} />
            </>
          )}
        </Card>
        <Card className="space-y-4 p-4 lg:col-span-2">
          <div>
            <h2 className="font-semibold">ยอดขายมาจากช่องทางไหน</h2>
            {c.channelAdvice ? (
              <>
                <StackBar parts={CHANNEL.map((ch) => ({ label: ch.label, color: ch.color, value: c.channelAdvice!.share[ch.key] }))} />
                <p className="mt-2 rounded-lg bg-muted/50 p-3 text-sm">{c.channelAdvice.advice}</p>
                {c.channels.affiliate != null && c.channels.self != null && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    ครีเอเตอร์พันธมิตร (affiliate) {baht(c.channels.affiliate)} · ครีเอเตอร์ของร้านเอง {baht(c.channels.self)} — affiliate สูง =
                    ร้านในหมวดนี้พึ่งนายหน้า มีงานให้ทำ
                  </p>
                )}
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">สัดส่วนช่องทางมีเฉพาะหมวดหลัก — ดูได้ที่หมวด {c.breadcrumb[0]?.name ?? "หลัก"}</p>
            )}
          </div>
          <div>
            <h2 className="flex items-center gap-1.5 font-semibold">
              <Lightbulb className="size-4 text-warning" /> อ่านตลาดนี้
            </h2>
            <ul className="mt-2 space-y-1.5 text-sm">
              {insights.map((t) => (
                <li key={t} className="flex gap-2">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      {c.children.length > 0 && (
        <Card>
          <div className="border-b border-border p-4">
            <h2 className="font-semibold">หมวดย่อยใน {c.name}</h2>
            <p className="text-xs text-muted-foreground">หมวดใหญ่ที่หดตัวอาจยังมีหมวดย่อยที่โตอยู่ — เลือกหมวดที่โตและไม่กระจุก</p>
          </div>
          <CategoryTable items={c.children} period={c.period} />
        </Card>
      )}

      <ProductsSection categoryId={c.id} categoryName={c.name} />
    </div>
  );
}

function Kpi({ label, value, foot }: { label: string; value: React.ReactNode; foot?: React.ReactNode }) {
  return (
    <Card className="p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
      {foot && <p className="text-xs">{foot}</p>}
    </Card>
  );
}

/** Rule-of-thumb reading from the guide (§2.2): size × growth × concentration. */
function readMarket(c: CategoryPage): string[] {
  const out: string[] = [];
  const g = c.growth;
  const big = c.revenue != null && c.revenue >= 10_000_000;
  if (g != null && g >= 10 && big) out.push("ตลาดใหญ่และกำลังโต มีความต้องการจริง แต่คู่แข่งอาจเยอะ — ดูจำนวนครีเอเตอร์และสินค้าที่ขายได้จริงก่อน");
  else if (g != null && g >= 10) out.push("ตลาดเล็กแต่โตเร็ว อาจเป็นหมวดใหม่ — ตรวจว่าโตต่อเนื่องหลายเดือน ไม่ใช่กระแสชั่วคราว");
  else if (g != null && g <= -10 && big) out.push("ตลาดใหญ่แต่ยอดลดลง อาจอิ่มตัวหรือนอกฤดูกาล — เจาะหาหมวดย่อย/สินค้าที่ยังโต");
  else if (g != null && g <= -10) out.push("ยอดขายหดตัว ยังไม่ควรเริ่มที่หมวดนี้ เว้นแต่มีสินค้าเฉพาะที่โตสวนตลาด");
  else if (g != null) out.push("ยอดขายทรงตัว เลือกสินค้าที่มีหลายครีเอเตอร์ขายได้ และหามุมรีวิวใหม่");
  const months = c.history.filter((h) => h.revenue != null);
  if (months.length >= 4) {
    const vals = months.map((m) => m.revenue as number);
    const spread = (Math.max(...vals) - Math.min(...vals)) / Math.max(...vals);
    if (spread > 0.4) out.push("ยอดขายแต่ละเดือนต่างกันมาก อาจเป็นสินค้าตามฤดูกาล — วางแผนคอนเทนต์ล่วงหน้าก่อนช่วงพีก");
  }
  if (c.top3 != null && c.top3 >= 60) out.push(`3 ร้านแรกครองยอดขาย ${Math.round(c.top3)}% ยอดกระจุก — หาสินค้าทางเลือกที่แข่งได้แทนตัวท็อป`);
  else if (c.top3 != null && c.top3 < 35) out.push("ยอดขายกระจายหลายร้าน ร้านและสินค้าใหม่ยังมีที่ยืน");
  if (!out.length) out.push("ยังมีข้อมูลไม่พอสำหรับสรุป ดึงข้อมูลเพิ่มอีก 1–2 เดือนเพื่อเห็นแนวโน้ม");
  out.push("ตลาดใหญ่ไม่ได้รับประกันยอดขายของเรา — ใช้ข้อมูลนี้เลือกสิ่งที่จะทดสอบ แล้ววัดผลจากคลิปจริง");
  return out;
}

const axisBaht = (v: number) => formatCompact(v);

function MonthlyBars({ history, current }: { history: CategoryPage["history"]; current: string }) {
  const data = history.map((h) => ({ p: periodShort(h.period), revenue: h.revenue ?? 0, current: h.period === current }));
  return (
    <div className="h-48 w-full" role="img" aria-label={`ยอดขายรายเดือน ${history.length} เดือน`}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="p" tickLine={false} axisLine={false} fontSize={11} />
          <YAxis tickFormatter={axisBaht} tickLine={false} axisLine={false} fontSize={11} width={44} />
          <Tooltip formatter={(v) => [`฿${formatNumber(Number(v))}`, "ยอดขาย"]} cursor={{ fill: "var(--muted)" }} />
          <Bar dataKey="revenue" radius={[4, 4, 0, 0]} fill="var(--chart-1)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function DailyLine({ points }: { points: (number | null)[] }) {
  const data = points.map((v, i) => ({ d: i + 1, v }));
  return (
    <div className="h-28 w-full" role="img" aria-label="ยอดขายรายวัน">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <XAxis dataKey="d" tickLine={false} axisLine={false} fontSize={10} interval={4} />
          <YAxis hide />
          <Tooltip formatter={(v) => [`฿${formatNumber(Number(v))}`, "ยอดขาย"]} labelFormatter={(d) => `วันที่ ${d}`} />
          <Line type="monotone" dataKey="v" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StackBar({ parts }: { parts: { label: string; color: string; value: number }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div className="mt-2">
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={parts.map((p) => `${p.label} ${Math.round(p.value)}%`).join(", ")}
      >
        {parts.map((p) => (
          <span key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {parts.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: p.color }} />
            {p.label} <b className="tabular-nums">{Math.round((p.value / total) * 100)}%</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- products */

function ProductsSection({ categoryId, categoryName }: { categoryId: string; categoryName: string }) {
  const router = useRouter();
  const [group, setGroup] = useState<Group>("rising");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [hideTop10, setHideTop10] = useState(false);
  const [page, setPage] = useState(1);
  const query = {
    kaloCategory: categoryId,
    group,
    status: "all",
    minPrice: minPrice || undefined,
    maxPrice: maxPrice || undefined,
    hideTop10: hideTop10 ? "1" : undefined,
    page,
    pageSize: 20,
  };
  const list = useQuery({
    queryKey: ["trends", "list", query],
    queryFn: () => apiFetch<{ data: TrendItem[]; meta: TrendListMeta }>("/scraping/trends", { query }),
    placeholderData: keepPreviousData,
  });
  const reset =
    <T,>(fn: (v: T) => void) =>
    (v: T) => {
      fn(v);
      setPage(1);
    };
  const g = GROUPS.find((x) => x.value === group)!;
  return (
    <Card>
      <div className="border-b border-border px-4 pt-3">
        <h2 className="font-semibold">สินค้าใน {categoryName}</h2>
        <TabBar value={group} onChange={reset(setGroup)} tabs={GROUPS.map((x) => ({ value: x.value, label: x.label }))} />
      </div>
      <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-sm text-muted-foreground">{g.hint}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            inputMode="numeric"
            placeholder="ราคาต่ำสุด"
            aria-label="ราคาต่ำสุด"
            className="h-10 w-28"
            value={minPrice}
            onChange={(e) => reset(setMinPrice)(e.target.value.replace(/\D/g, ""))}
          />
          <Input
            inputMode="numeric"
            placeholder="ราคาสูงสุด"
            aria-label="ราคาสูงสุด"
            className="h-10 w-28"
            value={maxPrice}
            onChange={(e) => reset(setMaxPrice)(e.target.value.replace(/\D/g, ""))}
          />
          <label className="flex h-10 items-center gap-2 whitespace-nowrap rounded-lg border border-input bg-card px-3 text-sm">
            <input type="checkbox" checked={hideTop10} onChange={(e) => reset(setHideTop10)(e.target.checked)} className="size-4 accent-[var(--primary)]" />
            ซ่อนอันดับ 1–10
          </label>
        </div>
      </div>
      {list.isPending ? (
        <Skeleton className="m-4 h-64" />
      ) : !list.data?.data.length ? (
        <div className="grid place-items-center gap-2 py-12 text-center text-sm text-muted-foreground">
          <TrendingUp className="size-7" />
          ยังไม่มีสินค้าในกลุ่มนี้ — ระบบดึงสินค้าขายดี 50 อันดับของหมวดรองที่ใหญ่ที่สุด และสินค้ามาแรง/ใหม่/ค่าคอมสูงทั้งตลาดทุกเดือน
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="table-cards w-full min-w-[1080px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2.5 font-medium">สินค้า</th>
                  <th className="px-3 py-2.5 text-right font-medium">ราคา</th>
                  <th className="px-3 py-2.5 text-right font-medium">ขาย/เดือน</th>
                  <th className="px-3 py-2.5 text-right font-medium">ยอดขาย</th>
                  <th className="px-3 py-2.5 text-right font-medium">เติบโต</th>
                  <th className="px-3 py-2.5 text-right font-medium" title="อัตราค่าคอม และเงินที่ได้ต่อชิ้น">
                    ค่าคอม
                  </th>
                  <th className="px-3 py-2.5 font-medium">Phase</th>
                  <th className="px-3 py-2.5 font-medium" title="คะแนนคัดเลือก 6 หัวข้อ">
                    คะแนน
                  </th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {list.data.data.map((t) => (
                  <tr
                    key={t.id}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/40"
                    onClick={() => router.push(`/trends/${t.id}`)}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-3">
                        <Thumb src={t.imageUrl} className="size-12" />
                        <div className="min-w-0">
                          <Link href={`/trends/${t.id}`} onClick={(e) => e.stopPropagation()} className="line-clamp-2 font-medium hover:text-primary">
                            {t.title}
                          </Link>
                          <p className="truncate text-xs text-muted-foreground">
                            {t.shopName ?? ""}
                            {t.categoryRank != null && (
                              <span className={cn(t.categoryRank <= 10 && "text-warning")}>{` · อันดับ ${t.categoryRank} ในหมวด`}</span>
                            )}
                            {t.status !== "new" && ` · ${TREND_STATUS[t.status].label}`}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td data-label="ราคา" className="px-3 py-2.5 text-right">
                      {t.price == null ? "—" : `฿${formatNumber(t.price)}`}
                    </td>
                    <td data-label="ขาย/เดือน" className="px-3 py-2.5 text-right">
                      {t.monthlySold == null ? "—" : formatNumber(t.monthlySold)}
                    </td>
                    <td data-label="ยอดขาย" className="px-3 py-2.5 text-right font-semibold">
                      {baht(t.revenue)}
                    </td>
                    <td data-label="เติบโต" className="px-3 py-2.5 text-right">
                      <Growth value={t.revenueGrowth} />
                    </td>
                    <td data-label="ค่าคอม" className="px-3 py-2.5 text-right">
                      {t.commissionRate == null ? "—" : `${t.commissionRate}%`}
                      {t.commissionPerUnit != null && <span className="block text-xs text-muted-foreground">฿{formatNumber(t.commissionPerUnit)}/ชิ้น</span>}
                    </td>
                    <td data-label="Phase" className="px-3 py-2.5">
                      {t.phase ? <PhaseChip phase={t.phase} /> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td data-label="คะแนน" className="px-3 py-2.5">
                      <SelectScoreBadge score={t.selectScore} verdict={t.selectVerdict} projected={t.selectProjected} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={20} total={list.data.meta.total} onChange={setPage} />
        </>
      )}
    </Card>
  );
}
