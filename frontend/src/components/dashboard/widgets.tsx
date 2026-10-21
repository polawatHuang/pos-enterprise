"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card, Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export const CHANNEL_META: Record<string, { label: string; color: string }> = {
  pos: { label: "หน้าร้าน", color: "var(--chart-1)" },
  shopee: { label: "Shopee", color: "var(--chart-3)" },
  tiktok: { label: "TikTok", color: "var(--chart-4)" },
  tiktok_shop: { label: "TikTok Shop", color: "var(--chart-4)" },
  facebook: { label: "Facebook", color: "var(--chart-2)" },
  instagram: { label: "Instagram", color: "var(--chart-6)" },
  line: { label: "LINE", color: "var(--chart-5)" },
  website: { label: "เว็บไซต์", color: "var(--chart-2)" },
  other: { label: "อื่นๆ", color: "var(--chart-6)" },
};
export const channelLabel = (c: string) => CHANNEL_META[c]?.label ?? c;

export function Delta({ value, suffix = "เทียบช่วงเดียวกัน" }: { value: number | null; suffix?: string }) {
  if (value === null || !Number.isFinite(value)) {
    return <span className="text-xs text-muted-foreground">ยังไม่มีข้อมูลเปรียบเทียบ</span>;
  }
  const up = value > 0.05;
  const down = value < -0.05;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium",
          up && "bg-success-soft text-success",
          down && "bg-danger-soft text-danger",
          !up && !down && "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-3" />
        {Math.abs(value).toFixed(1)}%
      </span>
      <span className="text-muted-foreground">{suffix}</span>
    </span>
  );
}

export function KpiCard({
  label,
  value,
  icon: Icon,
  tone = "primary",
  footer,
  loading,
}: {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  tone?: "primary" | "success" | "warning" | "danger" | "info";
  footer?: ReactNode;
  loading?: boolean;
}) {
  const toneClass = {
    primary: "bg-primary-soft text-primary",
    success: "bg-success-soft text-success",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
    info: "bg-muted text-chart-2",
  }[tone];
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", toneClass)}>
          <Icon className="size-[18px]" />
        </span>
      </div>
      {loading ? (
        <>
          <Skeleton className="mt-2 h-8 w-32" />
          <Skeleton className="mt-3 h-4 w-40" />
        </>
      ) : (
        <>
          <p className="mt-1 text-[26px] font-semibold leading-tight tracking-tight">{value}</p>
          <div className="mt-2 min-h-5">{footer}</div>
        </>
      )}
    </Card>
  );
}

/** Small "module status" tile linking to the module page. */
export function OpsTile({
  href,
  icon: Icon,
  label,
  value,
  hint,
  alert,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  hint: string;
  alert?: boolean;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-primary-soft/40"
    >
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-lg",
          alert ? "bg-danger-soft text-danger" : "bg-muted text-muted-foreground group-hover:text-primary",
        )}
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <span className="block text-lg font-semibold leading-tight">{value}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>
      </span>
    </Link>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{text}</p>;
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

/** A failed load, with the reason (e.g. a missing permission) and a retry, instead of looking like "no data". */
export function ErrorNote({ onRetry, error }: { onRetry: () => void; error?: unknown }) {
  const reason = error instanceof Error && error.message ? error.message : null;
  return (
    <div className="py-8 text-center text-sm text-muted-foreground">
      โหลดข้อมูลไม่สำเร็จ{reason ? ` — ${reason}` : ""}{" "}
      <button onClick={onRetry} className="font-medium text-primary underline underline-offset-2">
        ลองใหม่
      </button>
    </div>
  );
}
