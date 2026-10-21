"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CalendarClock,
  ChevronRight,
  Crown,
  Mail,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  ReceiptText,
  ShieldCheck,
  ShieldOff,
  ShoppingBag,
  Sparkles,
  Wallet,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { CustomerDetail as Detail, CustomerSummary } from "@/lib/types";
import { formatDateTime, formatMoney, formatNumber, formatRelativeTime } from "@/lib/utils";
import { CUSTOMERS_WRITE } from "@/config/nav";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/overlays";
import { CHANNEL_META, ErrorNote, channelLabel } from "@/components/dashboard/widgets";
import { SaleDetailDialog } from "@/components/accounting/sale-detail";
import { CONV_STATUS, INTENT_LABEL } from "@/components/inbox/labels";
import { CustomerFormDialog } from "./customer-form";
import { Avatar, PlatformBadge } from "./customers-view";
import { ORDER_STATUS, customerSegment, daysAgoLabel, formatPhone } from "./labels";

/** One customer: profile, lifetime stats, purchase history and chats across channels. */
export function CustomerDetail({ id }: { id: number }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const canWrite = CUSTOMERS_WRITE.some((p) => can(p));
  const canChat = can("inbox:read");
  const detail = useQuery({ queryKey: ["customers", "detail", id], queryFn: () => api.get<Detail>(`/customers/${id}`) });
  const summary = useQuery({
    queryKey: ["customers", "summary"],
    queryFn: () => api.get<CustomerSummary>("/customers/summary"),
    staleTime: 60_000,
    enabled: canWrite,
  });
  const [editing, setEditing] = useState(false);
  const [orderId, setOrderId] = useState<number | null>(null);

  if (detail.isPending) return <DetailSkeleton />;
  if (detail.isError || !detail.data) {
    const missing = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <div>
        <BackLink />
        <Card className="mt-4">
          {missing ? (
            <p className="py-16 text-center text-sm text-muted-foreground">ไม่พบลูกค้ารายนี้ อาจถูกลบหรืออยู่ในองค์กรอื่น</p>
          ) : (
            <ErrorNote onRetry={() => detail.refetch()} />
          )}
        </Card>
      </div>
    );
  }

  const c = detail.data;
  const st = c.stats;
  const seg = customerSegment({ orderCount: st.orderCount, totalSpent: st.totalSpent, lastOrderAt: st.lastOrderAt });
  const maxChannel = Math.max(1, ...c.channels.map((x) => x.totalSpent));

  return (
    <>
      <BackLink />

      {/* Header */}
      <div className="mt-3 mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={c.name} className="size-14 text-base" />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{c.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {c.memberNo && <Badge tone="primary">{c.memberNo}</Badge>}
              {seg && (
                <Badge tone={seg.tone}>
                  {seg.label === "VIP" && <Crown className="size-3" />}
                  {seg.label}
                </Badge>
              )}
              {c.tags.map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
              <span className="text-xs text-muted-foreground">ลูกค้าตั้งแต่ {formatDateTime(c.createdAt)}</span>
            </div>
          </div>
        </div>
        {canWrite && (
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil /> แก้ไขข้อมูล
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={Wallet}
          label="ยอดซื้อรวม"
          value={formatMoney(st.totalSpent)}
          hint={st.totalDiscount > 0 ? `ได้ส่วนลดรวม ${formatMoney(st.totalDiscount)}` : undefined}
        />
        <Stat
          icon={ReceiptText}
          label="จำนวนบิล"
          value={formatNumber(st.orderCount)}
          hint={`${formatNumber(st.itemsBought)} ชิ้น${st.cancelledCount ? ` · ยกเลิก/คืน ${st.cancelledCount}` : ""}`}
        />
        <Stat icon={ShoppingBag} label="เฉลี่ยต่อบิล" value={formatMoney(st.avgBasket)} />
        <Stat
          icon={Sparkles}
          label="แต้มสะสม"
          value={formatNumber(st.points)}
          hint={st.pointsUsed ? `ใช้ไปแล้ว ${formatNumber(st.pointsUsed)} แต้ม` : undefined}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: profile & insights */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>ข้อมูลติดต่อ</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <InfoRow icon={Phone} label="เบอร์โทร">
                {c.phone ? (
                  <a href={`tel:${c.phone}`} className="tabular-nums hover:text-primary">
                    {formatPhone(c.phone)}
                  </a>
                ) : null}
              </InfoRow>
              <InfoRow icon={Mail} label="อีเมล">
                {c.email ? (
                  <a href={`mailto:${c.email}`} className="break-all hover:text-primary">
                    {c.email}
                  </a>
                ) : null}
              </InfoRow>
              <InfoRow icon={MapPin} label="ที่อยู่">
                {c.address ? <span className="whitespace-pre-line">{c.address}</span> : null}
              </InfoRow>
              <InfoRow icon={ReceiptText} label="ใบกำกับภาษี">
                {c.taxId ? (
                  <span className="tabular-nums">
                    {c.taxId}
                    {c.branchNo && <span className="text-muted-foreground"> · {c.branchNo === "00000" ? "สำนักงานใหญ่" : `สาขา ${c.branchNo}`}</span>}
                  </span>
                ) : null}
              </InfoRow>
              <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs">
                {c.consentMarketing ? (
                  <>
                    <ShieldCheck className="size-4 text-success" /> ยินยอมรับข่าวสาร (PDPA)
                  </>
                ) : (
                  <>
                    <ShieldOff className="size-4 text-muted-foreground" /> ยังไม่ยินยอมรับข่าวสาร — ห้ามส่งข้อความการตลาด
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>ไทม์ไลน์การซื้อ</CardTitle>
                <CardDescription>นับเฉพาะบิลที่ชำระแล้ว</CardDescription>
              </div>
              <CalendarClock className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">ซื้อครั้งแรก</dt>
                  <dd className="mt-0.5 font-medium">{st.firstOrderAt ? formatDateTime(st.firstOrderAt) : "–"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">ซื้อล่าสุด</dt>
                  <dd className="mt-0.5 font-medium">{st.lastOrderAt ? formatDateTime(st.lastOrderAt) : "–"}</dd>
                  {st.lastOrderAt && <dd className="text-xs text-muted-foreground">{daysAgoLabel(st.lastOrderAt)}</dd>}
                </div>
              </dl>
              {c.channels.length > 0 && (
                <div className="mt-5 space-y-2.5">
                  <p className="text-xs font-medium text-muted-foreground">ยอดซื้อตามช่องทาง</p>
                  {c.channels.map((ch) => (
                    <div key={ch.channel}>
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span>{channelLabel(ch.channel)}</span>
                        <span className="tabular-nums">
                          {formatMoney(ch.totalSpent)} <span className="text-xs text-muted-foreground">({ch.orderCount} บิล)</span>
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${(ch.totalSpent / maxChannel) * 100}%`, background: CHANNEL_META[ch.channel]?.color ?? "var(--chart-1)" }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {c.topProducts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>สินค้าที่ซื้อบ่อย</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-2.5 text-sm">
                  {c.topProducts.map((p, i) => (
                    <li key={p.productId} className="flex items-center gap-3">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{p.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatNumber(p.quantity)} ชิ้น · {p.orderCount} บิล
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{formatMoney(p.total)}</span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: history */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>ประวัติการซื้อ</CardTitle>
                <CardDescription>{c.recentOrders.length ? `${c.recentOrders.length} บิลล่าสุด · กดเพื่อดูรายการสินค้า` : "ยังไม่มีการซื้อ"}</CardDescription>
              </div>
            </CardHeader>
            {c.recentOrders.length === 0 ? (
              <p className="px-5 pb-8 pt-2 text-center text-sm text-muted-foreground">
                ลูกค้ารายนี้ยังไม่มีบิล — เลือกลูกค้าในหน้าขาย (POS) เพื่อสะสมยอดและแต้ม
              </p>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {c.recentOrders.map((o) => {
                  const status = ORDER_STATUS[o.status] ?? { label: o.status, tone: "neutral" as const };
                  const voided = o.status === "cancelled" || o.status === "refunded";
                  return (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => setOrderId(o.id)}
                        className="flex w-full items-center gap-3 px-5 py-3 text-left text-sm transition-colors hover:bg-muted/40"
                      >
                        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                          <ReceiptText className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium">{o.orderNo}</span>
                            <Badge tone={status.tone}>{status.label}</Badge>
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {[formatDateTime(o.orderedAt), channelLabel(o.channel), o.branchName, `${formatNumber(o.itemCount)} ชิ้น`]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        <span className={voided ? "font-medium tabular-nums text-muted-foreground line-through" : "font-medium tabular-nums"}>
                          {formatMoney(o.total)}
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>แชตกับลูกค้า</CardTitle>
                <CardDescription>
                  {c.conversations.length ? `${c.conversations.length} ห้องแชต${st.openChats ? ` · เปิดอยู่ ${st.openChats}` : ""}` : "ยังไม่เคยทักแชต"}
                </CardDescription>
              </div>
              <MessageCircle className="size-4 text-muted-foreground" />
            </CardHeader>
            {c.conversations.length === 0 ? (
              <p className="px-5 pb-8 pt-2 text-center text-sm text-muted-foreground">
                เมื่อลูกค้าทักผ่าน LINE, Facebook หรือช่องทางอื่นที่เชื่อมไว้ แชตจะแสดงที่นี่
              </p>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {c.conversations.map((v) => {
                  const status = CONV_STATUS[v.status];
                  const body = (
                    <>
                      <PlatformBadge platform={v.platform} className="h-5 px-1.5 text-[10px]" />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">{v.channelName}</span>
                          {status && <Badge tone={status.tone}>{status.label}</Badge>}
                          {v.intent && <Badge>{INTENT_LABEL[v.intent] ?? v.intent}</Badge>}
                          {v.unreadCount > 0 && <Badge tone="danger">{v.unreadCount} ใหม่</Badge>}
                        </span>
                        {v.lastMessage && <span className="block truncate text-xs text-muted-foreground">{v.lastMessage}</span>}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">{v.lastMessageAt ? formatRelativeTime(v.lastMessageAt) : "–"}</span>
                      {canChat && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
                    </>
                  );
                  return (
                    <li key={v.id}>
                      {canChat ? (
                        <Link href={`/inbox?c=${v.id}`} className="flex items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-muted/40">
                          {body}
                        </Link>
                      ) : (
                        <div className="flex items-center gap-3 px-5 py-3 text-sm">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Dialog open={orderId !== null} onOpenChange={(o) => !o && setOrderId(null)}>
        {orderId !== null && <SaleDetailDialog id={orderId} path={`/customers/${c.id}/orders/${orderId}`} />}
      </Dialog>
      <Dialog open={editing} onOpenChange={setEditing}>
        {editing && (
          <CustomerFormDialog
            customer={c}
            tagSuggestions={summary.data?.tags.map((t) => t.tag)}
            onSaved={(saved) => {
              qc.setQueryData<Detail>(["customers", "detail", id], (prev) => (prev ? { ...prev, ...saved } : prev));
              setEditing(false);
            }}
          />
        )}
      </Dialog>
    </>
  );
}

function BackLink() {
  return (
    <Link href="/customers" className="inline-flex min-h-10 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" /> ลูกค้าทั้งหมด
    </Link>
  );
}

function Stat({ icon: Icon, label, value, hint }: { icon: React.ElementType; label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-4" />
        {label}
      </div>
      <p className="mt-1.5 truncate text-xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

function InfoRow({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="mt-0.5">{children ?? <span className="text-muted-foreground">–</span>}</div>
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div>
      <Skeleton className="h-5 w-28" />
      <div className="mt-4 mb-6 flex items-center gap-4">
        <Skeleton className="size-14 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl lg:col-span-2" />
      </div>
    </div>
  );
}
