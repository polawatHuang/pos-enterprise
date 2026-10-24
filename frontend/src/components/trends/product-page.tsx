"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ArrowLeft,
  Calculator,
  ChevronRight,
  Clapperboard,
  Coins,
  ExternalLink,
  Loader2,
  MessageSquareText,
  OctagonAlert,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { KaloExtraKind, TrendDetail } from "@/lib/types";
import { cn, formatCompact, formatDateTime, formatNumber, formatThaiDate } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, Label, Skeleton } from "@/components/ui/primitives";
import { ChecklistSection, LifecycleSection, PhaseChip } from "./lifecycle";
import { AiSearchSection } from "./ai-search";
import { TREND_STATUS } from "./labels";
import { AiAnalysisSection, dash, Metric, PlatformTag, SalesChart, Thumb, TrendActionButtons } from "./trends-view";
import { StackBar } from "./category-detail";
import { baht, Growth, periodShort, VERDICT } from "./kalo-ui";

/**
 * One trend product, everything in one place: Kalodata numbers (sales, growth, channels, creators),
 * our lifecycle phase + 9-point checklist, the guide's 30-point score with stop rules, a commission
 * calculator, on-demand insights (selling points, customer voice, top videos, creators) and AI analysis.
 */
export function TrendProductPage({ id }: { id: number }) {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["trends", "detail", id], queryFn: () => api.get<TrendDetail>(`/scraping/trends/${id}`) });
  if (q.isPending) return <Skeleton className="h-[80vh] w-full rounded-xl" />;
  if (q.isError) return <p className="py-16 text-center text-muted-foreground">{q.error.message}</p>;
  const t = q.data;
  const canRun = can("scraping:run");
  const kalo = t.platform === "kalodata";

  return (
    <div className="space-y-4">
      <nav aria-label="ตำแหน่ง" className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <Link href={kalo ? "/trends" : "/trends/products"} className="inline-flex min-h-10 items-center gap-1 hover:text-foreground">
          <ArrowLeft className="size-4" /> {kalo ? "รายงานหมวดหมู่" : "สินค้าเทรนด์ทั้งหมด"}
        </Link>
        {t.categoryPath.map((c) => (
          <span key={c.id} className="inline-flex items-center gap-1">
            <ChevronRight className="size-3.5" />
            <Link href={`/trends/categories/${c.id}`} className="min-h-10 content-center hover:text-foreground">
              {c.name}
            </Link>
          </span>
        ))}
      </nav>

      <Card className="p-4">
        <div className="flex flex-col gap-4 sm:flex-row">
          <Thumb src={t.imageUrl} className="size-28 sm:size-32" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <PlatformTag platform={t.platform} />
              <Badge tone={TREND_STATUS[t.status].tone}>{TREND_STATUS[t.status].label}</Badge>
              <PhaseChip phase={t.phase} />
              {t.selectVerdict && <Badge tone={VERDICT[t.selectVerdict].tone}>{VERDICT[t.selectVerdict].label}</Badge>}
            </div>
            <h1 className="text-xl font-semibold leading-snug">{t.title}</h1>
            <p className="text-sm text-muted-foreground">
              {t.shopName && `ร้าน ${t.shopName} · `}
              {t.category && `${t.category} · `}
              {t.categoryRank != null && `อันดับ ${t.categoryRank} ในหมวด · `}
              {t.launchDate && `วางขาย ${formatThaiDate(t.launchDate)} · `}
              อัปเดต {formatDateTime(t.lastSeenAt)}
            </p>
            {t.url && (
              <a
                href={t.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                เปิดหน้าสินค้า <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
        </div>
        {canRun && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
            <TrendActionButtons t={t} />
          </div>
        )}
      </Card>

      {kalo ? <KaloNumbers t={t} /> : <LegacyNumbers t={t} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card className="p-4">
            <LifecycleSection t={t} canEdit={canRun} />
          </Card>
          <Card className="p-4">
            <ChecklistSection key={`${t.id}-${t.lastSeenAt}-${t.pickScore}`} t={t} canEdit={canRun} />
          </Card>
        </div>
        <div className="space-y-4">
          <SelectScoreCard t={t} canEdit={canRun} />
          <CommissionCalculator t={t} />
        </div>
      </div>

      {kalo && <Insights t={t} canRun={canRun} />}
      {t.aiSearch && (
        <Card className="p-4">
          <AiSearchSection a={t.aiSearch} />
        </Card>
      )}
      <Card className="p-4">
        <AiAnalysisSection t={t} />
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- numbers */

function KaloNumbers({ t }: { t: TrendDetail }) {
  const detail = t.extras.detail?.data as { revenue_trend?: number[]; min_price?: number; max_price?: number } | undefined;
  const split = t.channelSplit ?? {};
  const parts = [
    { label: "วิดีโอ", color: "var(--chart-1)", value: Number(split.video ?? 0) },
    { label: "ไลฟ์", color: "var(--chart-2)", value: Number(split.live ?? 0) },
    { label: "หน้าร้าน/การ์ด", color: "var(--chart-3)", value: Number(split.mall ?? split.showcase ?? 0) },
  ];
  const hasSplit = parts.some((p) => p.value > 0);
  const top = hasSplit ? parts.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="p-4 lg:col-span-3">
        <h2 className="mb-3 font-semibold">ตัวเลขเดือนล่าสุด (Kalodata)</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="ยอดขาย" value={baht(t.revenue)} />
          <Metric label="ขายได้/เดือน" value={dash(t.monthlySold, (v) => `${formatNumber(v)} ชิ้น`)} />
          <div className="min-w-0">
            <p className="truncate text-[11px] text-muted-foreground">เติบโตจากเดือนก่อน</p>
            <Growth value={t.revenueGrowth} className="text-sm font-semibold" />
          </div>
          <Metric
            label="ราคา"
            value={
              detail?.min_price != null && detail.max_price != null && detail.max_price > detail.min_price
                ? `฿${formatNumber(detail.min_price)}–${formatNumber(detail.max_price)}`
                : dash(t.price, (v) => `฿${formatNumber(v)}`)
            }
          />
          <Metric label="ค่าคอม" value={dash(t.commissionRate, (v) => `${v}%`)} />
          <Metric label="ได้ต่อชิ้น" value={dash(t.commissionPerUnit, (v) => `฿${formatNumber(v)}`)} />
          <Metric label="ครีเอเตอร์ที่โปรโมต" value={dash(t.creatorCount, formatNumber)} />
          <Metric label="วิดีโอ / ไลฟ์" value={t.videoCount == null ? "—" : `${formatNumber(t.videoCount)} / ${formatNumber(t.liveCount ?? 0)}`} />
          <Metric label="รีวิว" value={dash(t.reviewCount, formatNumber)} />
          <Metric label="อันดับในหมวด" value={dash(t.categoryRank, (v) => `#${v}`)} />
          <Metric
            label="ครีเอเตอร์/ยอดขาย 100 ชิ้น"
            value={t.creatorCount != null && t.monthlySold ? formatNumber(Math.round((t.creatorCount / t.monthlySold) * 1000) / 10) : "—"}
          />
          <Metric label="วางขาย" value={t.launchDate ? formatThaiDate(t.launchDate) : "—"} />
        </div>
        {t.creatorCount == null && (
          <p className="mt-3 text-xs text-muted-foreground">ยังไม่มีจำนวนครีเอเตอร์/วิดีโอ — กด &quot;อัปเดตรายละเอียด&quot; ในส่วนข้อมูลเชิงลึกด้านล่าง</p>
        )}
      </Card>
      <Card className="space-y-3 p-4 lg:col-span-2">
        <h2 className="font-semibold">ยอดขายรายเดือน</h2>
        <MonthsChart t={t} daily={detail?.revenue_trend} />
        <div>
          <p className="text-sm font-medium">ยอดขายมาจาก</p>
          {hasSplit ? (
            <>
              <StackBar parts={parts} />
              <p className="mt-2 text-xs text-muted-foreground">
                {top?.label === "ไลฟ์"
                  ? "ขายผ่านไลฟ์เป็นหลัก สินค้าอาจต้องสาธิตสด — ถ้าไม่ไลฟ์ ให้ดูคลิปที่ขายได้ก่อนตัดสินใจ"
                  : top?.label === "วิดีโอ"
                    ? "ขายผ่านวิดีโอเป็นหลัก — ถอดสูตรคลิปที่ขายได้หลายคลิป แล้วทดลอง Hook หลายแบบ"
                    : "ขายผ่านหน้าร้าน/การ์ดสินค้ามาก ราคาและโปรโมชันมีผลมาก ไม่ใช่ยอดที่ครีเอเตอร์สร้างโดยตรง"}{" "}
                (สัดส่วนยอดขาย ≠ อัตราการซื้อ)
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">ยังไม่มีข้อมูลช่องทาง</p>
          )}
        </div>
      </Card>
    </div>
  );
}

function MonthsChart({ t, daily }: { t: TrendDetail; daily?: number[] }) {
  const data =
    t.months.length > 1 ? t.months.map((m) => ({ x: periodShort(m.period), v: m.revenue ?? 0 })) : (daily ?? []).map((v, i) => ({ x: String(i + 1), v }));
  if (data.length < 2) return <p className="text-sm text-muted-foreground">มีข้อมูล {t.months.length} เดือน — กราฟจะขึ้นเมื่อดึงข้อมูลเดือนถัดไป</p>;
  return (
    <div className="h-40 w-full" role="img" aria-label={t.months.length > 1 ? "ยอดขายรายเดือน" : "ยอดขายรายวันในเดือนล่าสุด"}>
      {t.months.length <= 1 && <p className="text-xs text-muted-foreground">รายวันในเดือนล่าสุด</p>}
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="x" tickLine={false} axisLine={false} fontSize={10} interval="preserveStartEnd" />
          <YAxis tickFormatter={(v) => formatCompact(Number(v))} tickLine={false} axisLine={false} fontSize={10} width={40} />
          <Tooltip formatter={(v) => [`฿${formatNumber(Number(v))}`, "ยอดขาย"]} cursor={{ fill: "var(--muted)" }} />
          <Bar dataKey="v" fill="var(--chart-1)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function LegacyNumbers({ t }: { t: TrendDetail }) {
  return (
    <Card className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Metric label="ราคา" value={dash(t.price, (v) => `฿${formatNumber(v)}`)} />
        <Metric label="ขายแล้ว" value={dash(t.soldCount, formatNumber)} />
        <Metric label="ชิ้น/วัน" value={dash(t.soldVelocity, (v) => formatNumber(Math.round(v)))} />
        <Metric label="ค่าคอม" value={dash(t.commissionRate, (v) => `${v}%`)} />
        <Metric label="รีวิว" value={dash(t.rating, (v) => `${v.toFixed(1)} ★`)} />
      </div>
      <SalesChart snapshots={t.snapshots} />
    </Card>
  );
}

/* ------------------------------------------------------- 30-point score */

function SelectScoreCard({ t, canEdit }: { t: TrendDetail; canEdit: boolean }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const s = t.selectDetail;
  const setContent = async (v: number | null) => {
    setBusy(true);
    try {
      await api.patch(`/scraping/trends/${t.id}`, { contentScore: v });
      await qc.invalidateQueries({ queryKey: ["trends"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };
  if (!s) return null;
  const v = VERDICT[s.verdict];
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">คะแนนคัดเลือกสินค้า</h2>
          <p className="text-xs text-muted-foreground">6 หัวข้อ หัวข้อละ 1–5 · เครื่องมือจัดลำดับ ไม่ใช่สูตรทำนายยอดขาย</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold tabular-nums">
            {s.total}
            <span className="text-base text-muted-foreground">/30</span>
          </p>
          <Badge tone={v.tone} title={v.hint}>
            {v.label}
            {s.projected != null && s.known < 6 ? ` · คาด ~${s.projected}` : ""}
          </Badge>
        </div>
      </div>
      <ul className="space-y-2.5">
        {s.items.map((i) => (
          <li key={i.key} className="text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{i.label}</span>
              {i.key === "content" && canEdit ? (
                <span className="inline-flex gap-0.5" role="radiogroup" aria-label="ให้คะแนนศักยภาพทำคอนเทนต์">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={i.score === n}
                      aria-label={`${n} คะแนน`}
                      disabled={busy}
                      onClick={() => void setContent(i.score === n ? null : n)}
                      className="grid size-9 place-items-center rounded-md hover:bg-muted"
                    >
                      <Star className={cn("size-5", i.score != null && n <= i.score ? "fill-warning text-warning" : "text-muted-foreground")} />
                    </button>
                  ))}
                </span>
              ) : (
                <Dots score={i.score} />
              )}
            </div>
            <p className="text-xs text-muted-foreground">{i.reason}</p>
          </li>
        ))}
      </ul>
      {s.stops.length > 0 && (
        <div className="space-y-1 rounded-lg bg-danger-soft p-3 text-sm text-danger">
          <p className="flex items-center gap-1.5 font-medium">
            <OctagonAlert className="size-4" /> ควรชะลอ แม้คะแนนสูง
          </p>
          {s.stops.map((x) => (
            <p key={x}>• {x}</p>
          ))}
        </div>
      )}
    </Card>
  );
}

function Dots({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-muted-foreground">ยังไม่รู้</span>;
  return (
    <span className="inline-flex items-center gap-1" aria-label={`${score} จาก 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={cn("size-2.5 rounded-full", n <= score ? (score >= 4 ? "bg-success" : score >= 3 ? "bg-primary" : "bg-warning") : "bg-muted")}
        />
      ))}
      <span className="ml-1 w-4 text-xs tabular-nums">{score}</span>
    </span>
  );
}

/** Guide §9: gross commission = orders × commission per order; per hour = (commission − costs) ÷ hours. */
function CommissionCalculator({ t }: { t: TrendDetail }) {
  const [orders, setOrders] = useState("50");
  const [hours, setHours] = useState("5");
  const [cost, setCost] = useState("0");
  const perUnit = t.commissionPerUnit;
  const gross = perUnit != null ? Number(orders || 0) * perUnit : null;
  const perHour = gross != null && Number(hours) > 0 ? (gross - Number(cost || 0)) / Number(hours) : null;
  return (
    <Card className="space-y-3 p-4">
      <h2 className="flex items-center gap-1.5 font-semibold">
        <Calculator className="size-4 text-primary" /> คำนวณรายได้ค่าคอม
      </h2>
      {perUnit == null ? (
        <p className="text-sm text-muted-foreground">ยังไม่รู้ราคาหรืออัตราค่าคอมของสินค้านี้</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label htmlFor="calc-orders">ออเดอร์ที่คาด</Label>
              <Input id="calc-orders" inputMode="numeric" value={orders} onChange={(e) => setOrders(e.target.value.replace(/\D/g, ""))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="calc-hours">ชั่วโมงทำงาน</Label>
              <Input id="calc-hours" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value.replace(/[^\d.]/g, ""))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="calc-cost">ค่าใช้จ่าย (฿)</Label>
              <Input id="calc-cost" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value.replace(/\D/g, ""))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">ค่าคอมขั้นต้นโดยประมาณ</p>
              <p className="text-lg font-semibold tabular-nums">฿{formatNumber(Math.round(gross ?? 0))}</p>
              <p className="text-xs text-muted-foreground">
                {orders || 0} × ฿{formatNumber(perUnit)}
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">ต่อชั่วโมง</p>
              <p className="text-lg font-semibold tabular-nums">{perHour == null ? "—" : `฿${formatNumber(Math.round(perHour))}`}</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            ยังไม่ใช่รายได้สุทธิ — อาจลดลงจากการยกเลิก คืนสินค้า หรือเงื่อนไขแคมเปญ ยอดขายของคนอื่นไม่รับประกันว่าเราจะขายได้เท่ากัน
          </p>
        </>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- insights */

type Obj = Record<string, unknown>;
const textOf = (o: unknown): string => {
  if (o == null) return "";
  if (typeof o === "string" || typeof o === "number") return String(o);
  if (typeof o !== "object") return "";
  const v = Object.values(o as Obj).find((x) => typeof x === "string" && x.length > 1);
  return typeof v === "string" ? v : "";
};
const countOf = (o: unknown): number | null => {
  if (!o || typeof o !== "object") return null;
  const v = Object.entries(o as Obj).find(([k, x]) => /count|num|total|freq/i.test(k) && typeof x === "number");
  return v ? (v[1] as number) : null;
};

function FetchButton({ t, kind, label }: { t: TrendDetail; kind: KaloExtraKind; label: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const has = Boolean(t.extras[kind]);
  const run = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ cached: boolean; credits: number }>(`/scraping/trends/${t.id}/kalodata/${kind}`);
      toast.success(r.cached ? "ใช้ข้อมูลที่ดึงไว้แล้ว (ไม่เสียเครดิต)" : `ดึงข้อมูลแล้ว ใช้ ${r.credits} เครดิต`);
      await qc.invalidateQueries({ queryKey: ["trends", "detail", t.id] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ดึงข้อมูลไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" variant={has ? "ghost" : "outline"} onClick={() => void run()} disabled={busy}>
      {busy ? <Loader2 className="animate-spin" /> : <Coins className="text-warning" />}
      {has ? "ดึงใหม่" : label} · {t.extraCost[kind]} เครดิต
    </Button>
  );
}

function InsightCard({
  t,
  kind,
  title,
  icon,
  label,
  canRun,
  children,
}: {
  t: TrendDetail;
  kind: KaloExtraKind;
  title: string;
  icon: React.ReactNode;
  label: string;
  canRun: boolean;
  children: React.ReactNode;
}) {
  const e = t.extras[kind];
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 font-semibold">
          {icon} {title}
        </h3>
        {canRun && <FetchButton t={t} kind={kind} label={label} />}
      </div>
      {e ? (
        <>
          {children}
          <p className="text-[11px] text-muted-foreground">ดึงเมื่อ {formatDateTime(e.fetchedAt)} · เปิดดูซ้ำภายใน 14 วันไม่เสียเครดิต</p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">ยังไม่ได้ดึง — ข้อมูลส่วนนี้คิดเครดิตเฉพาะเมื่อกดดึง</p>
      )}
    </Card>
  );
}

const VIDEO_PARTS = [
  "Hook — 1–3 วินาทีแรกหยุดคนดูอย่างไร",
  "Problem — พูดกับใคร แก้ปัญหาอะไร",
  "Demonstration — สาธิตของจริงไหม",
  "Benefits — ประโยชน์ชัดไหม",
  "Proof — มีหลักฐานที่ตรวจสอบได้ไหม",
  "Editing — ความยาว จังหวะ เสียง",
  "CTA — ชวนกดสินค้าอย่างไร",
];

function Insights({ t, canRun }: { t: TrendDetail; canRun: boolean }) {
  const analysis = t.extras.analysis?.data as { highlights?: Obj[]; attributes?: { key: string; value: string }[] } | undefined;
  const comments = t.extras.comments?.data as
    | { comment_summary?: unknown; positive_points?: unknown[]; pain_points?: unknown[]; usage_scenarios?: unknown[] }
    | undefined;
  const videos = (t.extras.videos?.data as Obj[] | undefined) ?? [];
  const creators = (t.extras.creators?.data as Obj[] | undefined) ?? [];
  const summary = comments?.comment_summary;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">ข้อมูลเชิงลึกจาก Kalodata</h2>
          <p className="text-sm text-muted-foreground">ดึงเฉพาะสินค้าที่สนใจจริง — แต่ละส่วนบอกจำนวนเครดิตก่อนกด</p>
        </div>
        {canRun && <FetchButton t={t} kind="detail" label="อัปเดตรายละเอียด" />}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <InsightCard t={t} kind="analysis" title="จุดขายของสินค้า" icon={<Sparkles className="size-4 text-primary" />} label="ดึงจุดขาย" canRun={canRun}>
          <ul className="space-y-1.5 text-sm">
            {(analysis?.highlights ?? []).map((h, i) => (
              <li key={i}>
                <b>{String(h.key_word ?? textOf(h))}</b>
                {h.region_text ? <span className="text-muted-foreground"> — {String(h.region_text)}</span> : null}
              </li>
            ))}
          </ul>
          {!!analysis?.attributes?.length && (
            <div className="flex flex-wrap gap-1.5">
              {analysis.attributes.map((a) => (
                <Badge key={`${a.key}-${a.value}`} tone="neutral">
                  {a.key}: {a.value}
                </Badge>
              ))}
            </div>
          )}
        </InsightCard>

        <InsightCard
          t={t}
          kind="comments"
          title="เสียงลูกค้า (รีวิว)"
          icon={<MessageSquareText className="size-4 text-primary" />}
          label="ดึงสรุปรีวิว"
          canRun={canRun}
        >
          {summary != null && (
            <p className="rounded-lg bg-muted/50 p-3 text-sm">{typeof summary === "string" ? summary : textOf((summary as Obj).summary ?? summary)}</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <PointList title="ลูกค้าชม" icon={<ThumbsUp className="size-3.5 text-success" />} items={comments?.positive_points} />
            <PointList title="ลูกค้าบ่น (ตอบในคลิปได้)" icon={<ThumbsDown className="size-3.5 text-danger" />} items={comments?.pain_points} />
          </div>
          <PointList title="ใช้ในสถานการณ์ไหน (ไอเดียฉากในคลิป)" items={comments?.usage_scenarios} />
        </InsightCard>

        <InsightCard
          t={t}
          kind="videos"
          title="คลิปที่ขายสินค้านี้ได้"
          icon={<Clapperboard className="size-4 text-primary" />}
          label="ดึงคลิปขายดี"
          canRun={canRun}
        >
          <ul className="divide-y divide-border">
            {videos.map((v) => {
              const handle = String(v.belonged_creator_handle ?? "");
              return (
                <li key={String(v.video_id)} className="py-2 text-sm">
                  <a
                    href={handle ? `https://www.tiktok.com/@${handle}/video/${v.video_id}` : `https://www.tiktok.com/video/${v.video_id}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="font-medium hover:text-primary hover:underline"
                  >
                    {String(v.video_title ?? "คลิป")}
                  </a>
                  <p className="text-xs text-muted-foreground">
                    @{handle} · ดู {formatCompact(Number(v.views ?? 0))} · ยอดขาย {baht(v.revenue as number)}
                    {Number(v.ad) === 1 ? " · ยิงโฆษณา" : ""}
                    {v.ads_roas ? ` · ROAS ${v.ads_roas}` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
          <details className="rounded-lg bg-muted/40 p-3 text-sm">
            <summary className="min-h-8 cursor-pointer font-medium">ถอดสูตรคลิป 7 ส่วน (ดูหลายคลิป หาสิ่งที่ซ้ำกัน)</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
              {VIDEO_PARTS.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-muted-foreground">ถอดหลักการ ไม่ลอกบทพูด — แยกสิ่งที่เห็นจริง / ข้อสันนิษฐาน / สิ่งที่ต้องทดสอบ</p>
          </details>
        </InsightCard>

        <InsightCard t={t} kind="creators" title="ครีเอเตอร์ที่ขายได้" icon={<Users className="size-4 text-primary" />} label="ดึงครีเอเตอร์" canRun={canRun}>
          <ul className="divide-y divide-border">
            {creators.map((c) => (
              <li key={String(c.creator_id)} className="flex items-center justify-between gap-2 py-2 text-sm">
                <a href={`https://www.tiktok.com/@${c.creator_handle}`} target="_blank" rel="noreferrer noopener" className="min-w-0 hover:text-primary">
                  <span className="block truncate font-medium">{String(c.creator_nickname ?? c.creator_handle)}</span>
                  <span className="text-xs text-muted-foreground">
                    @{String(c.creator_handle)} · ผู้ติดตาม {formatCompact(Number(c.creator_followers ?? 0))}
                  </span>
                </a>
                <span className="shrink-0 text-right tabular-nums">
                  {baht(c.revenue as number)}
                  <span className="block text-xs text-muted-foreground">{formatNumber(Number(c.sales_volumn ?? 0))} ชิ้น</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">ขายได้หลายคน = สินค้าขายได้จริงไม่ได้พึ่งคลิปไวรัลคลิปเดียว · กระจุกที่ 1–2 คน = เข้ายาก</p>
        </InsightCard>
      </div>
    </section>
  );
}

function PointList({ title, items, icon }: { title: string; items?: unknown[]; icon?: React.ReactNode }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {icon} {title}
      </p>
      <ul className="space-y-1 text-sm">
        {items.slice(0, 6).map((p, i) => (
          <li key={i} className="flex justify-between gap-2">
            <span>{textOf(p)}</span>
            {countOf(p) != null && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatNumber(countOf(p)!)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
