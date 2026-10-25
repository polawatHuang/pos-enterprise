"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { DataRequestKind } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/primitives";

const KINDS: { value: DataRequestKind; label: string }[] = [
  { value: "delete", label: "ลบข้อมูลของฉัน" },
  { value: "access", label: "ขอสำเนาข้อมูลของฉัน" },
  { value: "correct", label: "แก้ไขข้อมูลให้ถูกต้อง" },
  { value: "object", label: "คัดค้าน / ระงับการใช้ข้อมูล" },
  { value: "withdraw", label: "ถอนความยินยอม (เช่น ไม่รับข่าวสาร)" },
];
const PLATFORMS = [
  { value: "facebook", label: "Facebook Messenger" },
  { value: "instagram", label: "Instagram" },
  { value: "line", label: "LINE" },
  { value: "tiktok", label: "TikTok" },
  { value: "shop", label: "ซื้อที่หน้าร้าน / ใบเสร็จ" },
  { value: "other", label: "อื่น ๆ" },
];

/** Public form: a data-subject request (PDPA) → a reference number; the shop answers within 30 days. */
export function DataRequestForm() {
  const [f, setF] = useState({ kind: "delete" as DataRequestKind, name: "", contact: "", platform: "facebook", detail: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ ref: string; answerDays: number } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setDone(await api.post<{ ref: string; answerDays: number }>("/public/legal/data-requests", f));
    } catch (err) {
      setError(err instanceof Error ? err.message : "ส่งคำขอไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div role="status" className="space-y-1 rounded-xl border border-success/40 bg-success-soft p-4 text-sm">
        <p className="flex items-center gap-2 font-medium text-success">
          <CheckCircle2 className="size-5" /> ได้รับคำขอแล้ว
        </p>
        <p>
          เลขอ้างอิง <b className="font-mono">{done.ref}</b> — โปรดเก็บไว้ เราจะติดต่อกลับทาง {f.contact} และแจ้งผลภายใน {done.answerDays} วัน
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="dr-kind">ต้องการ</Label>
        <NativeSelect id="dr-kind" className="w-full" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as DataRequestKind })}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="dr-name">ชื่อ (หรือชื่อโปรไฟล์ที่ใช้ทักแชต)</Label>
        <Input id="dr-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={191} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="dr-contact">อีเมลหรือเบอร์โทรที่ติดต่อกลับได้</Label>
        <Input id="dr-contact" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} required minLength={5} maxLength={191} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="dr-platform">ช่องทางที่เคยติดต่อร้าน</Label>
        <NativeSelect id="dr-platform" className="w-full" value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>
          {PLATFORMS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="dr-detail">รายละเอียดเพิ่มเติม (ไม่บังคับ)</Label>
        <Textarea
          id="dr-detail"
          value={f.detail}
          onChange={(e) => setF({ ...f, detail: e.target.value })}
          rows={3}
          maxLength={2000}
          placeholder="เช่น ช่วงเวลาที่ทักแชต เลขที่ใบเสร็จ หรือข้อมูลที่ต้องการให้แก้"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger sm:col-span-2">
          {error}
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} ส่งคำขอ
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">ข้อมูลในแบบฟอร์มนี้ใช้เพื่อดำเนินการตามคำขอและติดต่อกลับเท่านั้น</p>
      </div>
    </form>
  );
}
