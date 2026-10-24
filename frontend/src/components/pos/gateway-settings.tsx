"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, PlugZap } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { PaymentGatewayAdmin } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge, Input, Label, NativeSelect } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";
import { POS_SETTINGS_KEY } from "./settings-dialog";

const KEY = ["pos", "payment-gateway"] as const;

/** Manager: connect a payment provider so PromptPay bills close themselves when the money arrives. */
export function GatewayDialog({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: () => api.get<PaymentGatewayAdmin>("/pos/payment-gateway") });
  if (q.isPending)
    return (
      <DialogContent title="รับชำระ PromptPay อัตโนมัติ">
        <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
      </DialogContent>
    );
  if (q.isError || !q.data)
    return (
      <DialogContent title="รับชำระ PromptPay อัตโนมัติ">
        <p className="text-sm text-danger">{q.error instanceof Error ? q.error.message : "โหลดไม่สำเร็จ"}</p>
      </DialogContent>
    );
  return (
    <Form
      key={q.data.provider ?? "none"}
      view={q.data}
      onSaved={() => {
        void qc.invalidateQueries({ queryKey: KEY });
        void qc.invalidateQueries({ queryKey: POS_SETTINGS_KEY });
      }}
      onDone={onDone}
    />
  );
}

function Form({ view, onSaved, onDone }: { view: PaymentGatewayAdmin; onSaved: () => void; onDone: () => void }) {
  const [provider, setProvider] = useState(view.provider ?? view.providers[0]?.id ?? "");
  const [enabled, setEnabled] = useState(view.enabled);
  // typed keys only (blank = keep the saved one); switches start from what is saved
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [flags, setFlags] = useState<Record<string, boolean>>(view.flags ?? {});
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [copied, setCopied] = useState(false);
  const p = view.providers.find((x) => x.id === provider);
  const sameProvider = provider === view.provider;
  const webhook = sameProvider && view.webhookKey ? `${window.location.origin}/api/public/payments/${provider}/${view.webhookKey}` : null;

  const save = async (then?: () => Promise<void>) => {
    setBusy("save");
    try {
      const switches = Object.fromEntries((p?.fields ?? []).filter((f) => f.type === "boolean").map((f) => [f.key, flags[f.key] ? "1" : ""]));
      const credentials = { ...keys, ...switches };
      await api.put("/pos/payment-gateway", { provider, enabled, credentials: Object.keys(credentials).length ? credentials : undefined });
      setKeys({});
      toast.success("บันทึกการตั้งค่าแล้ว");
      onSaved();
      await then?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };
  const test = async () => {
    setBusy("test");
    try {
      const r = await api.post<{ ok: boolean; account?: string }>("/pos/payment-gateway/test");
      toast.success(r.account ? `เชื่อมต่อสำเร็จ (บัญชี ${r.account})` : "เชื่อมต่อสำเร็จ");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เชื่อมต่อไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(webhook!);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("คัดลอกไม่สำเร็จ — เลือกข้อความแล้วคัดลอกเอง");
    }
  };

  return (
    <DialogContent title="รับชำระ PromptPay อัตโนมัติ" description="ลูกค้าสแกน QR จ่ายแล้วบิลปิดเอง ไม่ต้องดูสลิปหรือแอปธนาคาร" className="max-w-lg">
      <div className="grid gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="gw-provider">ผู้ให้บริการชำระเงิน</Label>
          <NativeSelect id="gw-provider" className="h-10 w-full" value={provider} onChange={(e) => setProvider(e.target.value)}>
            {view.providers.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">ร้านต้องสมัครกับผู้ให้บริการเองและขอเปิด PromptPay (มีค่าธรรมเนียมต่อรายการ) แล้วนำคีย์มาใส่ที่นี่</p>
        </div>

        {p?.fields.map((f) =>
          f.type === "boolean" ? (
            <label key={f.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-5" checked={Boolean(flags[f.key])} onChange={(e) => setFlags({ ...flags, [f.key]: e.target.checked })} />
              {f.label}
            </label>
          ) : (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={`gw-${f.key}`}>{f.label}</Label>
              <Input
                id={`gw-${f.key}`}
                type={f.secret ? "password" : "text"}
                autoComplete="off"
                value={keys[f.key] ?? ""}
                onChange={(e) => setKeys({ ...keys, [f.key]: e.target.value })}
                placeholder={sameProvider && view.hasKey ? "บันทึกไว้แล้ว — เว้นว่างถ้าไม่เปลี่ยน" : ""}
              />
            </div>
          ),
        )}
        {sameProvider && view.hasKey && view.mode && (
          <p className="text-sm">
            โหมด: <Badge tone={view.mode === "live" ? "success" : "warning"}>{view.mode === "live" ? "ใช้งานจริง" : "ทดสอบ (ไม่มีเงินจริง)"}</Badge>
          </p>
        )}

        {webhook ? (
          <div className="space-y-1.5">
            <Label htmlFor="gw-webhook">URL แจ้งเงินเข้า (Webhook)</Label>
            {p?.webhookHint && <p className="text-xs text-muted-foreground">{p.webhookHint}</p>}
            <div className="flex gap-2">
              <Input id="gw-webhook" readOnly value={webhook} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              <Button type="button" variant="outline" className="h-10 shrink-0" onClick={() => void copy()} aria-label="คัดลอก URL">
                {copied ? <Check /> : <Copy />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              ลิงก์นี้เป็นความลับของร้าน อย่าแชร์ — ถ้าไม่ได้ตั้ง Webhook ระบบจะตรวจสถานะจากผู้ให้บริการเองทุก 2–3 วินาทีอยู่แล้ว
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">บันทึกคีย์แล้วจะได้ URL สำหรับตั้ง Webhook</p>
        )}

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-5" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>
            เปิดใช้ที่หน้าขาย
            <span className="block text-xs text-muted-foreground">
              ปิดไว้ = ใช้ QR PromptPay ธรรมดาและตรวจสลิปเหมือนเดิม · ก่อนเปิดจริงลองขายยอดเล็กๆ (เช่น ฿20) ด้วยโหมดทดสอบ
            </span>
          </span>
        </label>

        <div className="flex flex-wrap gap-2">
          <Button disabled={!!busy} onClick={() => void save()}>
            {busy === "save" && <Loader2 className="animate-spin" />} บันทึก
          </Button>
          <Button variant="outline" disabled={!!busy || !sameProvider || !view.hasKey} onClick={() => void test()}>
            {busy === "test" ? <Loader2 className="animate-spin" /> : <PlugZap />} ทดสอบการเชื่อมต่อ
          </Button>
          <Button variant="ghost" onClick={onDone}>
            ปิด
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}
