"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown } from "lucide-react";
import type { KaloCategory, SelectVerdict } from "@/lib/types";
import { cn, formatCompact, formatNumber } from "@/lib/utils";
import { Badge } from "@/components/ui/primitives";

type Tone = "neutral" | "primary" | "success" | "danger" | "warning";

/** Reading of a category row (guide §2.2): growing, owned by a few shops, where shops earn well. */
export const SIGNAL: Record<NonNullable<KaloCategory["signal"]>, { label: string; tone: Tone; hint: string }> = {
  opportunity: { label: "น่าเข้า", tone: "success", hint: "กำลังโต ยอดขายไม่กระจุกกับไม่กี่ร้าน และร้านในหมวดขายได้ดี" },
  growing: { label: "กำลังโต", tone: "primary", hint: "ยอดขายโตจากเดือนก่อน ตรวจจำนวนคู่แข่งก่อนเข้า" },
  concentrated: { label: "โตแต่กระจุก", tone: "warning", hint: "ยอดขายส่วนใหญ่อยู่กับ 3 ร้านแรก เข้ายาก ให้หาสินค้าทางเลือก" },
  steady: { label: "ทรงตัว", tone: "neutral", hint: "ยอดขายใกล้เคียงเดือนก่อน" },
  shrinking: { label: "หดตัว", tone: "danger", hint: "ยอดขายลดลง อาจอิ่มตัวหรือนอกฤดูกาล — เจาะหาหมวดย่อยที่ยังโต" },
};

export const baht = (v: number | null | undefined) => (v == null ? "—" : `฿${formatCompact(v)}`);
export const units = (v: number | null | undefined) => (v == null ? "—" : formatCompact(v));
export const periodLabel = (p: string) => {
  const [y, m] = p.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("th-TH", { month: "long", year: "numeric" });
};
export const periodShort = (p: string) => {
  const [y, m] = p.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("th-TH", { month: "short", year: "2-digit" });
};

export function Growth({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value == null) return <span className={cn("text-muted-foreground", className)}>—</span>;
  const up = value > 0;
  const flat = Math.abs(value) < 0.05;
  return (
    <span className={cn("inline-flex items-center gap-0.5 tabular-nums", flat ? "text-muted-foreground" : up ? "text-success" : "text-danger", className)}>
      {!flat && (up ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />)}
      {up ? "+" : ""}
      {formatNumber(Math.round(value * 10) / 10)}%
    </span>
  );
}

/** Share of the category's sales taken by its top 3 shops: high = hard to enter. */
export function Top3Bar({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const tone = value >= 60 ? "bg-danger" : value >= 40 ? "bg-warning" : "bg-success";
  return (
    <span
      className="inline-flex items-center gap-2"
      title={value >= 60 ? "ยอดขายกระจุกกับ 3 ร้านแรก เข้าตลาดยาก" : value >= 40 ? "ค่อนข้างกระจุก" : "ยอดขายกระจายหลายร้าน มีที่ให้ร้านใหม่"}
    >
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        <span className={cn("block h-full rounded-full", tone)} style={{ width: `${Math.min(100, value)}%` }} />
      </span>
      <span className="tabular-nums">{Math.round(value)}%</span>
    </span>
  );
}

/** Tiny line of monthly sales; colour follows the last change. */
export function Sparkline({ points, className }: { points: (number | null)[]; className?: string }) {
  const vals = points.filter((v): v is number => v != null);
  if (vals.length < 2) return <span className="text-xs text-muted-foreground">—</span>;
  const w = 72;
  const h = 24;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const xy = vals.map((v, i) => `${((i / (vals.length - 1)) * (w - 2) + 1).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`);
  const up = vals[vals.length - 1] >= vals[vals.length - 2];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-6 w-[72px]", className)} role="img" aria-label={`แนวโน้ม ${vals.length} เดือน ${up ? "ขาขึ้น" : "ขาลง"}`}>
      <polyline
        points={xy.join(" ")}
        fill="none"
        stroke={up ? "var(--success)" : "var(--danger)"}
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={xy[xy.length - 1].split(",")[0]} cy={xy[xy.length - 1].split(",")[1]} r="2" fill={up ? "var(--success)" : "var(--danger)"} />
    </svg>
  );
}

export function SignalBadge({ c }: { c: Pick<KaloCategory, "signal"> }) {
  if (!c.signal) return null;
  const s = SIGNAL[c.signal];
  return (
    <Badge tone={s.tone} title={s.hint} className="whitespace-nowrap">
      {s.label}
    </Badge>
  );
}

export type CategorySort = "revenue" | "growth" | "sale" | "top3" | "avgShop" | "rank";

function SortHead({
  label,
  k,
  sort,
  dir,
  onSort,
  className,
  hint,
}: {
  label: string;
  k: CategorySort;
  sort: CategorySort;
  dir: "asc" | "desc";
  onSort: (k: CategorySort) => void;
  className?: string;
  hint?: string;
}) {
  const active = sort === k;
  return (
    <th className={cn("px-3 py-2.5 font-medium", className)} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn("inline-flex min-h-8 items-center gap-1 hover:text-foreground", active && "text-foreground")}
        title={hint}
      >
        {label}
        {active ? dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ChevronsUpDown className="size-3 opacity-50" />}
      </button>
    </th>
  );
}

/**
 * The Kalodata-style category ranking: rank, category, sales, growth, units, average price,
 * top-3 shop share, revenue per shop, 6-month line. Row → category page; "หมวดย่อย" drills down.
 */
export function CategoryTable({
  items,
  sort,
  dir,
  onSort,
  onDrill,
  period,
}: {
  items: KaloCategory[];
  sort?: CategorySort;
  dir?: "asc" | "desc";
  onSort?: (k: CategorySort) => void;
  onDrill?: (c: KaloCategory) => void;
  period: string;
}) {
  const router = useRouter();
  const head = (label: string, k: CategorySort, className?: string, hint?: string) =>
    onSort && sort && dir ? (
      <SortHead label={label} k={k} sort={sort} dir={dir} onSort={onSort} className={className} hint={hint} />
    ) : (
      <th className={cn("px-3 py-2.5 font-medium", className)} title={hint}>
        {label}
      </th>
    );
  return (
    <div className="overflow-x-auto">
      <table className="table-cards w-full min-w-[1000px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="w-12 px-3 py-2.5 font-medium">#</th>
            <th className="px-3 py-2.5 font-medium">หมวดหมู่</th>
            {head("ยอดขาย (฿)", "revenue", "text-right")}
            {head("เติบโต", "growth", "text-right", "เทียบเดือนก่อน")}
            {head("ขายได้ (ชิ้น)", "sale", "text-right")}
            <th className="px-3 py-2.5 text-right font-medium">ราคาเฉลี่ย</th>
            {head("3 ร้านแรกครอง", "top3", "", "ส่วนแบ่งยอดขายของ 3 ร้านอันดับแรก — สูง = กระจุก เข้ายาก")}
            {head("ยอดขายเฉลี่ย/ร้าน", "avgShop", "text-right", "ร้านในหมวดนี้ขายได้เฉลี่ยร้านละเท่าไร")}
            <th className="px-3 py-2.5 font-medium">6 เดือน</th>
            <th className="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {items.map((c, i) => (
            <tr
              key={c.id}
              className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/40"
              onClick={() => router.push(`/trends/categories/${c.id}?period=${period}`)}
            >
              <td className="cards-hide px-3 py-2.5 text-muted-foreground">{sort === "revenue" && dir === "desc" ? (c.rank ?? i + 1) : i + 1}</td>
              <td className="px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Link
                    href={`/trends/categories/${c.id}?period=${period}`}
                    onClick={(e) => e.stopPropagation()}
                    className="font-medium hover:text-primary hover:underline"
                  >
                    {c.name}
                  </Link>
                  <SignalBadge c={c} />
                </div>
                <span className="block text-xs text-muted-foreground">
                  {c.childCount ? `${c.childCount} หมวดย่อย` : c.level === 3 ? "หมวดย่อยสุด" : ""}
                  {c.productCount ? `${c.childCount ? " · " : ""}${formatNumber(c.productCount)} สินค้าในระบบ` : ""}
                </span>
              </td>
              <td data-label="ยอดขาย" className="px-3 py-2.5 text-right font-semibold">
                {baht(c.revenue)}
              </td>
              <td data-label="เติบโต" className="px-3 py-2.5 text-right">
                <Growth value={c.growth} />
              </td>
              <td data-label="ขายได้ (ชิ้น)" className="px-3 py-2.5 text-right">
                {units(c.sale)}
              </td>
              <td data-label="ราคาเฉลี่ย" className="px-3 py-2.5 text-right">
                {c.avgPrice == null ? "—" : `฿${formatNumber(Math.round(c.avgPrice))}`}
              </td>
              <td data-label="3 ร้านแรกครอง" className="px-3 py-2.5">
                <Top3Bar value={c.top3} />
              </td>
              <td data-label="ยอดขายเฉลี่ย/ร้าน" className="px-3 py-2.5 text-right">
                {baht(c.avgShopRevenue)}
              </td>
              <td data-label="6 เดือน" className="px-3 py-2.5">
                <Sparkline points={(c.trend ?? []).map((t) => t.revenue)} />
              </td>
              <td className="px-3 py-2.5 text-right">
                {onDrill && c.childCount ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDrill(c);
                    }}
                    className="inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-md px-2 text-xs font-medium text-primary hover:bg-muted"
                  >
                    หมวดย่อย <ChevronRight className="size-3.5" />
                  </button>
                ) : (
                  <ChevronRight className="ml-auto size-4 text-muted-foreground max-sm:hidden" aria-hidden />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const VERDICT: Record<SelectVerdict, { label: string; tone: Tone; hint: string }> = {
  test: { label: "ควรทดลอง", tone: "success", hint: "24–30 คะแนน: ตรวจรายละเอียดแล้วลองทำคอนเทนต์" },
  watch: { label: "เก็บข้อมูลเพิ่ม", tone: "warning", hint: "18–23 คะแนน: ติดตามหรือเทียบกับสินค้าอื่น" },
  skip: { label: "ยังไม่ควรรีบ", tone: "neutral", hint: "ต่ำกว่า 18 คะแนน: ตรวจจุดอ่อนก่อนลงทุน" },
  insufficient: { label: "ข้อมูลยังไม่พอ", tone: "neutral", hint: "รู้คะแนนน้อยกว่า 4 หัวข้อ" },
};

/** "21/30" with the verdict colour; projected (unknown criteria scaled) in the tooltip. */
export function SelectScoreBadge({ score, verdict, projected }: { score: number | null; verdict: SelectVerdict | null; projected?: number | null }) {
  if (score == null || !verdict) return <span className="text-muted-foreground">—</span>;
  const v = VERDICT[verdict];
  return (
    <Badge tone={v.tone} className="whitespace-nowrap tabular-nums" title={`${v.label}${projected != null ? ` · คาดเต็ม ~${projected}/30` : ""} — ${v.hint}`}>
      {score}/30
    </Badge>
  );
}
