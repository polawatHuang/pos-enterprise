"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Award, CalendarCheck2, CheckCircle2, CircleDashed, Flame, Target, Trophy, type LucideIcon } from "lucide-react";
import { api } from "@/lib/api";
import type { DailyGoal } from "@/lib/types";
import { cn, formatNumber, formatThaiDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Segmented, Skeleton } from "@/components/ui/primitives";
import { PageHeader } from "@/components/layout/page";
import { ErrorNote } from "@/components/dashboard/widgets";

type Period = 7 | 30 | 90;

export function AchievementsView() {
  const [period, setPeriod] = useState<Period>(30);
  const history = useQuery({
    queryKey: ["dashboard", "goals", "history", period],
    queryFn: () => api.get<DailyGoal[]>("/dashboard/goals/history", { days: period }),
  });
  const goals = history.data ?? [];
  const completed = goals.filter((goal) => goal.status === "completed").length;
  const missed = goals.filter((goal) => goal.status === "missed").length;
  const successRate = goals.length ? Math.round((completed / goals.length) * 100) : 0;
  const grouped = goals.reduce<Record<string, DailyGoal[]>>((days, goal) => {
    (days[goal.date] ??= []).push(goal);
    return days;
  }, {});
  const days = Object.entries(grouped).sort(([a], [b]) => b.localeCompare(a));
  const perfectDays = days.filter(([, items]) => items.length > 0 && items.every((goal) => goal.status === "completed")).length;

  return (
    <>
      <PageHeader
        title="ประวัติความสำเร็จ"
        description="ทุกเป้าหมายที่คุณตั้งใจทำ คืออีกก้าวที่พาคุณเข้าใกล้ความสำเร็จ"
        actions={
          <Button variant="outline" asChild>
            <Link href="/dashboard"><ArrowLeft /> กลับหน้าภาพรวม</Link>
          </Button>
        }
      />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">สรุปเป้าหมายส่วนตัวตามช่วงเวลาที่เลือก</p>
        <Segmented<Period>
          label="ช่วงเวลารายงาน"
          value={period}
          onChange={setPeriod}
          options={[
            { value: 7, label: "7 วัน" },
            { value: 30, label: "30 วัน" },
            { value: 90, label: "90 วัน" },
          ]}
        />
      </div>

      {history.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : history.isError ? (
        <ErrorNote onRetry={() => void history.refetch()} error={history.error} />
      ) : goals.length === 0 ? (
        <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary-soft/60 via-card to-card">
          <CardContent className="py-12 text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Trophy className="size-7" />
            </span>
            <h2 className="mt-4 text-lg font-semibold">ทุกความสำเร็จเริ่มต้นจากเป้าหมายแรก</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">เมื่อคุณทำเป้าหมายรายวัน ประวัติและรายงานความคืบหน้าจะปรากฏที่นี่</p>
            <Button className="mt-5" asChild><Link href="/dashboard">ตั้งเป้าหมายวันนี้</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <section aria-label="สรุปผลเป้าหมาย" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={Target} label="เป้าหมายทั้งหมด" value={formatNumber(goals.length)} detail={`ในช่วง ${period} วันที่ผ่านมา`} tone="primary" />
            <StatCard icon={CheckCircle2} label="ทำสำเร็จ" value={formatNumber(completed)} detail="เป้าหมายที่ทำเครื่องหมายสำเร็จ" tone="success" />
            <StatCard icon={CircleDashed} label="ยังไม่สำเร็จ" value={formatNumber(missed)} detail="เป้าหมายที่ยังทำไม่ครบเมื่อหมดวัน" tone="muted" />
            <StatCard icon={Flame} label="อัตราความสำเร็จ" value={`${successRate}%`} detail={`${perfectDays} วันที่ทำได้ครบทุกเป้าหมาย`} tone="amber" />
          </section>

          <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
            <Card className="min-w-0">
              <CardHeader>
                <div>
                  <CardTitle>ความสม่ำเสมอ</CardTitle>
                  <CardDescription>สัดส่วนเป้าหมายสำเร็จในแต่ละวัน</CardDescription>
                </div>
                <Award className="size-5 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {days.map(([date, items]) => {
                    const done = items.filter((goal) => goal.status === "completed").length;
                    const percent = Math.round((done / items.length) * 100);
                    return (
                      <div key={date} className="flex min-w-0 items-center gap-3">
                        <span className="w-24 shrink-0 text-xs text-muted-foreground">{formatThaiDate(date)}</span>
                        <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-gradient-to-r from-primary to-chart-2 transition-[width]" style={{ width: `${percent}%` }} />
                        </div>
                        <span className="w-16 shrink-0 text-right text-xs font-medium tabular-nums">{done}/{items.length}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card className="min-w-0 border-primary/15 bg-gradient-to-br from-primary-soft/50 to-card">
              <CardHeader>
                <div>
                  <CardTitle>ภาพรวมช่วงนี้</CardTitle>
                  <CardDescription>ความพยายามของคุณมีความหมาย</CardDescription>
                </div>
                <Trophy className="size-5 text-amber-500" />
              </CardHeader>
              <CardContent>
                <div className="rounded-2xl border border-primary/10 bg-card/80 p-5 text-center">
                  <div className="relative mx-auto grid size-32 place-items-center rounded-full" style={{ background: `conic-gradient(var(--primary) ${successRate}%, var(--muted) ${successRate}% 100%)` }}>
                    <div className="grid size-24 place-items-center rounded-full bg-card">
                      <div>
                        <p className="text-3xl font-bold tracking-tight">{successRate}%</p>
                        <p className="text-xs text-muted-foreground">สำเร็จ</p>
                      </div>
                    </div>
                  </div>
                  <p className="mt-4 text-sm font-medium">{successRate >= 80 ? "ยอดเยี่ยม รักษาจังหวะนี้ไว้นะ!" : "ค่อย ๆ สร้างความก้าวหน้าในทุกวัน"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">ทำสำเร็จ {formatNumber(completed)} จาก {formatNumber(goals.length)} เป้าหมาย</p>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <MiniStat icon={CalendarCheck2} label="วันที่มีเป้าหมาย" value={days.length} />
                  <MiniStat icon={Award} label="วันที่สำเร็จครบ" value={perfectDays} />
                </div>
              </CardContent>
            </Card>
          </div>

          <section className="mt-5">
            <div className="mb-3 flex items-center gap-2">
              <CalendarCheck2 className="size-5 text-primary" />
              <h2 className="text-lg font-semibold">บันทึกเป้าหมายรายวัน</h2>
            </div>
            <div className="space-y-3">
              {days.map(([date, items]) => {
                const done = items.filter((goal) => goal.status === "completed").length;
                return (
                  <Card key={date} className="min-w-0">
                    <CardHeader className="flex-row items-center py-4">
                      <div>
                        <CardTitle>{formatThaiDate(date)}</CardTitle>
                        <CardDescription>{done} จาก {items.length} เป้าหมายสำเร็จ</CardDescription>
                      </div>
                      <Badge tone={done === items.length ? "success" : "neutral"}>{done === items.length ? "สำเร็จครบ" : `${Math.round((done / items.length) * 100)}%`}</Badge>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {items.map((goal) => (
                          <li key={goal.id} className="flex min-w-0 items-start gap-3 rounded-lg bg-muted/50 px-3 py-2.5">
                            {goal.status === "completed" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                            <span className={cn("min-w-0 flex-1 break-words text-sm", goal.status === "missed" && "text-muted-foreground")}>{goal.title}</span>
                            <span className={cn("shrink-0 text-xs font-medium", goal.status === "completed" ? "text-success" : "text-muted-foreground")}>
                              {goal.status === "completed" ? "สำเร็จ" : "ยังไม่สำเร็จ"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        </>
      )}
    </>
  );
}

function StatCard({ icon: Icon, label, value, detail, tone }: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone: "primary" | "success" | "muted" | "amber";
}) {
  const color = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success-soft text-success",
    muted: "bg-muted text-muted-foreground",
    amber: "bg-amber-500/10 text-amber-600",
  }[tone];
  return (
    <Card className="min-w-0 overflow-hidden">
      <CardContent className="flex items-start gap-3 p-4 sm:p-5">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", color)}><Icon className="size-5" /></span>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
          <p className="mt-1 break-words text-xs text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniStat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-card/80 p-3">
      <Icon className="size-4 shrink-0 text-primary" />
      <div className="min-w-0">
        <p className="truncate text-[11px] text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold tabular-nums">{formatNumber(value)}</p>
      </div>
    </div>
  );
}
