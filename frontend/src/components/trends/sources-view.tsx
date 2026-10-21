"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, KeyRound, Loader2, Play, Plus, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { ScrapeRun, ScrapeSource, SourcePlatform } from "@/lib/types";
import { formatDateTime, formatRelativeTime } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardHeader, CardTitle, Input, Label, NativeSelect, Skeleton, Textarea } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { PageHeader } from "@/components/layout/page";
import { AI_PLATFORM_FOCUS, SOURCE_PLATFORM } from "./labels";

export function SourcesView() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const canRun = can("scraping:run");
  const [editing, setEditing] = useState<ScrapeSource | "new" | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const sources = useQuery({ queryKey: ["trends", "sources"], queryFn: () => api.get<ScrapeSource[]>("/scraping/sources") });
  const runs = useQuery({
    queryKey: ["trends", "runs"],
    queryFn: () => api.get<ScrapeRun[]>("/scraping/runs"),
    // Poll while something is running so the user sees it finish
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === "running") ? 5000 : false),
  });

  const run = async (s: ScrapeSource) => {
    setBusy(s.id);
    try {
      await api.post(`/scraping/sources/${s.id}/run`);
      toast.success("เข้าคิวแล้ว ระบบจะดึงข้อมูลในรอบ cron ถัดไป (ภายใน ~1 นาที)");
      await qc.invalidateQueries({ queryKey: ["trends"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "สั่งดึงข้อมูลไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };
  const remove = async (s: ScrapeSource) => {
    if (!window.confirm(`ลบแหล่งข้อมูล "${s.name}"? (สินค้าที่ดึงมาแล้วยังอยู่)`)) return;
    try {
      await api.del(`/scraping/sources/${s.id}`);
      await qc.invalidateQueries({ queryKey: ["trends"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="แหล่งข้อมูลสินค้าเทรนด์"
        description="ใช้ API ทางการเป็นหลัก การ scrape หน้าเว็บ Shopee/TikTok โดยตรงขัดข้อกำหนดการใช้งาน ระบบจึงไม่ทำ"
        actions={
          canRun && (
            <Button onClick={() => setEditing("new")}>
              <Plus /> เพิ่มแหล่งข้อมูล
            </Button>
          )
        }
      />

      {sources.isPending ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sources.data?.map((s) => (
            <Card key={s.id} className="space-y-3 p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {SOURCE_PLATFORM[s.platform]?.label ?? s.platform} · {SOURCE_PLATFORM[s.platform]?.method} · {s.itemCount} สินค้า
                  </p>
                </div>
                {!s.isActive ? <Badge>ปิดอยู่</Badge> : s.intervalHours ? <Badge tone="primary"><Clock className="size-3" /> ทุก {s.intervalHours} ชม.</Badge> : <Badge>สั่งเอง</Badge>}
              </div>
              {!s.runnable ? (
                <p className="flex gap-1.5 text-xs text-warning">
                  <AlertTriangle className="size-3.5 shrink-0" /> {s.notRunnableReason}
                </p>
              ) : !s.configured ? (
                <p className="flex gap-1.5 text-xs text-warning">
                  <KeyRound className="size-3.5 shrink-0" /> ต้องตั้งค่าบนเซิร์ฟเวอร์: {s.missingEnv.join(", ")}
                </p>
              ) : null}
              {s.lastError && (
                <p className="line-clamp-2 rounded-lg bg-danger-soft px-2.5 py-1.5 text-xs text-danger">ครั้งล่าสุดผิดพลาด: {s.lastError}</p>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-xs text-muted-foreground">{s.lastRunAt ? `ดึงล่าสุด ${formatRelativeTime(s.lastRunAt)}` : "ยังไม่เคยดึง"}</span>
                {canRun && (
                  <div className="ml-auto flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => void remove(s)} aria-label="ลบ">
                      <Trash2 />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(s)}>
                      แก้ไข
                    </Button>
                    <Button size="sm" disabled={!s.runnable || !s.configured || busy === s.id} onClick={() => void run(s)}>
                      {busy === s.id ? <Loader2 className="animate-spin" /> : <Play />} ดึงตอนนี้
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>ประวัติการดึงข้อมูล</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {runs.isPending ? (
            <Skeleton className="m-4 h-24" />
          ) : !runs.data?.length ? (
            <p className="p-6 text-center text-sm text-muted-foreground">ยังไม่มีประวัติ</p>
          ) : (
            <table className="table-cards w-full min-w-[600px] text-sm">
              <thead className="border-y border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">เวลา</th>
                  <th className="px-4 py-2 font-medium">แหล่งข้อมูล</th>
                  <th className="px-4 py-2 font-medium">ผล</th>
                  <th className="px-4 py-2 text-right font-medium">พบ / ใหม่</th>
                  <th className="px-4 py-2 font-medium">สั่งโดย</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.data.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-4 py-2.5">{formatDateTime(r.startedAt)}</td>
                    <td data-label="แหล่งข้อมูล" className="px-4 py-2.5">{r.sourceName}</td>
                    <td data-label="ผล" className="px-4 py-2.5">
                      {r.status === "succeeded" ? (
                        <span className="inline-flex items-center gap-1 text-success">
                          <CheckCircle2 className="size-4" /> สำเร็จ
                        </span>
                      ) : r.status === "failed" ? (
                        <span className="inline-flex items-center gap-1 text-danger" title={r.error ?? ""}>
                          <XCircle className="size-4" /> <span className="line-clamp-1 max-w-[220px]">{r.error ?? "ผิดพลาด"}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-primary">
                          <Loader2 className="size-4 animate-spin" /> กำลังดึง
                        </span>
                      )}
                    </td>
                    <td data-label="พบ / ใหม่" className="px-4 py-2.5 text-right tabular-nums">
                      {r.itemsFound} / {r.itemsNew}
                    </td>
                    <td data-label="สั่งโดย" className="px-4 py-2.5 text-muted-foreground">{r.triggeredBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing !== null && <SourceDialog key={editing === "new" ? "new" : editing.id} source={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </div>
  );
}

const NEW_PLATFORMS: SourcePlatform[] = ["ai_search", "shopee_affiliate", "apify", "custom_url"];

function SourceDialog({ source, onDone }: { source: ScrapeSource | null; onDone: () => void }) {
  const qc = useQueryClient();
  const c = source?.config ?? {};
  const [platform, setPlatform] = useState<SourcePlatform>(source?.platform ?? "shopee_affiliate");
  const [name, setName] = useState(source?.name ?? "");
  const [interval, setIntervalHours] = useState(source?.intervalHours ? String(source.intervalHours) : "");
  const [isActive, setActive] = useState(source?.isActive ?? true);
  const [keyword, setKeyword] = useState(String(c.keyword ?? ""));
  const [sortType, setSortType] = useState(String(c.sortType ?? "sales"));
  const [pages, setPages] = useState(String(c.pages ?? 1));
  const [urls, setUrls] = useState(Array.isArray(c.urls) ? (c.urls as string[]).join("\n") : "");
  const [actorId, setActorId] = useState(String(c.actorId ?? ""));
  const [input, setInput] = useState(c.input ? JSON.stringify(c.input, null, 2) : "{}");
  const [fieldMap, setFieldMap] = useState(c.fieldMap ? JSON.stringify(c.fieldMap, null, 2) : '{\n  "title": "title",\n  "price": "price"\n}');
  const [focus, setFocus] = useState(String(c.focus ?? ""));
  const [platformFocus, setPlatformFocus] = useState(String(c.platformFocus ?? "any"));
  const [count, setCount] = useState(String(c.count ?? 8));
  const [enrich, setEnrich] = useState(c.enrich !== false);
  const [saving, setSaving] = useState(false);

  const buildConfig = () => {
    if (platform === "ai_search") return { ...c, focus: focus.trim() || undefined, platformFocus, count: Number(count) || 8, enrich };
    if (platform === "shopee_affiliate") return { keyword: keyword || undefined, sortType, pages: Number(pages) || 1 };
    if (platform === "custom_url") return { urls: urls.split(/\s+/).map((u) => u.trim()).filter(Boolean) };
    if (platform === "apify") return { actorId, input: JSON.parse(input || "{}"), fieldMap: JSON.parse(fieldMap || "{}") };
    return {};
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    let config;
    try {
      config = buildConfig();
    } catch {
      return toast.error("JSON ของ input/fieldMap ไม่ถูกต้อง");
    }
    setSaving(true);
    const body = { name, config, intervalHours: interval ? Number(interval) : null, isActive };
    try {
      if (source) await api.patch(`/scraping/sources/${source.id}`, body);
      else await api.post("/scraping/sources", { ...body, platform });
      toast.success("บันทึกแหล่งข้อมูลแล้ว");
      await qc.invalidateQueries({ queryKey: ["trends", "sources"] });
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent title={source ? `แก้ไข ${source.name}` : "เพิ่มแหล่งข้อมูล"} description={SOURCE_PLATFORM[platform]?.hint}>
      <form onSubmit={save} className="space-y-4">
        {!source && (
          <div className="space-y-1.5">
            <Label htmlFor="src-platform">ประเภท</Label>
            <NativeSelect id="src-platform" value={platform} onChange={(e) => setPlatform(e.target.value as SourcePlatform)}>
              {NEW_PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {SOURCE_PLATFORM[p].label}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="src-name">ชื่อ</Label>
          <Input id="src-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={191} placeholder="เช่น Shopee — ของใช้ในบ้าน ขายดี" />
        </div>

        {platform === "shopee_affiliate" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-3">
              <Label htmlFor="src-kw">คำค้น (เว้นว่าง = ทุกหมวด)</Label>
              <Input id="src-kw" value={keyword} onChange={(e) => setKeyword(e.target.value)} maxLength={100} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="src-sort">เรียงตาม</Label>
              <NativeSelect id="src-sort" value={sortType} onChange={(e) => setSortType(e.target.value)}>
                <option value="sales">ขายดีที่สุด</option>
                <option value="commission">ค่าคอมสูงสุด</option>
                <option value="relevance">ตรงคำค้น</option>
                <option value="price_asc">ราคาต่ำ → สูง</option>
                <option value="price_desc">ราคาสูง → ต่ำ</option>
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="src-pages">จำนวนหน้า (50/หน้า)</Label>
              <NativeSelect id="src-pages" value={pages} onChange={(e) => setPages(e.target.value)}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
        )}
        {platform === "ai_search" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5 sm:col-span-3">
              <Label htmlFor="src-focus">หมวด/คำค้นที่สนใจ (เว้นว่าง = ทุกหมวด)</Label>
              <Input id="src-focus" value={focus} onChange={(e) => setFocus(e.target.value)} maxLength={200} placeholder="เช่น ของใช้ในห้องนอน, สัตว์เลี้ยง" />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="src-pf">แพลตฟอร์ม</Label>
              <NativeSelect id="src-pf" value={platformFocus} onChange={(e) => setPlatformFocus(e.target.value)}>
                {AI_PLATFORM_FOCUS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="src-count">จำนวนสินค้า</Label>
              <NativeSelect id="src-count" value={count} onChange={(e) => setCount(e.target.value)}>
                {[5, 8, 10, 15].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-3">
              <input type="checkbox" checked={enrich} onChange={(e) => setEnrich(e.target.checked)} className="size-4 accent-primary" />
              ดึงสินค้าจริงพร้อมตัวเลขจาก Shopee Affiliate (เมื่อตั้งค่าไว้)
            </label>
            <p className="text-xs text-muted-foreground sm:col-span-3">ค่าใช้จ่าย: ค่าค้นเว็บของ MiniMax (beta) ประมาณ $0.01 ต่อการค้น + ค่า token ต่อรอบ</p>
          </div>
        )}
        {platform === "custom_url" && (
          <div className="space-y-1.5">
            <Label htmlFor="src-urls">URL หน้าสินค้า (บรรทัดละ 1, สูงสุด 10)</Label>
            <Textarea id="src-urls" value={urls} onChange={(e) => setUrls(e.target.value)} rows={4} placeholder="https://brand.example.com/products/1" />
            <p className="text-xs text-muted-foreground">ใช้กับเว็บที่อนุญาตเท่านั้น ระบบตรวจ robots.txt ทุกครั้ง และปฏิเสธ Shopee/TikTok/Lazada</p>
          </div>
        )}
        {platform === "apify" && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="src-actor">Actor ID</Label>
              <Input id="src-actor" value={actorId} onChange={(e) => setActorId(e.target.value)} required placeholder="username/actor-name" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="src-input">Input (JSON)</Label>
                <Textarea id="src-input" value={input} onChange={(e) => setInput(e.target.value)} rows={5} className="font-mono text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="src-map">จับคู่ฟิลด์ (JSON)</Label>
                <Textarea id="src-map" value={fieldMap} onChange={(e) => setFieldMap(e.target.value)} rows={5} className="font-mono text-xs" />
              </div>
            </div>
          </>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="src-int">ดึงอัตโนมัติ</Label>
            <NativeSelect id="src-int" value={interval} onChange={(e) => setIntervalHours(e.target.value)}>
              <option value="">ไม่ตั้งเวลา (สั่งเอง)</option>
              {[3, 6, 12, 24, 72, 168].map((h) => (
                <option key={h} value={h}>
                  ทุก {h < 24 ? `${h} ชั่วโมง` : `${h / 24} วัน`}
                </option>
              ))}
            </NativeSelect>
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setActive(e.target.checked)} className="size-4 accent-primary" />
            เปิดใช้งาน
          </label>
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
