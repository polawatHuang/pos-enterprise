"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, Loader2, Plus, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { ScheduledPost } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, Label, Skeleton, Textarea } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { PageHeader } from "@/components/layout/page";
import { PlatformChip } from "./accounts-view";
import { ComposerDialog } from "./composer-dialog";
import { POST_STATUS, SOCIAL, toLocalInput } from "./labels";

const DAY_MS = 86_400_000;
const startOfWeek = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
};
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const time = (iso: string) => new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });

export function CalendarView() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const params = useSearchParams();
  const canPublish = can("social:publish");
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [composer, setComposer] = useState<{ date?: Date; videoId?: number } | null>(() =>
    params.get("video") ? { videoId: Number(params.get("video")) } : null,
  );
  const [openPost, setOpenPost] = useState<ScheduledPost | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  // Captured once per mount: decides which days still accept new posts
  const [now] = useState(() => Date.now());
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * DAY_MS)), [weekStart]);
  const range = { from: weekStart.toISOString(), to: new Date(weekStart.getTime() + 7 * DAY_MS).toISOString() };
  const posts = useQuery({
    queryKey: ["social", "posts", range.from],
    queryFn: () => api.get<ScheduledPost[]>("/social/posts", range),
    refetchInterval: (q) => (q.state.data?.some((p) => p.status === "publishing") ? 10_000 : false),
  });
  const failed = useQuery({ queryKey: ["social", "posts", "failed"], queryFn: () => api.get<ScheduledPost[]>("/social/posts", { status: "failed" }) });

  /** Drag a scheduled post to another day: same time of day, new date. */
  const moveTo = async (day: Date) => {
    const p = posts.data?.find((x) => x.id === dragId);
    setDragId(null);
    if (!p || !["scheduled", "draft", "failed"].includes(p.status)) return;
    const old = new Date(p.scheduledAt);
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate(), old.getHours(), old.getMinutes());
    if (sameDay(old, next)) return;
    try {
      await api.patch(`/social/posts/${p.id}`, { scheduledAt: next.toISOString() });
      toast.success(`ย้ายไป ${next.toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short" })} ${time(next.toISOString())}`);
      await qc.invalidateQueries({ queryKey: ["social", "posts"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ย้ายไม่สำเร็จ");
    }
  };

  const today = new Date(now);
  return (
    <div className="space-y-4">
      <PageHeader
        title="ตั้งเวลาโพสต์"
        description="วางแผนคลิปลง TikTok, Facebook Reels และ Instagram Reels — ลากโพสต์ไปวันอื่นเพื่อเลื่อนวัน"
        actions={
          canPublish && (
            <Button onClick={() => setComposer({})}>
              <Plus /> สร้างโพสต์
            </Button>
          )
        }
      />

      {failed.data && failed.data.length > 0 && (
        <Card className="border-danger/40 p-3 text-sm">
          <p className="mb-2 flex items-center gap-1.5 font-medium text-danger">
            <AlertTriangle className="size-4" /> โพสต์ไม่สำเร็จ {failed.data.length} รายการ
          </p>
          <ul className="space-y-1">
            {failed.data.slice(0, 5).map((p) => (
              <li key={p.id}>
                <button className="flex w-full items-center gap-2 text-left hover:underline" onClick={() => setOpenPost(p)}>
                  <PlatformChip platform={p.platform} />
                  <span className="truncate">{p.caption || p.videoTitle}</span>
                  <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">{p.error}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * DAY_MS))} aria-label="สัปดาห์ก่อน">
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setWeekStart(startOfWeek(new Date()))}>
          สัปดาห์นี้
        </Button>
        <Button variant="outline" size="sm" onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * DAY_MS))} aria-label="สัปดาห์ถัดไป">
          <ChevronRight />
        </Button>
        <p className="text-sm font-medium">
          {days[0].toLocaleDateString("th-TH", { day: "numeric", month: "short" })} – {days[6].toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })}
        </p>
        {posts.isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>

      {posts.isPending ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="grid gap-2 md:grid-cols-7">
          {days.map((day) => {
            const list = (posts.data ?? []).filter((p) => sameDay(new Date(p.scheduledAt), day));
            const isToday = sameDay(day, today);
            return (
              <div
                key={day.toISOString()}
                onDragOver={(e) => canPublish && dragId && e.preventDefault()}
                onDrop={() => void moveTo(day)}
                className={cn(
                  "flex min-h-28 flex-col rounded-xl border border-border bg-card p-2 md:min-h-80",
                  isToday && "border-primary/60 ring-1 ring-primary/30",
                  dragId && "border-dashed",
                )}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className={cn("text-xs font-medium", isToday ? "text-primary" : "text-muted-foreground")}>
                    {day.toLocaleDateString("th-TH", { weekday: "short", day: "numeric" })}
                  </span>
                  {canPublish && day.getTime() + DAY_MS > now && (
                    <button
                      className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent"
                      onClick={() => {
                        const d = new Date(day);
                        d.setHours(isToday ? Math.min(23, today.getHours() + 1) : 19, 0, 0, 0);
                        setComposer({ date: d });
                      }}
                      aria-label={`สร้างโพสต์วันที่ ${day.getDate()}`}
                    >
                      <Plus className="size-3.5" />
                    </button>
                  )}
                </div>
                <div className="space-y-1.5">
                  {list.map((p) => (
                    <button
                      key={p.id}
                      draggable={canPublish && ["scheduled", "draft", "failed"].includes(p.status)}
                      onDragStart={() => setDragId(p.id)}
                      onDragEnd={() => setDragId(null)}
                      onClick={() => setOpenPost(p)}
                      className={cn(
                        "w-full rounded-lg border border-border bg-background p-1.5 text-left text-xs transition-shadow hover:shadow-sm",
                        p.status === "failed" && "border-danger/50",
                        p.status === "cancelled" && "opacity-50",
                      )}
                    >
                      <div className="flex items-center gap-1">
                        <PlatformChip platform={p.platform} className="h-4 px-1 text-[9px]" />
                        <span className="font-medium tabular-nums">{time(p.scheduledAt)}</span>
                        <span className="ml-auto">
                          {p.status === "published" ? (
                            <CheckCircle2 className="size-3.5 text-success" aria-label="โพสต์แล้ว" />
                          ) : p.status === "failed" ? (
                            <XCircle className="size-3.5 text-danger" aria-label="ไม่สำเร็จ" />
                          ) : p.status === "publishing" ? (
                            <Loader2 className="size-3.5 animate-spin text-warning" aria-label="กำลังโพสต์" />
                          ) : p.accountStatus !== "connected" && p.status === "scheduled" ? (
                            <AlertTriangle className="size-3.5 text-warning" aria-label="บัญชียังไม่เชื่อมต่อ" />
                          ) : (
                            <CalendarClock className="size-3.5 text-muted-foreground" aria-label={POST_STATUS[p.status].label} />
                          )}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-muted-foreground">{p.caption || p.videoTitle || "(ไม่มีแคปชัน)"}</p>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={composer !== null} onOpenChange={(o) => !o && setComposer(null)}>
        {composer !== null && <ComposerDialog defaultDate={composer.date} defaultVideoId={composer.videoId} onDone={() => setComposer(null)} />}
      </Dialog>
      <Dialog open={openPost !== null} onOpenChange={(o) => !o && setOpenPost(null)}>
        {openPost && <PostDialog key={openPost.id} p={openPost} onDone={() => setOpenPost(null)} />}
      </Dialog>
    </div>
  );
}

function PostDialog({ p, onDone }: { p: ScheduledPost; onDone: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const editable = can("social:publish") && ["draft", "scheduled", "failed"].includes(p.status);
  const [at, setAt] = useState(toLocalInput(new Date(p.scheduledAt)));
  const [caption, setCaption] = useState(p.caption ?? "");
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      await qc.invalidateQueries({ queryKey: ["social"] });
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };

  return (
    <DialogContent title={`โพสต์ ${SOCIAL[p.platform].label}`} description={`${p.accountName ?? ""} · ${formatDateTime(p.scheduledAt)}`}>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <PlatformChip platform={p.platform} />
          <Badge tone={POST_STATUS[p.status].tone}>{POST_STATUS[p.status].label}</Badge>
          {p.isAiGenerated && <Badge>ป้าย AI</Badge>}
          {p.platform === "tiktok" && p.platformOptions && <Badge>{p.platformOptions.brandContent ? "Paid partnership" : p.platformOptions.brandOrganic ? "Promotional" : "ไม่ใช่โฆษณา"}</Badge>}
        </div>
        {p.accountStatus !== "connected" && p.status === "scheduled" && (
          <p className="flex gap-1.5 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
            <AlertTriangle className="size-3.5 shrink-0" /> บัญชียังไม่ได้เชื่อมต่อ โพสต์จะรอจนกว่าจะเชื่อมต่อบัญชี
          </p>
        )}
        {p.error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{p.error}</p>}
        {p.permalink && (
          <a href={p.permalink} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            ดูโพสต์ <ExternalLink className="size-3.5" />
          </a>
        )}
        <p className="text-xs text-muted-foreground">วิดีโอ: {p.videoTitle ?? p.mediaUrl ?? "—"}</p>
        {editable ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="pd-at">เวลาโพสต์</Label>
              <Input id="pd-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pd-cap">แคปชัน</Label>
              <Textarea id="pd-cap" value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} maxLength={2000} />
            </div>
          </>
        ) : null}
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">ข้อความที่จะโพสต์จริง</p>
          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted p-3 font-sans text-xs">{p.finalCaption}</pre>
        </div>
        {editable && (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" disabled={busy !== null} onClick={() => void run("cancel", () => api.post(`/social/posts/${p.id}/cancel`), "ยกเลิกโพสต์แล้ว")}>
              ยกเลิกโพสต์
            </Button>
            {p.accountStatus === "connected" && (
              <Button variant="outline" disabled={busy !== null} onClick={() => void run("now", () => api.post(`/social/posts/${p.id}/publish-now`), "เข้าคิวโพสต์แล้ว")}>
                {busy === "now" ? <Loader2 className="animate-spin" /> : <Send />} {p.status === "failed" ? "ลองใหม่" : "โพสต์ทันที"}
              </Button>
            )}
            <Button
              disabled={busy !== null}
              onClick={() =>
                void run(
                  "save",
                  () => api.patch(`/social/posts/${p.id}`, { scheduledAt: new Date(at).toISOString(), caption, ...(p.status === "draft" ? { status: "scheduled" } : {}) }),
                  "บันทึกแล้ว",
                )
              }
            >
              {busy === "save" && <Loader2 className="animate-spin" />} {p.status === "draft" ? "ตั้งเวลา" : "บันทึก"}
            </Button>
          </div>
        )}
      </div>
    </DialogContent>
  );
}
