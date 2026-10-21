"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  Loader2,
  MessageSquareDashed,
  PanelRight,
  RotateCcw,
  Search,
  Send,
  Settings2,
  Sparkles,
  UserRound,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Conversation, ConversationDetail, InboxMessage, InboxSummary, Platform } from "@/lib/types";
import { cn, formatDateTime, formatMoney, formatRelativeTime, initials } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, Segmented, Skeleton, Textarea } from "@/components/ui/primitives";
import { CONV_STATUS, INTENT_LABEL, OFFER_STATUS, PLATFORM, PROVIDER_LABEL, RETURN_STATUS, TOOL_LABEL } from "./labels";

type View = "active" | "human" | "ai" | "resolved";
const POLL_MS = 5000;

/** Channel filter: every platform with a connected channel, plus Facebook / Instagram to connect when missing. */
function ChannelFilter({
  platforms,
  value,
  onChange,
}: {
  platforms: NonNullable<InboxSummary["platforms"]>;
  value: Platform | "all";
  onChange: (p: Platform | "all") => void;
}) {
  const connected = new Map(platforms.map((p) => [p.platform, p]));
  const order: Platform[] = ["facebook", "instagram", "line", "tiktok", "shopee", "website", "email"];
  const shown = order.filter((p) => connected.has(p) || p === "facebook" || p === "instagram");
  const chip = "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors";
  return (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="group" aria-label="ช่องทาง">
      <button
        type="button"
        onClick={() => onChange("all")}
        className={cn(chip, value === "all" ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground hover:bg-accent")}
      >
        ทุกช่องทาง
      </button>
      {shown.map((p) => {
        const c = connected.get(p);
        if (!c) {
          return (
            <Link key={p} href="/inbox/settings?tab=channels" className={cn(chip, "border-dashed border-border text-muted-foreground hover:bg-accent")}>
              <PlatformBadge platform={p} className="h-4 px-1 text-[9px]" /> + เชื่อมต่อ
            </Link>
          );
        }
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            aria-pressed={value === p}
            className={cn(chip, value === p ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground hover:bg-accent")}
          >
            <PlatformBadge platform={p} className="h-4 px-1 text-[9px]" />
            {PLATFORM[p].label}
            {c.open > 0 && <span className="tabular-nums">({c.open})</span>}
          </button>
        );
      })}
    </div>
  );
}

export function PlatformBadge({ platform, className }: { platform: Conversation["platform"]; className?: string }) {
  const p = PLATFORM[platform] ?? PLATFORM.website;
  return (
    <span className={cn("inline-flex h-4 items-center rounded px-1 text-[9px] font-bold leading-none", p.className, className)} title={p.label}>
      {p.short}
    </span>
  );
}

export function InboxView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = Number(params.get("c")) || null;
  const [view, setView] = useState<View>("active");
  const [platform, setPlatform] = useState<Platform | "all">("all");
  const [q, setQ] = useState("");
  const [showCustomer, setShowCustomer] = useState(false);

  const select = (id: number | null) => router.replace(id ? `${pathname}?c=${id}` : pathname, { scroll: false });

  const summary = useQuery({
    queryKey: ["inbox", "summary"],
    queryFn: () => api.get<InboxSummary>("/inbox/summary"),
    refetchInterval: POLL_MS * 3,
  });
  const list = useQuery({
    queryKey: ["inbox", "list", view, q, platform],
    queryFn: () => api.get<Conversation[]>("/inbox/conversations", { view, q: q || undefined, platform: platform === "all" ? undefined : platform }),
    refetchInterval: POLL_MS,
  });

  const s = summary.data;
  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-4rem)] flex-col sm:-mx-6 lg:-my-8">
      {s && !s.aiConfigured && (
        <div className="flex items-center gap-2 border-b border-warning/30 bg-warning-soft px-4 py-2 text-sm text-warning">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="min-w-0">
            AI ยังไม่พร้อม: ตั้งค่า {s.aiProvider === "anthropic" ? "ANTHROPIC_API_KEY" : "MINIMAX_API_KEY"} บนเซิร์ฟเวอร์ — แชตใหม่จะถูกส่งให้แอดมินตอบเอง
          </span>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {/* Conversation list */}
        <aside
          className={cn(
            "flex w-full min-w-0 flex-col border-r border-border bg-card md:w-80 md:shrink-0 lg:w-96",
            selectedId && "hidden md:flex",
          )}
        >
          <div className="space-y-3 border-b border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <h1 className="text-lg font-semibold">แชตลูกค้า</h1>
              <div className="flex items-center gap-1">
                {s && s.pendingApprovals + s.newReturns > 0 && (
                  <Link href="/inbox/aftersales">
                    <Badge tone="warning">{s.pendingApprovals + s.newReturns} รอจัดการ</Badge>
                  </Link>
                )}
                <Link href="/inbox/settings" className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent" aria-label="ตั้งค่า AI แชต">
                  <Settings2 className="size-4" />
                </Link>
              </div>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อลูกค้า" className="pl-9" aria-label="ค้นหาชื่อลูกค้า" />
            </div>
            <div className="overflow-x-auto">
              <Segmented
                label="มุมมอง"
                value={view}
                onChange={setView}
                options={[
                  { value: "active", label: `ทั้งหมด${s ? ` (${s.open})` : ""}` },
                  { value: "human", label: `รอแอดมิน${s ? ` (${s.needsHuman})` : ""}` },
                  { value: "ai", label: "AI ดูแล" },
                  { value: "resolved", label: "ปิดแล้ว" },
                ]}
              />
            </div>
            <ChannelFilter platforms={s?.platforms ?? []} value={platform} onChange={setPlatform} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {list.isPending ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : !list.data?.length ? (
              <div className="grid place-items-center gap-2 px-6 py-16 text-center text-sm text-muted-foreground">
                <MessageSquareDashed className="size-8" />
                ไม่มีแชตในมุมมองนี้
                {s && !s.platforms?.some((p) => p.platform === "facebook" || p.platform === "instagram") && (
                  <Link href="/inbox/settings?tab=channels" className="mt-2 text-primary hover:underline">
                    เชื่อมต่อ Facebook Page / Instagram เพื่อรับแชตลูกค้า
                  </Link>
                )}
              </div>
            ) : (
              <ul>
                {list.data.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => select(c.id)}
                      className={cn(
                        "flex w-full gap-3 border-b border-border px-3 py-3 text-left transition-colors hover:bg-accent/60",
                        c.id === selectedId && "bg-primary-soft/60",
                      )}
                    >
                      <div className="relative shrink-0">
                        <div className="grid size-10 place-items-center rounded-full bg-muted text-sm font-semibold">{initials(c.customerName ?? "?")}</div>
                        <PlatformBadge platform={c.platform} className="absolute -bottom-1 -right-1 ring-2 ring-card" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={cn("truncate text-sm", c.unread ? "font-semibold" : "font-medium")}>{c.customerName ?? "ลูกค้า"}</span>
                          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{c.lastMessageAt ? formatRelativeTime(c.lastMessageAt) : ""}</span>
                        </div>
                        <p className={cn("mt-0.5 truncate text-xs", c.unread ? "text-foreground" : "text-muted-foreground")}>
                          {c.lastSender === "ai" ? "🤖 " : c.lastSender === "agent" ? "คุณ: " : ""}
                          {c.lastMessage ?? "—"}
                        </p>
                        <div className="mt-1 flex items-center gap-1.5">
                          {c.mode === "ai" ? (
                            <Badge tone="primary" className="px-1.5 py-0 text-[10px]">
                              <Bot className="size-3" /> AI
                            </Badge>
                          ) : (
                            <Badge tone={c.status === "resolved" || c.status === "closed" ? "neutral" : "warning"} className="px-1.5 py-0 text-[10px]">
                              <UserRound className="size-3" /> แอดมิน
                            </Badge>
                          )}
                          {c.intent && <span className="truncate text-[10px] text-muted-foreground">{INTENT_LABEL[c.intent] ?? c.intent}</span>}
                          {c.unread > 0 && <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">{c.unread}</span>}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Thread + customer panel */}
        {selectedId ? (
          <Thread
            key={selectedId}
            id={selectedId}
            onBack={() => select(null)}
            showCustomer={showCustomer}
            onToggleCustomer={() => setShowCustomer((v) => !v)}
          />
        ) : (
          <div className="hidden flex-1 place-items-center bg-muted/30 text-center md:grid">
            <div className="max-w-sm space-y-2 px-6 text-sm text-muted-foreground">
              <Sparkles className="mx-auto size-8 text-primary" />
              <p className="font-medium text-foreground">เลือกแชตทางซ้ายเพื่อเริ่ม</p>
              <p>
                AI ({PROVIDER_LABEL[s?.aiProvider ?? "minimax"] ?? s?.aiProvider}) ตอบลูกค้าให้อัตโนมัติ และส่งต่อมาที่ “รอแอดมิน” เมื่อต้องใช้คน
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Thread({ id, onBack, showCustomer, onToggleCustomer }: { id: number; onBack: () => void; showCustomer: boolean; onToggleCustomer: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const detail = useQuery({
    queryKey: ["inbox", "conv", id],
    queryFn: () => api.get<ConversationDetail>(`/inbox/conversations/${id}`),
    refetchInterval: POLL_MS,
  });
  const d = detail.data;
  const lastId = d?.messages.at(-1)?.id;
  const unread = d?.unread ?? 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lastId]);

  useEffect(() => {
    if (unread > 0) {
      void api.post(`/inbox/conversations/${id}/read`).then(() => qc.invalidateQueries({ queryKey: ["inbox", "list"] }));
    }
  }, [id, unread, qc]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["inbox"] });
  const canReply = can("inbox:reply");

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      const r = await api.post<{ deliveryStatus: string; error: string | null }>(`/inbox/conversations/${id}/messages`, { text: body });
      setText("");
      if (r.deliveryStatus === "failed") toast.error(`บันทึกข้อความแล้ว แต่ส่งไม่สำเร็จ: ${r.error ?? ""}`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ส่งข้อความไม่สำเร็จ");
    } finally {
      setSending(false);
    }
  };

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };

  const patch = (body: Record<string, unknown>) => api.patch(`/inbox/conversations/${id}`, body);
  const resumeAi = () =>
    act("ai", async () => {
      await patch({ mode: "ai" });
      const lastReal = d?.messages.filter((m) => m.senderType !== "system").at(-1);
      if (lastReal?.senderType === "customer") await api.post(`/inbox/conversations/${id}/ai-reply`);
    }, "เปิดให้ AI ดูแลแชตนี้แล้ว");

  if (detail.isError) {
    return (
      <div className="grid flex-1 place-items-center p-6 text-sm text-muted-foreground">
        <div className="space-y-3 text-center">
          <p>{detail.error instanceof Error ? detail.error.message : "โหลดแชตไม่สำเร็จ"}</p>
          <Button variant="outline" size="sm" onClick={onBack}>
            กลับ
          </Button>
        </div>
      </div>
    );
  }

  const closed = d && (d.status === "resolved" || d.status === "closed");
  return (
    <div className="flex min-w-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col bg-muted/20">
        <header className="flex items-center gap-2 border-b border-border bg-card px-3 py-2.5">
          <button onClick={onBack} className="grid size-8 place-items-center rounded-lg hover:bg-accent md:hidden" aria-label="กลับไปรายการแชต">
            <ArrowLeft className="size-4" />
          </button>
          {d ? (
            <>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{d.customerName ?? "ลูกค้า"}</span>
                  <PlatformBadge platform={d.platform} />
                  <Badge tone={CONV_STATUS[d.status]?.tone} className="hidden sm:inline-flex">
                    {CONV_STATUS[d.status]?.label}
                  </Badge>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {d.channelName}
                  {d.mode === "human" && d.handoffReason ? ` · ส่งต่อเพราะ: ${d.handoffReason}` : ""}
                </p>
              </div>
              {canReply && (
                <div className="flex shrink-0 items-center gap-1">
                  {d.mode === "ai" ? (
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act("human", () => patch({ mode: "human" }), "รับเรื่องต่อจาก AI แล้ว")}>
                      <UserRound className="size-4" />
                      <span className="hidden sm:inline">รับเรื่องเอง</span>
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={resumeAi}>
                      {busy === "ai" ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
                      <span className="hidden sm:inline">ให้ AI ตอบ</span>
                    </Button>
                  )}
                  {closed ? (
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act("open", () => patch({ status: "open" }))} aria-label="เปิดเรื่องอีกครั้ง">
                      <RotateCcw className="size-4" />
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act("resolve", () => patch({ status: "resolved" }), "ปิดเรื่องแล้ว")} aria-label="ปิดเรื่อง">
                      <CheckCircle2 className="size-4" />
                    </Button>
                  )}
                </div>
              )}
              <button onClick={onToggleCustomer} className="hidden size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent sm:grid xl:hidden" aria-label="ข้อมูลลูกค้า">
                <PanelRight className="size-4" />
              </button>
            </>
          ) : (
            <Skeleton className="h-9 flex-1" />
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6">
          {!d ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-2/3" />
              <Skeleton className="ml-auto h-12 w-1/2" />
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-3">
              {d.messages.map((m) => (
                <Bubble key={m.id} m={m} />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {canReply && d && (
          <div className="border-t border-border bg-card p-3">
            {d.mode === "ai" && (
              <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Bot className="size-3.5 text-primary" /> AI กำลังดูแลแชตนี้ — ถ้าคุณพิมพ์ตอบ ระบบจะหยุด AI ในแชตนี้ให้อัตโนมัติ
              </p>
            )}
            <div className="flex items-end gap-2">
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                placeholder="พิมพ์ข้อความ…"
                title="Enter ส่ง, Shift+Enter ขึ้นบรรทัดใหม่"
                className="max-h-40 min-h-10 resize-none"
                aria-label="ข้อความตอบลูกค้า"
              />
              <Button onClick={() => void send()} disabled={sending || !text.trim()} aria-label="ส่ง">
                {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </Button>
            </div>
          </div>
        )}
      </section>

      {d && (
        <aside className={cn("w-80 shrink-0 overflow-y-auto border-l border-border bg-card p-4", showCustomer ? "hidden sm:block" : "hidden xl:block")}>
          <CustomerPanel d={d} />
        </aside>
      )}
    </div>
  );
}

function Bubble({ m }: { m: InboxMessage }) {
  if (m.senderType === "system") {
    return (
      <div className="flex justify-center">
        <span className="rounded-full bg-muted px-3 py-1 text-center text-[11px] text-muted-foreground">
          {m.content} · {formatDateTime(m.createdAt)}
        </span>
      </div>
    );
  }
  const mine = m.direction === "out";
  const ai = m.senderType === "ai";
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[85%] sm:max-w-[70%]", mine && "items-end")}>
        <div
          className={cn(
            "whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm shadow-xs",
            !mine && "rounded-bl-md border border-border bg-card",
            mine && ai && "rounded-br-md bg-primary-soft text-foreground ring-1 ring-primary/20",
            mine && !ai && "rounded-br-md bg-primary text-primary-foreground",
          )}
        >
          {m.content}
        </div>
        <div className={cn("mt-1 flex flex-wrap items-center gap-1.5 px-1 text-[10px] text-muted-foreground", mine && "justify-end")}>
          {ai && (
            <span className="inline-flex items-center gap-0.5 font-medium text-primary">
              <Bot className="size-3" /> AI{m.aiMeta?.provider ? ` · ${PROVIDER_LABEL[m.aiMeta.provider] ?? m.aiMeta.provider}` : ""}
            </span>
          )}
          {m.senderType === "agent" && m.senderName && <span>{m.senderName}</span>}
          {ai && m.aiMeta?.tools?.length ? (
            <span className="inline-flex items-center gap-0.5" title={m.aiMeta.tools.join(", ")}>
              <Wrench className="size-3" />
              {[...new Set(m.aiMeta.tools)].map((t) => TOOL_LABEL[t] ?? t).join(", ")}
            </span>
          ) : null}
          <span>{formatDateTime(m.createdAt)}</span>
          {m.deliveryStatus === "failed" && <span className="font-medium text-danger">ส่งไม่สำเร็จ</span>}
        </div>
      </div>
    </div>
  );
}

function CustomerPanel({ d }: { d: ConversationDetail }) {
  const c = d.customer;
  return (
    <div className="space-y-5 text-sm">
      <div className="flex items-center gap-3">
        <div className="grid size-12 place-items-center rounded-full bg-muted font-semibold">{initials(c?.name ?? d.customerName ?? "?")}</div>
        <div className="min-w-0">
          <p className="truncate font-semibold">{c?.name ?? d.customerName}</p>
          <p className="text-xs text-muted-foreground">{PLATFORM[d.platform]?.label}</p>
        </div>
      </div>
      {c && (
        <div className="grid grid-cols-2 gap-2">
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">ยอดซื้อสะสม</p>
            <p className="font-semibold">{formatMoney(c.totalSpent)}</p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">จำนวนออร์เดอร์</p>
            <p className="font-semibold">{c.orderCount}</p>
          </Card>
          {(c.phone || c.email) && <p className="col-span-2 truncate text-xs text-muted-foreground">{[c.phone, c.email].filter(Boolean).join(" · ")}</p>}
        </div>
      )}

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">ออร์เดอร์ล่าสุด</h3>
        {d.orders.length ? (
          <ul className="space-y-1.5">
            {d.orders.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{o.orderNo}</p>
                  <p className="text-[11px] text-muted-foreground">{formatDateTime(o.orderedAt)}</p>
                </div>
                <span className="shrink-0 text-xs font-medium">{formatMoney(o.total)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">ยังไม่มีออร์เดอร์ที่ผูกกับลูกค้านี้</p>
        )}
      </section>

      {d.offers.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">ข้อเสนอจาก AI</h3>
          <ul className="space-y-1.5">
            {d.offers.map((o) => (
              <li key={o.id} className="rounded-lg border border-border px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">ส่วนลด {o.value}%</span>
                  <Badge tone={OFFER_STATUS[o.status]?.tone}>{OFFER_STATUS[o.status]?.label ?? o.status}</Badge>
                </div>
                {o.code && <p className="mt-1 font-mono text-xs">{o.code}</p>}
                {o.rationale && <p className="mt-1 text-xs text-muted-foreground">{o.rationale}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {d.returns.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">คืน/เปลี่ยนสินค้า</h3>
          <ul className="space-y-1.5">
            {d.returns.map((r) => (
              <li key={r.id} className="rounded-lg border border-border px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{r.reason}</span>
                  <Badge tone={RETURN_STATUS[r.status]?.tone}>{RETURN_STATUS[r.status]?.label ?? r.status}</Badge>
                </div>
                {r.detail && <p className="mt-1 text-xs text-muted-foreground">{r.detail}</p>}
              </li>
            ))}
          </ul>
          <Link href="/inbox/aftersales" className="mt-2 inline-block text-xs font-medium text-primary hover:underline">
            จัดการเรื่องคืนสินค้า →
          </Link>
        </section>
      )}
    </div>
  );
}
