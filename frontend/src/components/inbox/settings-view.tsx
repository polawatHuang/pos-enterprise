"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Check, Copy, ExternalLink, KeyRound, Loader2, Plus, Send, Trash2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { api, apiFetch } from "@/lib/api";
import type { AgentProfile, InboxChannelConfig, InboxChannelsMeta, KnowledgeItem, LineConnectResult, Platform } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, NativeSelect, Skeleton, TabBar, Textarea } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { PageHeader } from "@/components/layout/page";
import { KNOWLEDGE_KIND, PLATFORM, PROVIDER_LABEL, TOOL_LABEL } from "./labels";
import { PlatformBadge } from "./inbox-view";

type Tab = "agent" | "knowledge" | "channels" | "simulator";

export function InboxSettingsView() {
  // Back from Facebook Login: /inbox/settings?tab=channels&connected=meta&count=2 (or &error=…)
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const t = params.get("tab");
    return t === "agent" || t === "knowledge" || t === "channels" || t === "simulator" ? t : "simulator";
  });
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const label = { meta: "Facebook / Instagram", shopee: "ร้าน Shopee", tiktok: "ร้าน TikTok Shop" }[q.get("connected") ?? ""] ?? q.get("connected");
    if (q.get("connected")) toast.success(`เชื่อมต่อ ${label} แล้ว ${q.get("count") ?? ""} ช่องทาง`);
    if (q.get("warning")) toast.warning(q.get("warning"), { duration: 15_000 });
    if (q.get("error")) toast.error(q.get("error"), { duration: 15_000 });
    if (q.size) window.history.replaceState(null, "", window.location.pathname);
  }, []);
  return (
    <div>
      <PageHeader title="ตั้งค่า AI แชต" description="กำหนดบุคลิกและกติกาของ AI ฐานความรู้ร้าน ช่องทางแชต และทดลองคุยกับ AI ก่อนเปิดใช้จริง" />
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "simulator", label: "ทดลองคุย" },
          { value: "agent", label: "บุคลิก AI" },
          { value: "knowledge", label: "ฐานความรู้ร้าน" },
          { value: "channels", label: "ช่องทางแชต" },
        ]}
      />
      <div className="mt-6">
        {tab === "agent" && <AgentForm />}
        {tab === "knowledge" && <Knowledge />}
        {tab === "channels" && <Channels />}
        {tab === "simulator" && <Simulator />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ agent */

function AgentForm() {
  const { can } = useAuth();
  const agent = useQuery({ queryKey: ["inbox", "agent"], queryFn: () => api.get<AgentProfile>("/inbox/agent") });
  if (!agent.data) return <Skeleton className="h-96" />;
  return <AgentFormInner key={JSON.stringify(agent.data)} initial={agent.data} editable={can("inbox:manage_ai")} />;
}

function AgentFormInner({ initial, editable }: { initial: AgentProfile; editable: boolean }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ ...initial, maxDiscountPct: String(initial.maxDiscountPct) });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const max = Number(f.maxDiscountPct);
    if (!Number.isFinite(max) || max < 0 || max > 100) return toast.error("เพดานส่วนลดต้องอยู่ระหว่าง 0–100");
    setSaving(true);
    try {
      await api.put("/inbox/agent", {
        name: f.name,
        persona: f.persona || null,
        salesRules: f.salesRules || null,
        maxDiscountPct: max,
        handoffKeywords: f.handoffKeywords || null,
      });
      toast.success("บันทึกการตั้งค่า AI แล้ว");
      await qc.invalidateQueries({ queryKey: ["inbox", "agent"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card>
        <form onSubmit={save}>
          <CardContent className="space-y-4 p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ag-name">ชื่อแอดมิน AI</Label>
                <Input id="ag-name" value={f.name} onChange={set("name")} disabled={!editable} required maxLength={100} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ag-max">เพดานส่วนลดที่ AI ให้ได้เอง (%)</Label>
                <Input id="ag-max" inputMode="decimal" value={f.maxDiscountPct} onChange={set("maxDiscountPct")} disabled={!editable} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ag-persona">บุคลิกและน้ำเสียง</Label>
              <Textarea id="ag-persona" value={f.persona} onChange={set("persona")} disabled={!editable} rows={3} placeholder="เช่น แอดมินผู้หญิง สุภาพ เป็นกันเอง ลงท้ายด้วยค่ะ" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ag-rules">กฎการขายของร้าน</Label>
              <Textarea id="ag-rules" value={f.salesRules} onChange={set("salesRules")} disabled={!editable} rows={4} placeholder="เช่น เสนอส่งฟรีเมื่อยอดใกล้ 500 บาท, ห้ามสัญญาวันส่งของ" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ag-kw">คำที่ต้องส่งต่อให้คนทันที (คั่นด้วยจุลภาค)</Label>
              <Input id="ag-kw" value={f.handoffKeywords} onChange={set("handoffKeywords")} disabled={!editable} placeholder="คุยกับคน,ร้องเรียน,สคบ" />
            </div>
            {editable && (
              <div className="flex justify-end">
                <Button type="submit" disabled={saving}>
                  {saving && <Loader2 className="animate-spin" />} บันทึก
                </Button>
              </div>
            )}
          </CardContent>
        </form>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>ผู้ให้บริการ AI</CardTitle>
          <CardDescription>ตั้งด้วยตัวแปร AI_PROVIDER บนเซิร์ฟเวอร์</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium">{PROVIDER_LABEL[initial.provider] ?? initial.provider}</span>
            <Badge tone={initial.configured ? "success" : "warning"}>{initial.configured ? "พร้อมใช้งาน" : "ยังไม่ได้ใส่ API key"}</Badge>
          </div>
          <p className="text-muted-foreground">
            AI ใช้ข้อมูลสินค้า สต๊อก และออร์เดอร์จริงผ่านเครื่องมือ ส่วนลดเกินเพดานจะถูกส่งให้ผู้จัดการอนุมัติก่อนเสมอ
          </p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {Object.values(TOOL_LABEL).map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <Wrench className="size-3" /> {t}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------- knowledge */

function Knowledge() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const editable = can("inbox:manage_ai");
  const list = useQuery({ queryKey: ["inbox", "knowledge"], queryFn: () => api.get<KnowledgeItem[]>("/inbox/knowledge") });
  const [f, setF] = useState({ kind: "policy", question: "", answer: "" });
  const [saving, setSaving] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/inbox/knowledge", { kind: f.kind, question: f.question || null, answer: f.answer });
      setF({ kind: f.kind, question: "", answer: "" });
      await qc.invalidateQueries({ queryKey: ["inbox", "knowledge"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เพิ่มไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };
  const remove = async (id: number) => {
    if (!window.confirm("ลบข้อมูลนี้?")) return;
    try {
      await api.del(`/inbox/knowledge/${id}`);
      await qc.invalidateQueries({ queryKey: ["inbox", "knowledge"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader>
          <CardTitle>ฐานความรู้ระดับร้าน</CardTitle>
          <CardDescription>นโยบายจัดส่ง การคืนสินค้า การชำระเงิน — AI จะตอบตามนี้เท่านั้น (ข้อมูลรายสินค้าแก้ได้ที่หน้าสินค้า)</CardDescription>
        </CardHeader>
        <CardContent>
          {list.isPending ? (
            <Skeleton className="h-40" />
          ) : !list.data?.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">ยังไม่มีข้อมูล</p>
          ) : (
            <ul className="divide-y divide-border">
              {list.data.map((k) => (
                <li key={k.id} className="flex gap-3 py-3">
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge>{KNOWLEDGE_KIND[k.kind] ?? k.kind}</Badge>
                      {k.question && <span className="font-medium">{k.question}</span>}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{k.answer}</p>
                  </div>
                  {editable && (
                    <button onClick={() => void remove(k.id)} className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-danger-soft hover:text-danger" aria-label="ลบ">
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {editable && (
        <Card className="h-fit">
          <form onSubmit={add}>
            <CardHeader>
              <CardTitle>เพิ่มข้อมูล</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="kn-kind">ประเภท</Label>
                <NativeSelect id="kn-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                  {Object.entries(KNOWLEDGE_KIND).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kn-q">หัวข้อ/คำถาม (ไม่บังคับ)</Label>
                <Input id="kn-q" value={f.question} onChange={(e) => setF({ ...f, question: e.target.value })} maxLength={500} placeholder="เช่น ส่งของกี่วัน" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kn-a">คำตอบ/รายละเอียด</Label>
                <Textarea id="kn-a" value={f.answer} onChange={(e) => setF({ ...f, answer: e.target.value })} required rows={4} maxLength={5000} />
              </div>
              <Button type="submit" className="w-full" disabled={saving || !f.answer.trim()}>
                {saving ? <Loader2 className="animate-spin" /> : <Plus />} เพิ่ม
              </Button>
            </CardContent>
          </form>
        </Card>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- channels */

// Shopee / TikTok Shop chat need partner API access that is not built yet, so they are not offered
const NEW_CHANNEL_PLATFORMS: Platform[] = ["line", "facebook", "instagram", "website"];
const ID_HINT: Partial<Record<Platform, string>> = {
  line: "Bot user ID (ขึ้นต้นด้วย U… ดูได้ใน LINE Developers > Basic settings)",
  facebook: "Page ID ของเพจ",
  instagram: "Instagram account ID (IGSID ของบัญชีธุรกิจ)",
};

function Channels() {
  const { can } = useAuth();
  const editable = can("inbox:manage_ai");
  const res = useQuery({
    queryKey: ["inbox", "channels", "full"],
    queryFn: () => apiFetch<{ data: InboxChannelConfig[]; meta: InboxChannelsMeta }>("/inbox/channels"),
  });
  const list = { isPending: res.isPending, data: res.data?.data };
  const meta = res.data?.meta;
  const [connecting, setConnecting] = useState(false);
  const connectMeta = async () => {
    setConnecting(true);
    try {
      const { url } = await api.get<{ url: string }>("/inbox/oauth/meta/start");
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เริ่มเชื่อมต่อไม่สำเร็จ");
      setConnecting(false);
    }
  };
  const [editing, setEditing] = useState<InboxChannelConfig | "new" | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const qc = useQueryClient();
  const [lineBusy, setLineBusy] = useState(false);
  const [lineResult, setLineResult] = useState<LineConnectResult | null>(null);
  const connectLine = async () => {
    setLineBusy(true);
    try {
      const r = await api.post<LineConnectResult>("/inbox/channels/line/connect");
      setLineResult(r);
      toast.success(`เชื่อมต่อ LINE OA "${r.channel.name}" แล้ว`);
      await qc.invalidateQueries({ queryKey: ["inbox"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เชื่อมต่อ LINE OA ไม่สำเร็จ");
    } finally {
      setLineBusy(false);
    }
  };

  const [shopBusy, setShopBusy] = useState<"shopee" | "tiktok" | null>(null);
  const connectShop = async (platform: "shopee" | "tiktok") => {
    setShopBusy(platform);
    try {
      const { url } = await api.get<{ url: string }>(`/inbox/marketplace/${platform}/start`);
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เริ่มเชื่อมต่อไม่สำเร็จ");
      setShopBusy(null);
    }
  };

  const copy = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          นำ Webhook URL ไปวางใน LINE Developers / Meta App Dashboard แล้วใส่ Channel access token (LINE) หรือ Page access token (Meta) — token ถูกเข้ารหัสก่อนเก็บ
        </p>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void connectMeta()} disabled={connecting || meta?.metaLogin?.configured === false}>
              {connecting ? <Loader2 className="animate-spin" /> : <ExternalLink />} เชื่อมต่อ Facebook Page / Instagram
            </Button>
            <Button variant="outline" onClick={() => void connectLine()} disabled={lineBusy || meta?.line?.configured === false}>
              {lineBusy ? <Loader2 className="animate-spin" /> : <PlatformBadge platform="line" />} เชื่อมต่อ LINE OA
            </Button>
            <Button variant="outline" onClick={() => void connectShop("shopee")} disabled={!!shopBusy || meta?.shopee?.configured === false}>
              {shopBusy === "shopee" ? <Loader2 className="animate-spin" /> : <PlatformBadge platform="shopee" />} เชื่อมต่อร้าน Shopee
            </Button>
            <Button variant="outline" onClick={() => void connectShop("tiktok")} disabled={!!shopBusy || meta?.tiktok?.configured === false}>
              {shopBusy === "tiktok" ? <Loader2 className="animate-spin" /> : <PlatformBadge platform="tiktok" />} เชื่อมต่อร้าน TikTok Shop
            </Button>
            <Button variant="outline" onClick={() => setEditing("new")}>
              <Plus /> เพิ่มเอง (กรอก token)
            </Button>
          </div>
        )}
      </div>
      {meta && <LineSetup meta={meta} result={lineResult} />}
      {meta && <MetaSetup meta={meta} />}
      {meta && <MarketplaceSetup meta={meta} />}
      {list.isPending ? (
        <Skeleton className="h-48" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {list.data?.map((c) => (
            <Card key={c.id} className="min-w-0 p-4">
              <div className="flex items-start gap-3">
                <PlatformBadge platform={c.platform} className="mt-1 h-5 px-1.5 text-[10px]" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{c.name}</p>
                    {!c.isActive && <Badge>ปิดใช้งาน</Badge>}
                    {c.aiEnabled ? (
                      <Badge tone="primary">
                        <Bot className="size-3" /> AI ตอบ
                      </Badge>
                    ) : (
                      <Badge>คนตอบ</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">ID: {c.externalId ?? "—"} · แชตเปิดอยู่ {c.openCount}</p>
                  {c.webhookUrl && (
                    <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5">
                      <code className="min-w-0 flex-1 truncate text-xs">{c.webhookUrl}</code>
                      <button onClick={() => void copy(c.webhookUrl!)} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="คัดลอก Webhook URL">
                        {copied === c.webhookUrl ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
                      </button>
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    {c.platform === "website" ? (
                      <span className="text-muted-foreground">ใช้กับหน้าทดลองคุย/วิดเจ็ตเว็บ ไม่ต้องใช้ token</span>
                    ) : !c.supported ? (
                      <span className="text-warning">รอสิทธิ์ Chat API ของแพลตฟอร์ม (ดู docs/API_KEYS.md)</span>
                    ) : c.hasToken ? (
                      <span className="inline-flex items-center gap-1 text-success">
                        <KeyRound className="size-3.5" /> มี access token แล้ว
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-warning">
                        <KeyRound className="size-3.5" /> ยังไม่มี access token
                      </span>
                    )}
                    {editable && (
                      <Button size="sm" variant="outline" className="ml-auto" onClick={() => setEditing(c)}>
                        แก้ไข
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing !== null && <ChannelDialog key={editing === "new" ? "new" : editing.id} channel={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </div>
  );
}

/**
 * LINE OA: "เชื่อมต่อ LINE OA" reads the OA from the keys on the API connections page, saves the channel
 * and points the LINE webhook here. Two switches exist only in LINE's own console.
 */
function LineSetup({ meta, result }: { meta: InboxChannelsMeta; result: LineConnectResult | null }) {
  const line = meta.line;
  if (!line) return null;
  const ready = line.configured && line.hasToken;
  return (
    <Card className={cn("p-4 text-sm", !ready && "border-warning/50")}>
      <p className="font-medium">LINE OA: กด &quot;เชื่อมต่อ LINE OA&quot; ระบบจะเพิ่มช่องทางและตั้ง Webhook URL ใน LINE ให้เอง</p>
      {!ready && (
        <p className="mt-1 text-warning">
          ตั้ง {line.configured ? "LINE_CHANNEL_ACCESS_TOKEN" : "LINE_CHANNEL_SECRET และ LINE_CHANNEL_ACCESS_TOKEN"} ที่หน้า{" "}
          <a href="/settings/integrations" className="text-primary hover:underline">
            การเชื่อมต่อ API
          </a>{" "}
          ก่อน
        </p>
      )}
      {result && (
        <div className="mt-3 space-y-1 rounded-lg bg-muted p-3">
          <p>
            เชื่อมกับ <b>{result.channel.name}</b> {result.channel.basicId && <span className="text-muted-foreground">({result.channel.basicId})</span>}
          </p>
          <p className="text-xs text-muted-foreground">
            Webhook URL: <code>{result.webhookUrl}</code> —{" "}
            {result.webhookTest?.success ? (
              <span className="text-success">LINE ส่งทดสอบถึงระบบแล้ว ✓</span>
            ) : result.webhookSet ? (
              <span className="text-warning">ตั้งแล้ว แต่ทดสอบไม่ผ่าน</span>
            ) : (
              <span className="text-warning">ยังไม่ได้ตั้ง</span>
            )}
          </p>
          {result.warnings.map((w) => (
            <p key={w} className="text-xs text-warning">
              {w}
            </p>
          ))}
        </div>
      )}
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
        <li>
          ใน LINE Developers → Messaging API เปิด <b>Use webhook</b> (Webhook URL: <code className="rounded bg-muted px-1">{result?.webhookUrl ?? line.webhookUrl}</code>)
        </li>
        <li>
          ใน LINE Official Account Manager → การตอบกลับ ปิด <b>ข้อความตอบกลับอัตโนมัติ</b> เพื่อไม่ให้ตอบซ้ำกับ AI
        </li>
        <li>ลองทักแชต OA จากมือถือ แชตจะขึ้นในหน้า &quot;แชตลูกค้า&quot;</li>
      </ol>
    </Card>
  );
}

/** Shopee / TikTok Shop: what each partner app needs before shop chats can arrive. */
function MarketplaceSetup({ meta }: { meta: InboxChannelsMeta }) {
  const { shopee, tiktok } = meta;
  if (!shopee || !tiktok) return null;
  const code = (v: string) => <code className="break-all rounded bg-muted px-1">{v}</code>;
  const missing = (m: { configured: boolean; missing: string[] }) =>
    m.configured ? (
      <span className="text-success">ตั้ง key แล้ว ✓</span>
    ) : (
      <>
        ตั้ง <b className="text-warning">{m.missing.join(", ")}</b> ที่หน้า{" "}
        <a href="/settings/integrations" className="text-primary hover:underline">
          การเชื่อมต่อ API
        </a>
      </>
    );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className={cn("p-4 text-sm", !shopee.configured && "border-warning/50")}>
        <p className="flex items-center gap-2 font-medium">
          <PlatformBadge platform="shopee" /> Shopee: ตั้งค่าใน Shopee Open Platform ครั้งเดียว
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>{missing(shopee)} (SHOPEE_REDIRECT_URL = {code(shopee.redirectUrl)})</li>
          <li>แอปต้องได้สิทธิ์ SellerChat และตั้ง Redirect URL ของแอปเป็นโดเมนเดียวกัน</li>
          <li>
            Push Mechanism → Live Call Back URL {code(shopee.webhookUrl)} และเปิด push <b>Webchat</b>
          </li>
          <li>กด &quot;เชื่อมต่อร้าน Shopee&quot; แล้วล็อกอินด้วยบัญชีผู้ขาย — ถ้า push ยังไม่ทำงาน ระบบดึงแชตที่ยังไม่อ่านทุก 2 นาทีแทน</li>
        </ol>
      </Card>
      <Card className={cn("p-4 text-sm", !tiktok.configured && "border-warning/50")}>
        <p className="flex items-center gap-2 font-medium">
          <PlatformBadge platform="tiktok" /> TikTok Shop: ตั้งค่าใน Partner Center ครั้งเดียว
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>{missing(tiktok)}</li>
          <li>
            แอปต้องได้ scope <b>Customer Service</b> (seller.customer_service) และตั้ง Redirect URL เป็น {code(tiktok.redirectUrl)}
          </li>
          <li>
            Webhook URL {code(tiktok.webhookUrl)} แล้ว subscribe <b>New conversation</b> และ <b>New message</b>
          </li>
          <li>กด &quot;เชื่อมต่อร้าน TikTok Shop&quot; แล้วอนุญาตด้วยบัญชีผู้ขาย — ทุกร้านที่อนุญาตจะเป็นช่องทางแยกกัน</li>
        </ol>
      </Card>
    </div>
  );
}

/** What the Meta app needs before Messenger / Instagram Direct messages can arrive. */
function MetaSetup({ meta }: { meta: InboxChannelsMeta }) {
  const login = meta.metaLogin;
  const hook = meta.metaWebhook;
  if (!login || !hook) return null;
  const ready = login.configured && hook.configured;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <Card className={cn("p-4 text-sm", !ready && "border-warning/50")}>
      <p className="font-medium">Facebook Page / Instagram: สิ่งที่ต้องตั้งค่าใน Meta App (developers.facebook.com) ครั้งเดียว</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
        <li>
          ตั้งค่า {login.configured ? <span className="text-success">META_APP_ID / META_APP_SECRET / META_REDIRECT_URI ✓</span> : <b className="text-warning">{login.missing.join(", ")}</b>}{" "}
          และ {hook.configured ? <span className="text-success">META_WEBHOOK_VERIFY_TOKEN ✓</span> : <b className="text-warning">{hook.missing.filter((k) => !login.missing.includes(k)).join(", ") || "META_WEBHOOK_VERIFY_TOKEN"}</b>} ที่หน้า{" "}
          <a href="/settings/integrations" className="text-primary hover:underline">
            การเชื่อมต่อ API
          </a>
        </li>
        <li>
          ใน Meta App → App settings → Basic ใส่ Privacy Policy URL <code className="rounded bg-muted px-1">{`${origin}/privacy`}</code> · Terms of Service URL{" "}
          <code className="rounded bg-muted px-1">{`${origin}/terms`}</code> · User data deletion (Data deletion instructions URL){" "}
          <code className="rounded bg-muted px-1">{`${origin}/data-deletion`}</code>
        </li>
        <li>
          ใน Meta App เปิดผลิตภัณฑ์ <b>Messenger</b> และ <b>Instagram</b> → Webhooks: Callback URL <code className="rounded bg-muted px-1">{hook.callbackUrl}</code> · Verify
          token = ค่า META_WEBHOOK_VERIFY_TOKEN · subscribe field <code className="rounded bg-muted px-1">messages</code>
        </li>
        <li>กด &quot;เชื่อมต่อ Facebook Page / Instagram&quot; แล้วเลือกเพจ ระบบสร้างช่องทาง ใส่ token และเปิดรับข้อความของเพจให้อัตโนมัติ</li>
        <li>สิทธิ์ pages_messaging และ instagram_manage_messages ใช้ได้ทันทีกับแอดมินของแอป ถ้าจะให้คนอื่นใช้ต้องผ่าน App Review ของ Meta</li>
      </ol>
    </Card>
  );
}

function ChannelDialog({ channel, onDone }: { channel: InboxChannelConfig | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    platform: (channel?.platform ?? "line") as Platform,
    name: channel?.name ?? "",
    externalId: channel?.externalId ?? "",
    aiEnabled: channel?.aiEnabled ?? true,
    isActive: channel?.isActive ?? true,
    accessToken: "",
  });
  const [saving, setSaving] = useState(false);
  const needsToken = ["line", "facebook", "instagram"].includes(f.platform);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const body = { ...f, accessToken: f.accessToken.trim() || undefined };
    try {
      if (channel) await api.patch(`/inbox/channels/${channel.id}`, body);
      else await api.post("/inbox/channels", body);
      toast.success("บันทึกช่องทางแล้ว");
      await qc.invalidateQueries({ queryKey: ["inbox", "channels"] });
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent title={channel ? `แก้ไข ${channel.name}` : "เพิ่มช่องทางแชต"}>
      <form onSubmit={save} className="space-y-4">
        {!channel && (
          <div className="space-y-1.5">
            <Label htmlFor="ch-platform">แพลตฟอร์ม</Label>
            <NativeSelect id="ch-platform" value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value as Platform })}>
              {NEW_CHANNEL_PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {PLATFORM[p].label}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="ch-name">ชื่อที่แสดง</Label>
          <Input id="ch-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={191} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ch-ext">ID ของเพจ/บัญชี</Label>
          <Input id="ch-ext" value={f.externalId} onChange={(e) => setF({ ...f, externalId: e.target.value })} required maxLength={191} />
          {ID_HINT[f.platform] && <p className="text-xs text-muted-foreground">{ID_HINT[f.platform]}</p>}
        </div>
        {needsToken && (
          <div className="space-y-1.5">
            <Label htmlFor="ch-token">{f.platform === "line" ? "Channel access token" : "Page access token"}</Label>
            <Input
              id="ch-token"
              type="password"
              autoComplete="off"
              value={f.accessToken}
              onChange={(e) => setF({ ...f, accessToken: e.target.value })}
              placeholder={channel?.hasToken ? "มีแล้ว — เว้นว่างถ้าไม่เปลี่ยน" : "วาง token ที่นี่"}
            />
          </div>
        )}
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.aiEnabled} onChange={(e) => setF({ ...f, aiEnabled: e.target.checked })} className="size-4 accent-primary" />
            ให้ AI ตอบแชตใหม่อัตโนมัติ
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} className="size-4 accent-primary" />
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

/* -------------------------------------------------------------- simulator */

interface SimLine {
  role: "customer" | "ai" | "note";
  text: string;
  tools?: string[];
}
interface SimResult {
  conversationId: number;
  threadId: string;
  status: string;
  reply?: string;
  tools?: string[];
  error?: string;
}
const SIM_STATUS: Record<string, string> = {
  handoff: "AI ส่งต่อให้แอดมินแล้ว (โหมดคนตอบ)",
  not_configured: "ยังไม่ได้ตั้งค่า API key ของ AI — แชตถูกส่งให้แอดมิน",
  ai_off: "แชตนี้อยู่ในโหมดคนตอบ AI จะไม่ตอบ (เริ่มแชตใหม่เพื่อทดสอบต่อ)",
  busy: "AI กำลังตอบข้อความก่อนหน้า",
  already_answered: "ข้อความนี้ถูกตอบแล้ว",
};

function Simulator() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [lines, setLines] = useState<SimLine[]>([]);
  const [thread, setThread] = useState<{ id: string; conv: number } | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  if (!can("inbox:manage_ai")) return <p className="text-sm text-muted-foreground">ต้องมีสิทธิ์ตั้งค่า AI (inbox:manage_ai) เพื่อใช้หน้าทดลองคุย</p>;

  const push = (l: SimLine) => {
    setLines((p) => [...p, l]);
    setTimeout(() => endRef.current?.scrollIntoView({ block: "end" }), 30);
  };
  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const msg = text.trim();
    if (!msg || sending) return;
    setText("");
    push({ role: "customer", text: msg });
    setSending(true);
    try {
      const r = await api.post<SimResult>("/inbox/simulate", { text: msg, threadId: thread?.id });
      setThread({ id: r.threadId, conv: r.conversationId });
      if (r.reply) push({ role: "ai", text: r.reply, tools: r.tools });
      if (r.status === "error") push({ role: "note", text: `AI ตอบไม่สำเร็จ: ${r.error}` });
      else if (SIM_STATUS[r.status]) push({ role: "note", text: SIM_STATUS[r.status] });
      void qc.invalidateQueries({ queryKey: ["inbox"] });
    } catch (err) {
      push({ role: "note", text: err instanceof Error ? err.message : "ส่งไม่สำเร็จ" });
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="mx-auto flex h-[min(70dvh,640px)] max-w-2xl flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Bot className="size-5 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">คุยกับ AI ในฐานะลูกค้า</p>
          <p className="text-xs text-muted-foreground">ใช้ข้อมูลสินค้าจริงและบันทึกเป็นแชตช่องทาง “แชตทดสอบ” ใน Inbox</p>
        </div>
        {thread && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setThread(null);
              setLines([]);
            }}
          >
            เริ่มแชตใหม่
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-muted/20 p-4">
        {!lines.length && (
          <div className="space-y-2 pt-8 text-center text-sm text-muted-foreground">
            <p>ลองพิมพ์ เช่น</p>
            {["มีเสื้อผ้าคอตตอนไหมคะ", "ซื้อ 3 ชิ้นลดได้ไหม", "ได้ของมาชำรุดค่ะ ขอเปลี่ยน"].map((s) => (
              <button key={s} onClick={() => setText(s)} className="mx-1 rounded-full border border-border bg-card px-3 py-1 text-xs hover:bg-accent">
                {s}
              </button>
            ))}
          </div>
        )}
        {lines.map((l, i) =>
          l.role === "note" ? (
            <p key={i} className="text-center text-xs text-muted-foreground">
              {l.text}
            </p>
          ) : (
            <div key={i} className={cn("flex", l.role === "customer" ? "justify-end" : "justify-start")}>
              <div className="max-w-[85%]">
                <div
                  className={cn(
                    "whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm",
                    l.role === "customer" ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md border border-border bg-card",
                  )}
                >
                  {l.text}
                </div>
                {l.tools?.length ? (
                  <p className="mt-1 flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
                    <Wrench className="size-3" /> {[...new Set(l.tools)].map((t) => TOOL_LABEL[t] ?? t).join(", ")}
                  </p>
                ) : null}
              </div>
            </div>
          ),
        )}
        {sending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> AI กำลังพิมพ์…
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form onSubmit={send} className="flex gap-2 border-t border-border p-3">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="พิมพ์ข้อความในฐานะลูกค้า" aria-label="ข้อความทดสอบ" maxLength={2000} />
        <Button type="submit" disabled={sending || !text.trim()} aria-label="ส่ง">
          <Send />
        </Button>
      </form>
    </Card>
  );
}
