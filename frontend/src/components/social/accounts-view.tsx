"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Copy, KeyRound, Loader2, Plug, Unplug } from "lucide-react";
import { toast } from "sonner";
import { api, apiFetch, ApiError } from "@/lib/api";
import type { SocialAccount, SocialAccountsMeta } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from "@/components/ui/primitives";
import { PageHeader } from "@/components/layout/page";
import { SOCIAL } from "./labels";

export const useSocialAccounts = () =>
  useQuery({
    queryKey: ["social", "accounts"],
    queryFn: () => apiFetch<{ data: SocialAccount[]; meta: SocialAccountsMeta }>("/social/accounts"),
  });

export function PlatformChip({ platform, className }: { platform: SocialAccount["platform"]; className?: string }) {
  const p = SOCIAL[platform];
  return <span className={cn("inline-flex h-5 items-center rounded px-1.5 text-[10px] font-bold", p.className, className)}>{p.short}</span>;
}

export function AccountsView() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const accounts = useSocialAccounts();
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const canPublish = can("social:publish");
  const meta = accounts.data?.meta;

  // Result of the OAuth round-trip (?connected=tiktok&count=1 or ?error=...)
  const connected = params.get("connected");
  const error = params.get("error");
  useEffect(() => {
    if (!connected && !error) return;
    if (connected) toast.success(`เชื่อมต่อ ${connected === "meta" ? "Facebook/Instagram" : "TikTok"} แล้ว (${params.get("count") ?? 1} บัญชี)`);
    if (error) toast.error(`เชื่อมต่อไม่สำเร็จ: ${error}`);
    void qc.invalidateQueries({ queryKey: ["social"] });
    router.replace(pathname, { scroll: false });
  }, [connected, error, params, qc, router, pathname]);

  const connect = async (platform: "tiktok" | "meta") => {
    setBusy(platform);
    try {
      const r = await api.get<{ url: string }>(`/social/oauth/${platform}/start`);
      window.location.assign(r.url);
    } catch (err) {
      setBusy(null);
      toast.error(err instanceof ApiError && err.code === "INTEGRATION_NOT_CONFIGURED" ? `ยังไม่ได้ตั้งค่าบนเซิร์ฟเวอร์: ${err.message}` : err instanceof Error ? err.message : "เชื่อมต่อไม่สำเร็จ");
    }
  };
  const disconnect = async (a: SocialAccount) => {
    if (!window.confirm(`ยกเลิกการเชื่อมต่อ ${a.displayName}? โพสต์ที่ตั้งเวลาไว้จะกลับเป็นฉบับร่าง`)) return;
    try {
      await api.del(`/social/accounts/${a.id}`);
      await qc.invalidateQueries({ queryKey: ["social"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ");
    }
  };
  const copy = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="บัญชีโซเชียล" description="เชื่อมบัญชีด้วยการล็อกอินของแพลตฟอร์ม (OAuth) ระบบไม่เก็บรหัสผ่าน และเข้ารหัส token ก่อนบันทึก" />
      {meta && !meta.encryption && (
        <p className="flex gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> ต้องตั้ง APP_ENCRYPTION_KEY บนเซิร์ฟเวอร์ก่อนเชื่อมบัญชี
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {(
          [
            ["tiktok", "TikTok", "โพสต์วิดีโอด้วย Content Posting API (Direct Post) ต้องผ่าน audit ของ TikTok ก่อนจึงโพสต์แบบสาธารณะได้", meta?.tiktok, meta?.callbackUrls.tiktok],
            ["meta", "Facebook + Instagram", "ล็อกอิน Facebook ครั้งเดียว ระบบดึงเพจที่คุณเป็นแอดมินและบัญชี Instagram Business ที่ผูกกับเพจ", meta?.meta, meta?.callbackUrls.meta],
          ] as const
        ).map(([key, title, desc, cfg, callback]) => (
          <Card key={key}>
            <CardHeader>
              <CardTitle>{title}</CardTitle>
              <CardDescription>{desc}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {cfg && !cfg.configured && (
                <p className="flex gap-1.5 text-xs text-warning">
                  <KeyRound className="mt-0.5 size-3.5 shrink-0" /> ต้องตั้งค่าบนเซิร์ฟเวอร์: {cfg.missing.join(", ")}
                </p>
              )}
              {callback && (
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Redirect / Callback URL ที่ต้องลงทะเบียนในแอปของแพลตฟอร์ม</p>
                  <div className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5">
                    <code className="min-w-0 flex-1 truncate text-xs">{callback}</code>
                    <button onClick={() => void copy(callback)} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="คัดลอก URL">
                      {copied === callback ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
                    </button>
                  </div>
                </div>
              )}
              {canPublish && (
                <Button onClick={() => void connect(key)} disabled={busy !== null || !cfg?.configured || !meta?.encryption}>
                  {busy === key ? <Loader2 className="animate-spin" /> : <Plug />} เชื่อมต่อ {title}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>บัญชีที่เชื่อมไว้</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {accounts.isPending ? (
            <Skeleton className="m-4 h-24" />
          ) : !accounts.data?.data.length ? (
            <p className="p-6 text-center text-sm text-muted-foreground">ยังไม่มีบัญชี</p>
          ) : (
            <ul className="divide-y divide-border">
              {accounts.data.data.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <div className="relative">
                    <div className="grid size-10 place-items-center overflow-hidden rounded-full bg-muted">
                      {a.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- platform CDN avatars
                        <img src={a.avatarUrl} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="text-xs font-semibold">{(a.displayName ?? "?").replace("@", "").slice(0, 2)}</span>
                      )}
                    </div>
                    <PlatformChip platform={a.platform} className="absolute -bottom-1 -right-1 h-4 px-1 text-[9px]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{a.displayName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {SOCIAL[a.platform].label}
                      {a.meta?.pageName ? ` · ผูกกับเพจ ${a.meta.pageName}` : ""}
                      {a.scheduledCount ? ` · ตั้งเวลาไว้ ${a.scheduledCount} โพสต์` : ""}
                      {a.platform === "tiktok" && a.tokenExpiresAt && a.status === "connected" ? ` · ต่ออายุ token อัตโนมัติ (${formatDateTime(a.tokenExpiresAt)})` : ""}
                    </p>
                    {a.status !== "connected" && a.lastError && <p className="mt-0.5 text-xs text-warning">{a.lastError}</p>}
                  </div>
                  <Badge tone={a.status === "connected" ? (a.isActive ? "success" : "neutral") : "warning"}>
                    {a.status === "connected" ? (a.isActive ? "เชื่อมต่อแล้ว" : "ปิดใช้งาน") : "ต้องเชื่อมต่อใหม่"}
                  </Badge>
                  {canPublish && a.status === "connected" && (
                    <Button size="sm" variant="ghost" onClick={() => void disconnect(a)} aria-label={`ยกเลิกการเชื่อมต่อ ${a.displayName}`}>
                      <Unplug />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
