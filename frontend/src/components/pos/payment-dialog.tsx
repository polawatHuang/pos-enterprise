"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Banknote, CreditCard, Landmark, Loader2, QrCode } from "lucide-react";
import { api } from "@/lib/api";
import type { PaymentMethod, PosSettings } from "@/lib/types";
import { cn, formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";

const METHODS: { value: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { value: "cash", label: "เงินสด", icon: Banknote },
  { value: "promptpay", label: "PromptPay", icon: QrCode },
  { value: "card", label: "บัตร", icon: CreditCard },
  { value: "transfer", label: "โอนเงิน", icon: Landmark },
];

/** Quick-tender buttons: exact amount, then the next round banknote amounts. */
function quickAmounts(total: number) {
  const out = new Set<number>([Math.ceil(total)]);
  for (const step of [20, 100, 500, 1000]) out.add(Math.ceil(total / step) * step);
  return [...out].filter((v) => v >= total).sort((a, b) => a - b).slice(0, 4);
}

export interface PaymentInput {
  method: PaymentMethod;
  amountReceived?: number;
  reference?: string;
}

export function PaymentDialog({
  total,
  settings,
  busy,
  onConfirm,
}: {
  total: number;
  settings?: PosSettings;
  busy: boolean;
  onConfirm: (p: PaymentInput) => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [received, setReceived] = useState(String(Math.ceil(total)));
  const [reference, setReference] = useState("");
  const receivedNum = Number(received) || 0;
  const change = receivedNum - total;
  const canPay = method !== "cash" || change >= -0.001;

  const submit = () => {
    if (!canPay || busy) return;
    onConfirm({ method, amountReceived: method === "cash" ? receivedNum : undefined, reference: reference || undefined });
  };

  return (
    <DialogContent title="ชำระเงิน" className="max-w-xl">
      <div className="rounded-xl bg-primary-soft p-4 text-center">
        <p className="text-sm text-primary">ยอดที่ต้องชำระ</p>
        <p className="text-4xl font-semibold tracking-tight text-primary">{formatMoney(total)}</p>
      </div>
      <div role="radiogroup" aria-label="วิธีชำระเงิน" className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {METHODS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            role="radio"
            aria-checked={method === value}
            onClick={() => setMethod(value)}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-xl border p-3 text-sm font-medium transition-colors",
              method === value ? "border-primary bg-primary-soft text-primary" : "border-border hover:bg-accent",
            )}
          >
            <Icon className="size-5" />
            {label}
          </button>
        ))}
      </div>

      <form
        className="mt-5 grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {method === "cash" && (
          <>
            <div className="space-y-2">
              <Label htmlFor="received">รับเงินมา</Label>
              <Input
                id="received"
                inputMode="decimal"
                className="h-12 text-lg"
                value={received}
                onChange={(e) => setReceived(e.target.value)}
                onFocus={(e) => e.target.select()}
                autoFocus
              />
              <div className="flex flex-wrap gap-2">
                {quickAmounts(total).map((v) => (
                  <Button key={v} type="button" variant="outline" size="sm" onClick={() => setReceived(String(v))}>
                    {formatMoney(v)}
                  </Button>
                ))}
              </div>
            </div>
            <div className={cn("flex items-center justify-between rounded-xl p-4", change >= 0 ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
              <span className="font-medium">{change >= 0 ? "เงินทอน" : "ยังขาด"}</span>
              <span className="text-2xl font-semibold">{formatMoney(Math.abs(change))}</span>
            </div>
          </>
        )}
        {method === "promptpay" && <PromptPayQr total={total} enabled={!!settings?.promptpayEnabled} />}
        {(method === "card" || method === "transfer" || method === "promptpay") && (
          <div className="space-y-2">
            <Label htmlFor="ref">เลขอ้างอิง (ไม่บังคับ)</Label>
            <Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="เลข approval / 4 หลักท้ายบัตร / เลขสลิป" />
          </div>
        )}
        <Button type="submit" size="lg" className="h-12 text-base" disabled={!canPay || busy}>
          {busy && <Loader2 className="animate-spin" />}
          {method === "cash" ? "รับเงินและพิมพ์ใบเสร็จ" : "ยืนยันได้รับชำระแล้ว"}
        </Button>
      </form>
    </DialogContent>
  );
}

function PromptPayQr({ total, enabled }: { total: number; enabled: boolean }) {
  const [svg, setSvg] = useState<string | null>(null);
  const payload = useQuery({
    queryKey: ["pos", "promptpay", total],
    queryFn: () => api.get<{ payload: string }>("/pos/promptpay", { amount: total }),
    enabled,
  });
  useEffect(() => {
    if (!payload.data) return;
    let alive = true;
    void QRCode.toString(payload.data.payload, { type: "svg", margin: 1, width: 220, errorCorrectionLevel: "M" }).then((s) => {
      if (alive) setSvg(s);
    });
    return () => {
      alive = false;
    };
  }, [payload.data]);

  if (!enabled) {
    return (
      <p className="rounded-lg bg-warning-soft p-3 text-sm text-warning">
        ยังไม่ได้ตั้งค่าหมายเลข PromptPay ของร้าน (ผู้จัดการตั้งได้ที่ปุ่ม &quot;ตั้งค่า POS&quot;) — ยังรับโอนได้ แต่ไม่มี QR
      </p>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-border p-4">
      <div className="grid size-[220px] place-items-center rounded-lg bg-white">
        {svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <Loader2 className="size-6 animate-spin text-muted-foreground" />}
      </div>
      <p className="text-sm text-muted-foreground">ให้ลูกค้าสแกนด้วยแอปธนาคาร · ยอด {formatMoney(total)}</p>
      <p className="text-xs text-muted-foreground">ตรวจสลิปหรือแจ้งเตือนเงินเข้าก่อนกดยืนยัน</p>
    </div>
  );
}
