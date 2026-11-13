"use client";

import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Circle, Flame, Plus, Sparkles, Target, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { DailyGoal } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import styles from "./daily-goals.module.css";

const GOALS_KEY = ["dashboard", "goals", "today"];
const MAX_GOALS = 20;

function Celebration({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, 2200);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <div className={styles.celebration} role="status" aria-live="polite">
      <div className={styles.burst} aria-hidden="true">
        {Array.from({ length: 42 }, (_, i) => {
          const angle = (i / 42) * Math.PI * 2;
          const distance = 24 + ((i * 13) % 28);
          const style = {
            "--x": `${Math.cos(angle) * distance}vw`,
            "--y": `${Math.sin(angle) * distance}vh`,
            "--delay": `${(i % 7) * 35}ms`,
            "--hue": `${(i * 37) % 360}`,
            "--spin": `${180 + (i % 4) * 180}deg`,
          } as CSSProperties;
          return <span key={i} style={style} />;
        })}
      </div>
      <div className={styles.celebrationMessage}>
        <Sparkles className="mx-auto size-8 text-amber-300" />
        <p className="mt-2 text-xl font-bold">ยอดเยี่ยมมาก!</p>
        <p className="text-sm text-white/80">ทำเป้าหมายสำเร็จแล้ว ✨</p>
      </div>
    </div>
  );
}

export function DailyGoals() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [celebrate, setCelebrate] = useState(false);
  const goals = useQuery({
    queryKey: GOALS_KEY,
    queryFn: () => api.get<DailyGoal[]>("/dashboard/goals/today"),
    refetchInterval: 60_000,
  });
  const completed = goals.data?.filter((goal) => goal.status === "completed").length ?? 0;
  const total = goals.data?.length ?? 0;
  const progress = total ? (completed / total) * 100 : 0;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["dashboard", "goals"] });
  const addGoal = useMutation({
    mutationFn: (text: string) => api.post<DailyGoal>("/dashboard/goals", { title: text }),
    onSuccess: () => {
      setTitle("");
      void refresh();
    },
  });
  const updateGoal = useMutation({
    mutationFn: ({ id, status }: { id: number; status: "pending" | "completed" }) =>
      api.patch<DailyGoal>(`/dashboard/goals/${id}`, { status }),
    onSuccess: (_, variables) => {
      if (variables.status === "completed") setCelebrate(true);
      void refresh();
    },
  });
  const deleteGoal = useMutation({
    mutationFn: (id: number) => api.del<void>(`/dashboard/goals/${id}`),
    onSuccess: refresh,
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = title.trim();
    if (text) addGoal.mutate(text);
  }

  return (
    <>
      <Card className="relative mb-5 overflow-hidden border-primary/20 bg-gradient-to-br from-primary-soft/70 via-card to-card">
        <div className="pointer-events-none absolute -right-10 -top-14 size-44 rounded-full bg-primary/10 blur-3xl" />
        <CardHeader className="relative flex-wrap items-center">
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
              <Target className="size-5" />
            </span>
            <div>
              <CardTitle>เป้าหมายของวันนี้</CardTitle>
              <CardDescription>ทีละก้าว ทุกความสำเร็จเริ่มจากการลงมือทำ</CardDescription>
            </div>
          </div>
          <Link href="/dashboard/achievements" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            ประวัติความสำเร็จ <ArrowRight className="size-4" />
          </Link>
        </CardHeader>
        <CardContent className="relative">
          <div className="mb-4 flex items-end justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {goals.isPending ? "กำลังโหลดเป้าหมาย..." : total ? `สำเร็จแล้ว ${completed} จาก ${total} เป้าหมาย` : "ตั้งเป้าหมายแรกของคุณ แล้วเริ่มพิชิตไปด้วยกัน"}
            </p>
            {total > 0 && <span className="text-sm font-semibold tabular-nums text-primary">{Math.round(progress)}%</span>}
          </div>
          <div
            className="mb-5 h-2 overflow-hidden rounded-full bg-primary/10"
            role="progressbar"
            aria-label="ความคืบหน้าของเป้าหมายวันนี้"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={completed}
          >
            <div className="h-full rounded-full bg-gradient-to-r from-primary to-chart-2 transition-[width] duration-700" style={{ width: `${progress}%` }} />
          </div>

          {goals.isError ? (
            <p className="rounded-lg bg-danger-soft p-3 text-sm text-danger">โหลดเป้าหมายไม่สำเร็จ กรุณารีเฟรชหน้าแล้วลองใหม่</p>
          ) : (
            <ul className="space-y-2">
              {goals.data?.map((goal) => (
                <li key={goal.id} className={cn("flex min-w-0 items-center gap-3 rounded-xl border border-border/70 bg-card/80 p-3 transition-colors", goal.status === "completed" && "border-success/20 bg-success-soft/40")}>
                  <button
                    type="button"
                    onClick={() => updateGoal.mutate({ id: goal.id, status: goal.status === "completed" ? "pending" : "completed" })}
                    disabled={goal.status === "missed" || updateGoal.isPending}
                    aria-label={`${goal.status === "completed" ? "ยกเลิกการสำเร็จ" : "ทำสำเร็จ"}: ${goal.title}`}
                    aria-pressed={goal.status === "completed"}
                    className={cn("grid size-8 shrink-0 place-items-center rounded-full transition-transform hover:scale-110 disabled:cursor-not-allowed", goal.status === "completed" ? "bg-success text-white" : "border-2 border-border text-muted-foreground hover:border-primary hover:text-primary")}
                  >
                    {goal.status === "completed" ? <Check className="size-4" /> : <Circle className="size-4" />}
                  </button>
                  <span className={cn("min-w-0 flex-1 break-words text-sm font-medium", goal.status === "completed" && "text-muted-foreground line-through")}>{goal.title}</span>
                  {goal.status === "completed" && <span className="shrink-0 text-xs font-medium text-success">สำเร็จ</span>}
                  {goal.status === "pending" && (
                    <button
                      type="button"
                      onClick={() => deleteGoal.mutate(goal.id)}
                      disabled={deleteGoal.isPending}
                      aria-label={`ลบเป้าหมาย: ${goal.title}`}
                      className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-danger-soft hover:text-danger"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {total === 0 && !goals.isPending && !goals.isError && (
            <div className="mb-4 rounded-xl border border-dashed border-primary/25 bg-primary/5 px-4 py-5 text-center">
              <Flame className="mx-auto size-6 text-amber-500" />
              <p className="mt-2 text-sm font-medium">วันนี้คุณอยากทำอะไรให้สำเร็จ?</p>
              <p className="mt-1 text-xs text-muted-foreground">เช่น ขายเสื้อให้ได้ 20 ตัว หรือโทรหาลูกค้า 5 คน</p>
            </div>
          )}

          <form onSubmit={submit} className="mt-4 flex min-w-0 flex-col gap-2 sm:flex-row">
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              placeholder="เพิ่มเป้าหมายของวันนี้..."
              aria-label="ชื่อเป้าหมาย"
              disabled={total >= MAX_GOALS || addGoal.isPending}
            />
            <Button type="submit" className="w-full sm:w-auto" disabled={!title.trim() || total >= MAX_GOALS || addGoal.isPending}>
              <Plus /> เพิ่มเป้าหมาย
            </Button>
          </form>
          {addGoal.isError && <p className="mt-2 text-sm text-danger">{addGoal.error.message}</p>}
          {updateGoal.isError && <p className="mt-2 text-sm text-danger">{updateGoal.error.message}</p>}
          {deleteGoal.isError && <p className="mt-2 text-sm text-danger">{deleteGoal.error.message}</p>}
          {total >= MAX_GOALS && <p className="mt-2 text-xs text-muted-foreground">ครบ 20 เป้าหมายของวันนี้แล้ว</p>}
        </CardContent>
      </Card>
      {celebrate && <Celebration onDone={() => setCelebrate(false)} />}
    </>
  );
}
