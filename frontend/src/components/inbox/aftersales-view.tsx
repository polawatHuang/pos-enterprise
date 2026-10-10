"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, MessagesSquare, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { AiOffer, DisputeCase, ReturnCase } from "@/lib/types";
import { formatDateTime, formatMoney } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, Label, NativeSelect, Skeleton, TabBar, Textarea } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { PageHeader } from "@/components/layout/page";
import { DISPUTE_STATUS, OFFER_STATUS, RESOLUTION_LABEL, RETURN_STATUS, SEVERITY } from "./labels";
import { PlatformBadge } from "./inbox-view";

type Tab = "returns" | "offers" | "disputes";

const chatLink = (id: number | null) =>
  id ? (
    <Link href={`/inbox?c=${id}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
      <MessagesSquare className="size-3.5" /> เปิดแชต
    </Link>
  ) : null;

export function AftersalesView() {
  const [tab, setTab] = useState<Tab>("returns");
  const offers = useQuery({ queryKey: ["inbox", "offers"], queryFn: () => api.get<AiOffer[]>("/inbox/offers") });
  const returns = useQuery({ queryKey: ["inbox", "returns"], queryFn: () => api.get<ReturnCase[]>("/inbox/returns") });
  const pendingOffers = offers.data?.filter((o) => o.status === "needs_approval").length ?? 0;
  const newReturns = returns.data?.filter((r) => r.status === "requested").length ?? 0;
  const count = (n: number) => (n ? <span className="ml-1.5 rounded-full bg-warning-soft px-1.5 text-[11px] text-warning">{n}</span> : null);

  return (
    <div>
      <PageHeader title="คืนสินค้า ข้อพิพาท และข้อเสนอ" description="เรื่องหลังการขายที่ AI เปิดไว้หรือรอผู้จัดการตัดสินใจ" />
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "returns", label: <>คืน/เปลี่ยนสินค้า{count(newReturns)}</> },
          { value: "offers", label: <>ส่วนลดรออนุมัติ{count(pendingOffers)}</> },
          { value: "disputes", label: "ข้อพิพาท" },
        ]}
      />
      <div className="mt-6">
        {tab === "returns" && <Returns data={returns.data} loading={returns.isPending} />}
        {tab === "offers" && <Offers data={offers.data} loading={offers.isPending} />}
        {tab === "disputes" && <Disputes />}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- returns */

function Returns({ data, loading }: { data?: ReturnCase[]; loading: boolean }) {
  const { can } = useAuth();
  const [editing, setEditing] = useState<ReturnCase | null>(null);
  if (loading) return <Skeleton className="h-64" />;
  if (!data?.length) return <Empty text="ยังไม่มีเรื่องคืนสินค้า" />;
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data.map((r) => (
          <Card key={r.id} className="space-y-2 p-4 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{r.reason}</p>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {r.platform && <PlatformBadge platform={r.platform} />}
                  {r.customerName ?? "ลูกค้า"} · {formatDateTime(r.createdAt)}
                </p>
              </div>
              <Badge tone={RETURN_STATUS[r.status]?.tone}>{RETURN_STATUS[r.status]?.label}</Badge>
            </div>
            {r.detail && <p className="text-muted-foreground">{r.detail}</p>}
            <p className="text-xs">
              ออร์เดอร์: {r.orderNo ? `${r.orderNo} (${formatMoney(r.orderTotal ?? 0)})` : "ไม่ระบุ"} · ทางแก้: {RESOLUTION_LABEL[r.resolution] ?? r.resolution}
              {r.amount ? ` ${formatMoney(r.amount)}` : ""}
            </p>
            {r.resolutionNote && <p className="rounded-lg bg-muted px-2.5 py-1.5 text-xs">{r.resolutionNote}</p>}
            <div className="flex items-center justify-between pt-1">
              {chatLink(r.conversationId)}
              {can("inbox:manage_ai") && (
                <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                  จัดการ
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && <ReturnDialog key={editing.id} r={editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </>
  );
}

const NOTIFY_TEMPLATE: Record<string, string> = {
  approved: "ทางร้านอนุมัติเรื่องของคุณลูกค้าแล้วค่ะ เดี๋ยวแอดมินจะแจ้งขั้นตอนต่อไปนะคะ",
  completed: "ดำเนินการเรื่องคืน/เปลี่ยนสินค้าเรียบร้อยแล้วค่ะ ขอบคุณที่ให้โอกาสร้านดูแลนะคะ 🙏",
  rejected: "ขออภัยค่ะ ทางร้านไม่สามารถรับคืนรายการนี้ได้ตามนโยบาย หากมีข้อสงสัยแจ้งแอดมินได้เลยนะคะ",
};

function ReturnDialog({ r, onDone }: { r: ReturnCase; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ status: r.status as string, resolution: r.resolution, amount: String(r.amount || ""), note: r.resolutionNote ?? "", notify: "" });
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/inbox/returns/${r.id}`, {
        status: f.status,
        resolution: f.resolution,
        amount: f.amount ? Number(f.amount) : 0,
        resolutionNote: f.note || null,
        notifyCustomer: f.notify.trim() || undefined,
      });
      toast.success(f.notify.trim() ? "บันทึกและแจ้งลูกค้าแล้ว" : "บันทึกแล้ว");
      await qc.invalidateQueries({ queryKey: ["inbox"] });
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent title="จัดการเรื่องคืนสินค้า" description={r.reason}>
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rt-status">สถานะ</Label>
            <NativeSelect
              id="rt-status"
              value={f.status}
              onChange={(e) => setF({ ...f, status: e.target.value, notify: f.notify || (r.conversationId ? NOTIFY_TEMPLATE[e.target.value] ?? "" : "") })}
            >
              {Object.entries(RETURN_STATUS).map(([v, s]) => (
                <option key={v} value={v}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rt-res">ทางแก้</Label>
            <NativeSelect id="rt-res" value={f.resolution} onChange={(e) => setF({ ...f, resolution: e.target.value })}>
              {Object.entries(RESOLUTION_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rt-amt">มูลค่าที่คืน/ชดเชย (บาท)</Label>
          <Input id="rt-amt" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rt-note">บันทึกภายใน</Label>
          <Textarea id="rt-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} rows={2} />
        </div>
        {r.conversationId && (
          <div className="space-y-1.5">
            <Label htmlFor="rt-notify">ข้อความแจ้งลูกค้าทางแชต (เว้นว่างถ้าไม่ส่ง)</Label>
            <Textarea id="rt-notify" value={f.notify} onChange={(e) => setF({ ...f, notify: e.target.value })} rows={3} />
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            ยกเลิก
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />} บันทึก
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}

/* ----------------------------------------------------------------- offers */

function Offers({ data, loading }: { data?: AiOffer[]; loading: boolean }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<number | null>(null);
  if (loading) return <Skeleton className="h-64" />;
  if (!data?.length) return <Empty text="ยังไม่มีข้อเสนอจาก AI" />;

  const decide = async (o: AiOffer, action: "approve" | "decline") => {
    setBusy(o.id);
    try {
      const r = await api.post<{ code?: string }>(`/inbox/offers/${o.id}/${action}`);
      toast.success(action === "approve" ? `อนุมัติแล้ว ส่งโค้ด ${r.code} ให้ลูกค้าทางแชต` : "ไม่อนุมัติข้อเสนอ — แจ้งลูกค้าในแชตได้เลย");
      await qc.invalidateQueries({ queryKey: ["inbox"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-border">
        {data.map((o) => (
          <li key={o.id} className="flex flex-col gap-3 p-4 text-sm sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <PlatformBadge platform={o.platform} />
                <span className="font-medium">{o.customerName ?? "ลูกค้า"}</span>
                <span className="font-semibold">ส่วนลด {o.value}%</span>
                <Badge tone={OFFER_STATUS[o.status]?.tone}>{OFFER_STATUS[o.status]?.label ?? o.status}</Badge>
                {o.code && <code className="rounded bg-muted px-1.5 text-xs">{o.code}</code>}
              </div>
              {o.rationale && <p className="mt-1 text-muted-foreground">เหตุผลของ AI: {o.rationale}</p>}
              <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                <span>{formatDateTime(o.createdAt)}</span>
                {chatLink(o.conversationId)}
              </div>
            </div>
            {o.status === "needs_approval" && can("inbox:manage_ai") && (
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="outline" disabled={busy === o.id} onClick={() => void decide(o, "decline")}>
                  <X /> ไม่อนุมัติ
                </Button>
                <Button size="sm" disabled={busy === o.id} onClick={() => void decide(o, "approve")}>
                  {busy === o.id ? <Loader2 className="animate-spin" /> : <Check />} อนุมัติและส่งโค้ด
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* --------------------------------------------------------------- disputes */

function Disputes() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["inbox", "disputes"], queryFn: () => api.get<DisputeCase[]>("/inbox/disputes") });
  const [creating, setCreating] = useState(false);

  const setStatus = async (d: DisputeCase, status: string) => {
    const note = status === "resolved" || status === "lost" ? window.prompt("บันทึกผลการยุติ (ไม่บังคับ)") : null;
    try {
      await api.patch(`/inbox/disputes/${d.id}`, { status, resolutionNote: note || null });
      await qc.invalidateQueries({ queryKey: ["inbox", "disputes"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">บันทึกข้อพิพาทจากแพลตฟอร์ม (เช่น Shopee/TikTok ขอคืนเงิน) เพื่อติดตามจนจบ</p>
        {can("inbox:reply") && <Button onClick={() => setCreating(true)}>บันทึกข้อพิพาท</Button>}
      </div>
      {list.isPending ? (
        <Skeleton className="h-48" />
      ) : !list.data?.length ? (
        <Empty text="ไม่มีข้อพิพาท" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">เรื่อง</th>
                <th className="px-4 py-2.5 font-medium">ออร์เดอร์</th>
                <th className="px-4 py-2.5 font-medium">ความรุนแรง</th>
                <th className="px-4 py-2.5 font-medium">สถานะ</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.data.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{d.category}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.platform ?? "—"} · {formatDateTime(d.createdAt)}
                    </p>
                    {d.summary && <p className="mt-1 text-xs">{d.summary}</p>}
                    {d.resolutionNote && <p className="mt-1 text-xs text-success">{d.resolutionNote}</p>}
                  </td>
                  <td className="px-4 py-3">{d.orderNo ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={SEVERITY[d.severity]?.tone}>{SEVERITY[d.severity]?.label}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    {can("inbox:manage_ai") ? (
                      <NativeSelect value={d.status} onChange={(e) => void setStatus(d, e.target.value)} className="h-8 w-36 text-xs" aria-label="สถานะข้อพิพาท">
                        {Object.entries(DISPUTE_STATUS).map(([v, s]) => (
                          <option key={v} value={v}>
                            {s.label}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : (
                      <Badge tone={DISPUTE_STATUS[d.status]?.tone}>{DISPUTE_STATUS[d.status]?.label}</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">{chatLink(d.conversationId)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        {creating && <DisputeDialog onDone={() => setCreating(false)} />}
      </Dialog>
    </div>
  );
}

function DisputeDialog({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ platform: "shopee", orderNo: "", category: "", summary: "", severity: "medium" });
  const [saving, setSaving] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/inbox/disputes", { ...f, orderNo: f.orderNo || null, summary: f.summary || null });
      await qc.invalidateQueries({ queryKey: ["inbox", "disputes"] });
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };
  return (
    <DialogContent title="บันทึกข้อพิพาท">
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="dp-platform">แพลตฟอร์ม</Label>
            <NativeSelect id="dp-platform" value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>
              {["shopee", "tiktok", "lazada", "facebook", "line", "อื่นๆ"].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dp-order">เลขออร์เดอร์</Label>
            <Input id="dp-order" value={f.orderNo} onChange={(e) => setF({ ...f, orderNo: e.target.value })} maxLength={40} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dp-cat">ประเภทเรื่อง</Label>
          <Input id="dp-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} required maxLength={100} placeholder="เช่น ลูกค้าแจ้งไม่ได้รับสินค้า" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dp-sum">รายละเอียด</Label>
          <Textarea id="dp-sum" value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} rows={3} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dp-sev">ความรุนแรง</Label>
          <NativeSelect id="dp-sev" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>
            {Object.entries(SEVERITY).map(([v, s]) => (
              <option key={v} value={v}>
                {s.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            ยกเลิก
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />} บันทึก
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}

function Empty({ text }: { text: string }) {
  return <Card className="py-16 text-center text-sm text-muted-foreground">{text}</Card>;
}
