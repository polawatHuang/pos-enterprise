"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, apiFetch } from "@/lib/api";
import type { AffiliateLink } from "@/lib/types";
import { formatMoney, formatNumber } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, Label, Skeleton } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { PageHeader } from "@/components/layout/page";

type LinksResponse = { data: AffiliateLink[]; meta: { shopeeConfigured: boolean; missing: string[] } };
export const useAffiliateLinks = () => useQuery({ queryKey: ["social", "links"], queryFn: () => apiFetch<LinksResponse>("/social/affiliate-links") });

export function LinksView() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const links = useAffiliateLinks();
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const meta = links.data?.meta;

  const copy = async (l: AffiliateLink) => {
    await navigator.clipboard.writeText(l.shortUrl ?? l.originalUrl);
    setCopied(l.id);
    setTimeout(() => setCopied(null), 1500);
  };
  const remove = async (l: AffiliateLink) => {
    if (!window.confirm("ลบลิงก์นี้?")) return;
    try {
      await api.del(`/social/affiliate-links/${l.id}`);
      await qc.invalidateQueries({ queryKey: ["social", "links"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="ลิงก์ Affiliate"
        description="ลิงก์ Shopee Affiliate ที่ใช้แนบในโพสต์ ระบบสร้างลิงก์ย่อยแยกต่อโพสต์ (sub id) เพื่อดูว่าโพสต์ไหนขายได้"
        actions={
          can("social:publish") && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> สร้างลิงก์
            </Button>
          )
        }
      />
      {meta && !meta.shopeeConfigured && (
        <p className="flex gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          <KeyRound className="mt-0.5 size-4 shrink-0" /> ยังไม่ได้ตั้งค่า Shopee Affiliate ({meta.missing.join(", ")}) — สร้างลิงก์ Shopee ที่ได้ค่าคอมไม่ได้
        </p>
      )}
      {links.isPending ? (
        <Skeleton className="h-48" />
      ) : !links.data?.data.length ? (
        <Card className="py-16 text-center text-sm text-muted-foreground">ยังไม่มีลิงก์ — สร้างจากหน้านี้ หรือจากรายละเอียดสินค้าเทรนด์</Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">ลิงก์</th>
                <th className="px-4 py-2.5 font-medium">สินค้า</th>
                <th className="px-4 py-2.5 text-right font-medium">คลิก</th>
                <th className="px-4 py-2.5 text-right font-medium">ออร์เดอร์</th>
                <th className="px-4 py-2.5 text-right font-medium">ค่าคอม</th>
                <th className="px-4 py-2.5 text-right font-medium">โพสต์</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {links.data.data.map((l) => (
                <tr key={l.id}>
                  <td className="max-w-[320px] px-4 py-3">
                    <p className="truncate font-medium">{l.label ?? l.shortUrl ?? l.originalUrl}</p>
                    <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                      <Badge className="px-1.5 py-0 text-[10px]">{l.platform}</Badge>
                      {l.shortUrl ?? l.originalUrl}
                      {l.subId && <span>· sub: {l.subId}</span>}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{l.productName ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatNumber(l.clicks)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatNumber(l.conversions)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoney(l.commission)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{l.postCount}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <Button size="sm" variant="ghost" onClick={() => void copy(l)} aria-label="คัดลอกลิงก์">
                      {copied === l.id ? <Check className="text-success" /> : <Copy />}
                    </Button>
                    {can("social:publish") && (
                      <Button size="sm" variant="ghost" onClick={() => void remove(l)} aria-label="ลบลิงก์">
                        <Trash2 />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">
        ยอดคลิกและค่าคอมดูได้ละเอียดใน Shopee Affiliate Dashboard (ตาม sub id) — ตามแนวทาง สคบ. ระบบเติมคำว่า &quot;ลิงก์ affiliate&quot; ในโพสต์ให้อัตโนมัติ
      </p>
      <Dialog open={creating} onOpenChange={setCreating}>
        {creating && <CreateLinkDialog onDone={() => setCreating(false)} />}
      </Dialog>
    </div>
  );
}

export function CreateLinkDialog({ onDone, onCreated }: { onDone: () => void; onCreated?: (id: number) => void }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [subId, setSubId] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await api.post<{ id: number; shortUrl: string | null }>("/social/affiliate-links", { originalUrl: url, label: label || undefined, subId: subId || undefined });
      toast.success(r.shortUrl ? `สร้างลิงก์แล้ว: ${r.shortUrl}` : "บันทึกลิงก์แล้ว");
      await qc.invalidateQueries({ queryKey: ["social", "links"] });
      onCreated?.(r.id);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "สร้างไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };
  return (
    <DialogContent title="สร้างลิงก์ Affiliate" description="วางลิงก์สินค้า Shopee ระบบจะแปลงเป็นลิงก์ affiliate ของคุณ (ลิงก์อื่นจะบันทึกตามเดิม)">
      <form onSubmit={save} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="al-url">ลิงก์สินค้า</Label>
          <Input id="al-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="https://shopee.co.th/..." />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="al-label">ชื่อเรียก</Label>
            <Input id="al-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={191} placeholder="เช่น แคมเปญเซรั่ม ต.ค." />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="al-sub">Sub ID (a-z, 0-9)</Label>
            <Input id="al-sub" value={subId} onChange={(e) => setSubId(e.target.value.replace(/[^A-Za-z0-9]/g, ""))} maxLength={50} placeholder="เช่น oct2026" />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            ยกเลิก
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />} สร้างลิงก์
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
