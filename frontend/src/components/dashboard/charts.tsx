"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CashflowPoint, ChannelMix, TrendPoint } from "@/lib/types";
import { formatCompact, formatNumber, formatTHB } from "@/lib/utils";
import { CHANNEL_META, channelLabel } from "./widgets";

const axisProps = {
  stroke: "var(--muted-foreground)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string; dataKey: string }[];
  label?: string;
  labelFormatter?: (l: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium">{labelFormatter ? labelFormatter(String(label)) : label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto pl-4 font-medium">{p.dataKey === "orders" ? formatNumber(p.value) : formatTHB(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short" });
const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

export function SalesTrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gRevenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gProfit" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-5)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--chart-5)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} {...axisProps} />
          <YAxis tickFormatter={(v) => formatCompact(v)} width={44} {...axisProps} />
          <Tooltip content={<ChartTooltip labelFormatter={longDate} />} cursor={{ stroke: "var(--border)" }} />
          <Area type="monotone" dataKey="revenue" name="ยอดขาย" stroke="var(--chart-1)" strokeWidth={2} fill="url(#gRevenue)" />
          <Area type="monotone" dataKey="grossProfit" name="กำไรขั้นต้น" stroke="var(--chart-5)" strokeWidth={2} fill="url(#gProfit)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ChannelDonut({ data }: { data: ChannelMix[] }) {
  const total = data.reduce((s, d) => s + d.revenue, 0);
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row lg:flex-col">
      <div className="relative size-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="revenue" nameKey="channel" innerRadius="66%" outerRadius="100%" paddingAngle={2} strokeWidth={0}>
              {data.map((d) => (
                <Cell key={d.channel} fill={CHANNEL_META[d.channel]?.color ?? "var(--chart-6)"} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-[11px] text-muted-foreground">รวม</p>
            <p className="text-base font-semibold">{formatCompact(total)}</p>
          </div>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-2.5">
        {data.map((d) => (
          <li key={d.channel} className="flex items-center gap-2 text-sm">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: CHANNEL_META[d.channel]?.color }} />
            <span className="truncate">{channelLabel(d.channel)}</span>
            <span className="ml-auto text-xs text-muted-foreground">{total ? ((d.revenue / total) * 100).toFixed(0) : 0}%</span>
            <span className="w-24 shrink-0 text-right font-medium tabular-nums">{formatTHB(d.revenue)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("th-TH", { month: "short" });

export function CashflowChart({ data }: { data: CashflowPoint[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={4}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickFormatter={monthLabel} {...axisProps} />
          <YAxis tickFormatter={(v) => formatCompact(v)} width={44} {...axisProps} />
          <Tooltip
            content={<ChartTooltip labelFormatter={(m) => new Date(`${m}-01T00:00:00`).toLocaleDateString("th-TH", { month: "long", year: "numeric" })} />}
            cursor={{ fill: "var(--muted)", opacity: 0.6 }}
          />
          <Bar dataKey="income" name="รายรับ" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar dataKey="expense" name="รายจ่าย" fill="var(--chart-3)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
