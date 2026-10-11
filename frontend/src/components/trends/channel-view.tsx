"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, DatabaseZap, Loader2, Pencil, Plus, RefreshCw, Sparkles, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { ChannelPlan, ChannelProfile } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Skeleton, Textarea } from "@/components/ui/primitives";
import { PageHeader } from "@/components/layout/page";

const errText = (err: unknown) =>
  err instanceof ApiError && err.code === "INTEGRATION_NOT_CONFIGURED" ? `ยังไม่ได้ตั้งค่าบนเซิร์ฟเวอร์: ${err.message}` : err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ";

export function ChannelView() {
  const { can } = useAuth();
  const canRun = can("scraping:run");
  const profiles = useQuery({ queryKey: ["trends", "channel-profiles"], queryFn: () => api.get<ChannelProfile[]>("/scraping/channel-profiles") });
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const list = profiles.data ?? [];
  const current = creating ? null : (list.find((p) => p.id === selected) ?? list[0] ?? null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="โปรไฟล์ช่อง"
        description="เล่าว่าใครอยู่เบื้องหลังช่อง (อายุ งาน งานอดิเรก สัตว์เลี้ยง สไตล์) แล้วให้ AI วางแนวช่องและแนะนำหมวดสินค้าที่เข้ากับตัวตน — ช่องที่ขายของตรงกับชีวิตจริงเล่าได้จริงใจกว่า"
        actions={
          <Button variant="outline" asChild>
            <Link href="/trends">
              <ArrowLeft /> สินค้าเทรนด์
            </Link>
          </Button>
        }
      />
      {profiles.isPending ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardContent className="space-y-1 p-2">
              {list.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setCreating(false);
                    setSelected(p.id);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent ${current?.id === p.id ? "bg-accent font-medium" : ""}`}
                >
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {p.isDefault && (
                    <Badge tone="primary" className="shrink-0">
                      หลัก
                    </Badge>
                  )}
                </button>
              ))}
              {!list.length && <p className="px-3 py-2 text-sm text-muted-foreground">ยังไม่มีโปรไฟล์</p>}
              {canRun && (
                <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setCreating(true)}>
                  <Plus /> เพิ่มโปรไฟล์
                </Button>
              )}
            </CardContent>
          </Card>
          <div className="min-w-0 space-y-4">
            {creating || !current ? (
              canRun ? (
                <ProfileForm
                  key="new"
                  onSaved={(p) => {
                    setCreating(false);
                    setSelected(p.id);
                  }}
                  onCancel={list.length ? () => setCreating(false) : undefined}
                />
              ) : (
                <Card className="p-6 text-sm text-muted-foreground">ยังไม่มีโปรไฟล์ช่อง</Card>
              )
            ) : (
              <ProfileDetail key={current.id} p={current} canRun={canRun} onDeleted={() => setSelected(null)} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileForm({ p, onSaved, onCancel }: { p?: ChannelProfile; onSaved: (p: ChannelProfile) => void; onCancel?: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(p?.name ?? "");
  const [persona, setPersona] = useState(p?.persona ?? "");
  const [interests, setInterests] = useState(p?.interests.join(", ") ?? "");
  const [audience, setAudience] = useState(p?.audience ?? "");
  const [onCamera, setOnCamera] = useState(p?.onCamera ?? false);
  const [isDefault, setIsDefault] = useState(p?.isDefault ?? false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const body = {
      name,
      persona,
      interests: interests
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
      audience: audience.trim() || null,
      onCamera,
      isDefault,
    };
    setBusy(true);
    try {
      const saved = p ? await api.put<ChannelProfile>(`/scraping/channel-profiles/${p.id}`, body) : await api.post<ChannelProfile>("/scraping/channel-profiles", body);
      await qc.invalidateQueries({ queryKey: ["trends", "channel-profiles"] });
      toast.success("บันทึกโปรไฟล์แล้ว");
      onSaved(saved);
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{p ? "แก้ไขโปรไฟล์" : "โปรไฟล์ใหม่"}</CardTitle>
        <CardDescription>ยิ่งเล่าละเอียด AI ยิ่งวางแนวช่องได้ตรงตัวตน</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cp-name">ชื่อโปรไฟล์</Label>
            <Input id="cp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น ช่องของใช้ในห้อง" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cp-persona">เจ้าของช่องเป็นใคร</Label>
            <Textarea
              id="cp-persona"
              rows={4}
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              placeholder="เช่น ผู้หญิงอายุ 27 ทำงานออฟฟิศ อยู่คอนโดกับแมว 2 ตัว ชอบจัดห้องและทำอาหารง่าย ๆ"
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cp-interests">ความสนใจ (คั่นด้วยจุลภาค)</Label>
              <Input id="cp-interests" value={interests} onChange={(e) => setInterests(e.target.value)} placeholder="จัดห้อง, แมว, ทำอาหาร" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cp-audience">กลุ่มผู้ชมที่อยากได้</Label>
              <Input id="cp-audience" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="คนทำงานวัย 22–35" />
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={!onCamera} onChange={(e) => setOnCamera(!e.target.checked)} />
              ไม่ออกหน้ากล้อง
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
              ใช้เป็นโปรไฟล์หลักตอนให้ AI วิเคราะห์สินค้า
            </label>
          </div>
          <div className="flex justify-end gap-2">
            {onCancel && (
              <Button type="button" variant="ghost" onClick={onCancel}>
                ยกเลิก
              </Button>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />} บันทึก
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ProfileDetail({ p, canRun, onDeleted }: { p: ChannelProfile; canRun: boolean; onDeleted: () => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const plan = async () => {
    setBusy("plan");
    try {
      await api.post(`/scraping/channel-profiles/${p.id}/plan`, {});
      await qc.invalidateQueries({ queryKey: ["trends", "channel-profiles"] });
      toast.success("AI วางแนวช่องแล้ว");
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (!window.confirm(`ลบโปรไฟล์ "${p.name}"?`)) return;
    try {
      await api.del(`/scraping/channel-profiles/${p.id}`);
      await qc.invalidateQueries({ queryKey: ["trends", "channel-profiles"] });
      onDeleted();
    } catch (err) {
      toast.error(errText(err));
    }
  };

  if (editing) return <ProfileForm p={p} onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} />;
  return (
    <>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="flex flex-wrap items-center gap-2">
              {p.name}
              {p.isDefault && <Badge tone="primary">โปรไฟล์หลัก</Badge>}
              <Badge tone="neutral">{p.onCamera ? "ออกหน้ากล้อง" : "ไม่ออกหน้ากล้อง"}</Badge>
            </CardTitle>
          </div>
          {canRun && (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label="แก้ไขโปรไฟล์">
                <Pencil />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void remove()} aria-label="ลบโปรไฟล์">
                <Trash2 />
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="whitespace-pre-line">{p.persona}</p>
          {p.interests.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {p.interests.map((i) => (
                <Badge key={i} tone="neutral">
                  {i}
                </Badge>
              ))}
            </div>
          )}
          {p.audience && <p className="text-muted-foreground">กลุ่มผู้ชม: {p.audience}</p>}
          {canRun && (
            <div className="pt-2">
              <Button onClick={() => void plan()} disabled={busy !== null} variant={p.aiPlan ? "outline" : "default"}>
                {busy === "plan" ? <Loader2 className="animate-spin" /> : p.aiPlan ? <RefreshCw /> : <Sparkles />}
                {p.aiPlan ? "ให้ AI วางแนวช่องใหม่" : "ให้ AI วางแนวช่อง"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      {p.aiPlan ? (
        <PlanView plan={p.aiPlan} plannedAt={p.aiPlannedAt} canRun={canRun} />
      ) : (
        <Card className="p-6 text-sm text-muted-foreground">
          AI จะเสนอ คอนเซ็ปต์ช่อง → ชื่อช่อง → รูปแบบคอนเทนต์ → เอกลักษณ์ → แผนโปรโมต → ตัวอย่างคอนเทนต์ → หมวดสินค้าที่ควรขายพร้อมคีย์เวิร์ดค้นหา
        </Card>
      )}
    </>
  );
}

function Bullets({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="list-disc space-y-1 pl-5">
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </div>
  );
}

function PlanView({ plan, plannedAt, canRun }: { plan: ChannelPlan; plannedAt: string | null; canRun: boolean }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const createSource = async (category: string, keyword: string) => {
    setBusy(keyword);
    try {
      await api.post("/scraping/sources", {
        platform: "shopee_affiliate",
        name: `${category} — ${keyword}`.slice(0, 191),
        config: { keyword, sortType: "sales", limit: 50 },
        intervalHours: 24,
      });
      await qc.invalidateQueries({ queryKey: ["trends"] });
      toast.success(`สร้างแหล่งข้อมูล "${keyword}" แล้ว — กดดึงข้อมูลได้ที่หน้าแหล่งข้อมูล`);
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Sparkles className="size-4 text-primary" /> แนวช่องที่ AI แนะนำ
        </CardTitle>
        {plannedAt && (
          <CardDescription>
            {formatDateTime(plannedAt)}
            {plan.provider ? ` · ${plan.provider === "minimax" ? "MiniMax" : "Claude"}` : ""}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">คอนเซ็ปต์</p>
          <p>{plan.concept}</p>
        </div>
        {plan.channelNames.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">ชื่อช่อง</p>
            <div className="flex flex-wrap gap-1.5">
              {plan.channelNames.map((n) => (
                <Badge key={n} tone="primary">
                  {n}
                </Badge>
              ))}
            </div>
          </div>
        )}
        <Bullets title="รูปแบบคอนเทนต์" items={plan.contentFormats} />
        {plan.identity && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">เอกลักษณ์</p>
            <p>{plan.identity}</p>
          </div>
        )}
        <Bullets title="แผนโปรโมต" items={plan.promotionPlan} />
        <Bullets title="ตัวอย่างคอนเทนต์" items={plan.contentExamples} />
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">หมวดสินค้าที่เข้ากับช่อง</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {plan.productCategories.map((c) => (
              <div key={c.category} className="rounded-xl border border-border p-3">
                <p className="flex items-center gap-1.5 font-medium">
                  <Star className="size-3.5 text-primary" /> {c.category}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{c.why}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.keywords.map((k) =>
                    canRun ? (
                      <Button key={k} size="sm" variant="outline" disabled={busy !== null} onClick={() => void createSource(c.category, k)} title="สร้างแหล่งข้อมูล Shopee Affiliate จากคีย์เวิร์ดนี้">
                        {busy === k ? <Loader2 className="animate-spin" /> : <DatabaseZap />} {k}
                      </Button>
                    ) : (
                      <Badge key={k} tone="neutral">
                        {k}
                      </Badge>
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>
          {canRun && plan.productCategories.length > 0 && <p className="mt-2 text-[11px] text-muted-foreground">กดคีย์เวิร์ดเพื่อสร้างแหล่งข้อมูล Shopee Affiliate (เรียงตามยอดขาย ดึงทุก 24 ชม.)</p>}
        </div>
      </CardContent>
    </Card>
  );
}
