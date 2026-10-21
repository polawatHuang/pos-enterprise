"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Banknote, CheckCircle2, CreditCard, Landmark, Loader2, QrCode, ScanLine, ShieldAlert, Wallet, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { base64Of, downscaleToDataUrl } from "@/lib/image";
import type { PaymentMethod, PosSettings, SlipCheck } from "@/lib/types";
import { cn, formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";
import { r2 } from "./cart";

const METHODS: { value: PaymentMethod; label: string; icon: typeof Banknote; key: string }[] = [
  { value: "cash", label: "เงินสด", icon: Banknote, key: "F8" },
  { value: "promptpay", label: "PromptPay", icon: QrCode, key: "F9" },
  { value: "card", label: "บัตร", icon: CreditCard, key: "" },
  { value: "transfer", label: "โอนเงิน", icon: Landmark, key: "" },
  { value: "ewallet", label: "e-Wallet", icon: Wallet, key: "" },
];
export const METHOD_NAME: Record<string, string> = Object.fromEntries(METHODS.map((m) => [m.value, m.label]));
const NOTES = [1000, 500, 100, 50, 20];

export interface Tender {
  method: PaymentMethod;
  amount: number;
  reference?: string;
  slipRef?: string;
}

export interface PaymentResult {
  payments: Tender[];
  ageConfirmed: boolean;
}

/** Slip photos are re-encoded to a 1600px JPEG: phone photos are often 5–10 MB. */
async function slipToBase64(file: File): Promise<string> {
  return base64Of(await downscaleToDataUrl(file, { maxSide: 1600, quality: 0.85 }));
}

export function PaymentDialog({
  total,
  settings,
  busy,
  initialMethod = "cash",
  needsAge,
  ageConfirmedByCustomer,
  onQr,
  onConfirm,
}: {
  total: number;
  settings?: PosSettings;
  busy: boolean;
  initialMethod?: PaymentMethod;
  needsAge: boolean;
  ageConfirmedByCustomer: boolean;
  onQr: (payload: string | null, method: PaymentMethod, amount: number) => void;
  onConfirm: (p: PaymentResult) => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>(initialMethod);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [received, setReceived] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [slip, setSlip] = useState<SlipCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [ageChecked, setAgeChecked] = useState(false);
  const receivedRef = useRef<HTMLInputElement>(null);
  /** Quick-tender taps keep focus in the amount box so Enter completes the sale. */
  const tap = (fn: () => void) => {
    fn();
    receivedRef.current?.focus();
  };

  const paid = r2(tenders.reduce((s, t) => s + t.amount, 0));
  const remaining = r2(total - paid);
  const cashNum = Number(received) || 0;
  const change = r2(cashNum - remaining);
  const ageOk = !needsAge || ageChecked || ageConfirmedByCustomer;
  const amountNum = amount === "" ? remaining : Number(amount) || 0;

  const pick = (m: PaymentMethod) => {
    setMethod(m);
    setAmount("");
    setReference("");
    setSlip(null);
    if (m !== "promptpay") onQr(null, m, remaining);
  };

  const finish = (extra: Tender[] = []) => {
    if (busy || !ageOk) return;
    const all = [...tenders, ...extra];
    const left = r2(total - all.reduce((s, t) => s + t.amount, 0));
    // An empty "received" box means the customer paid the exact amount
    const cashGiven = received === "" ? left : cashNum;
    if (left > 0.001 && cashGiven + 1e-9 < left) return;
    onConfirm({ payments: left > 0.001 ? [...all, { method: "cash", amount: cashGiven }] : all, ageConfirmed: needsAge ? ageOk : false });
  };

  /** Adds an electronic tender; when it settles the bill the sale completes right away. */
  const addTender = () => {
    if (amountNum <= 0) return;
    if (amountNum > remaining + 0.001) {
      toast.error("ยอดเกินที่ต้องชำระ");
      return;
    }
    const t: Tender = { method, amount: r2(amountNum), reference: reference || undefined, slipRef: slip?.ok ? (slip.transRef ?? undefined) : undefined };
    if (Math.abs(amountNum - remaining) < 0.001) {
      finish([t]);
      return;
    }
    setTenders((x) => [...x, t]);
    setAmount("");
    setReference("");
    setSlip(null);
    setMethod("cash");
    onQr(null, "cash", r2(remaining - t.amount));
  };

  const verifySlip = async (file: File | undefined) => {
    if (!file) return;
    setChecking(true);
    try {
      const data = await slipToBase64(file);
      const r = await api.post<SlipCheck>("/pos/slip/verify", { mediaType: "image/jpeg", data, amount: amountNum });
      setSlip(r);
      if (r.transRef) setReference(r.transRef);
      if (r.ok) toast.success("สลิปถูกต้อง");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ตรวจสลิปไม่สำเร็จ");
    } finally {
      setChecking(false);
    }
  };

  return (
    <DialogContent title="ชำระเงิน" className="max-w-2xl">
      <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
        <div className="rounded-2xl bg-primary p-4 text-primary-foreground">
          <p className="text-sm opacity-80">{tenders.length ? "คงเหลือต้องชำระ" : "ยอดที่ต้องชำระ"}</p>
          <p className="text-5xl font-semibold tracking-tight tabular-nums" data-testid="pay-remaining">
            {formatMoney(remaining)}
          </p>
          {tenders.length > 0 && <p className="mt-1 text-xs opacity-80">จากยอดบิล {formatMoney(total)}</p>}
        </div>
        <ul className="space-y-1.5 text-sm">
          {tenders.map((t, i) => (
            <li key={i} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
              <span className="flex-1">{METHOD_NAME[t.method]}</span>
              <span className="font-medium tabular-nums">{formatMoney(t.amount)}</span>
              <button aria-label="เอาออก" onClick={() => setTenders((x) => x.filter((_, j) => j !== i))}>
                <X className="size-3.5 text-muted-foreground" />
              </button>
            </li>
          ))}
          {!tenders.length && <li className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">แบ่งจ่ายได้: เลือกวิธีอื่นแล้วใส่ยอดบางส่วน ส่วนที่เหลือรับเป็นเงินสด</li>}
        </ul>
      </div>

      {needsAge && (
        <label className={cn("mt-3 flex items-center gap-2 rounded-xl p-3 text-sm", ageOk ? "bg-success-soft text-success" : "bg-warning-soft text-warning")}>
          {ageOk ? <CheckCircle2 className="size-4" /> : <ShieldAlert className="size-4" />}
          <span className="flex-1">{ageConfirmedByCustomer ? "ลูกค้ายืนยันอายุ 20 ปีขึ้นไปที่จอลูกค้าแล้ว" : "มีสินค้าจำกัดอายุ — ตรวจบัตรประชาชนลูกค้า"}</span>
          {!ageConfirmedByCustomer && (
            <>
              <input type="checkbox" checked={ageChecked} onChange={(e) => setAgeChecked(e.target.checked)} className="size-4 accent-current" aria-label="ยืนยันอายุ 20 ปีขึ้นไป" />
              <span>อายุ 20+</span>
            </>
          )}
        </label>
      )}

      <div role="radiogroup" aria-label="วิธีชำระเงิน" className="mt-4 grid grid-cols-5 gap-1.5">
        {METHODS.map(({ value, label, icon: Icon, key }) => (
          <button
            key={value}
            role="radio"
            aria-checked={method === value}
            onClick={() => pick(value)}
            className={cn(
              "relative flex flex-col items-center gap-1 rounded-xl border px-1 py-2.5 text-xs font-medium transition-colors sm:text-sm",
              method === value ? "border-primary bg-primary-soft text-primary" : "border-border hover:bg-accent",
            )}
          >
            <Icon className="size-5" />
            {label}
            {key && <kbd className="absolute right-1 top-1 hidden rounded bg-muted px-1 text-[9px] text-muted-foreground sm:block">{key}</kbd>}
          </button>
        ))}
      </div>

      {method === "cash" ? (
        <form
          className="mt-4 grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            finish();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="received">รับเงินมา</Label>
            <Input
              id="received"
              ref={receivedRef}
              inputMode="decimal"
              className="h-14 text-2xl font-semibold tabular-nums"
              value={received}
              placeholder={formatMoney(remaining)}
              onChange={(e) => setReceived(e.target.value)}
              autoFocus
            />
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              <Button type="button" variant="secondary" onClick={() => tap(() => setReceived(String(remaining)))}>
                พอดี
              </Button>
              {NOTES.map((v) => (
                <Button key={v} type="button" variant="outline" onClick={() => tap(() => setReceived((r) => String(r2((Number(r) || 0) + v))))} className="tabular-nums">
                  +{v.toLocaleString("th-TH")}
                </Button>
              ))}
            </div>
            {received && (
              <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => tap(() => setReceived(""))}>
                ล้างจำนวนเงิน
              </button>
            )}
          </div>
          <div className={cn("flex items-center justify-between rounded-xl p-4", received === "" || change >= 0 ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
            <span className="font-medium">{received === "" || change >= 0 ? "เงินทอน" : "ยังขาด"}</span>
            <span className="text-3xl font-semibold tabular-nums" data-testid="pay-change">
              {formatMoney(received === "" ? 0 : Math.abs(change))}
            </span>
          </div>
          <Button type="submit" size="lg" className="h-14 text-lg" disabled={busy || !ageOk || (received !== "" && change < -0.001)}>
            {busy && <Loader2 className="animate-spin" />}
            {received === "" ? "รับเงินพอดี" : "รับเงิน"} · Enter
          </Button>
        </form>
      ) : (
        <form
          className="mt-4 grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            addTender();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tender-amount">ยอด{METHOD_NAME[method]}</Label>
              <Input
                id="tender-amount"
                inputMode="decimal"
                className="h-12 text-lg tabular-nums"
                value={amount}
                placeholder={String(remaining)}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setSlip(null);
                }}
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground">ใส่น้อยกว่ายอดเพื่อแบ่งจ่าย ส่วนที่เหลือรับวิธีอื่น</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ref">เลขอ้างอิง (ไม่บังคับ)</Label>
              <Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="approval / 4 หลักท้ายบัตร / เลขสลิป" />
            </div>
          </div>
          {method === "promptpay" && <PromptPayQr amount={amountNum} enabled={!!settings?.promptpayEnabled} onPayload={(p) => onQr(p, "promptpay", amountNum)} />}
          {method === "transfer" && settings?.bankAccount && <BankCard account={settings.bankAccount} />}
          {(method === "promptpay" || method === "transfer") && (
            <div className="rounded-xl border border-border p-3">
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-muted px-3 py-2.5 text-sm font-medium hover:bg-accent">
                {checking ? <Loader2 className="size-4 animate-spin" /> : <ScanLine className="size-4" />}
                {checking ? "AI กำลังตรวจสลิป..." : "ถ่าย/อัปโหลดสลิปให้ AI ตรวจ"}
                <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={checking} onChange={(e) => void verifySlip(e.target.files?.[0])} />
              </label>
              {slip && <SlipResult slip={slip} />}
            </div>
          )}
          <Button type="submit" size="lg" className="h-12 text-base" disabled={busy || amountNum <= 0 || !ageOk || (slip !== null && !slip.ok)}>
            {busy && <Loader2 className="animate-spin" />}
            {Math.abs(amountNum - remaining) < 0.001 ? `ได้รับ${METHOD_NAME[method]}แล้ว · จบการขาย` : `เพิ่ม${METHOD_NAME[method]} ${formatMoney(amountNum)}`}
          </Button>
        </form>
      )}
    </DialogContent>
  );
}

function BankCard({ account }: { account: NonNullable<PosSettings["bankAccount"]> }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-success/40 bg-success-soft/40 p-3" data-testid="bank-card">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-success text-white">
        <Landmark className="size-5" />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">
          {account.bank} · {account.type}
        </p>
        <p className="text-xl font-semibold tracking-wide tabular-nums">{account.display ?? account.number}</p>
        <p className="text-muted-foreground">ชื่อบัญชี {account.name}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          void navigator.clipboard?.writeText(account.number);
          toast.success("คัดลอกเลขบัญชีแล้ว");
        }}
      >
        คัดลอก
      </Button>
    </div>
  );
}

function SlipResult({ slip }: { slip: SlipCheck }) {
  const rows: [string, boolean | null][] = [
    ["เป็นสลิปโอนเงิน", slip.checks.isSlip],
    [`ยอดตรง (${slip.amount == null ? "อ่านไม่ได้" : formatMoney(slip.amount)})`, slip.checks.amount],
    [`มีเลขอ้างอิง ${slip.transRef ?? ""}`, slip.checks.reference],
    ["ยังไม่เคยใช้กับบิลอื่น", slip.checks.unused],
    [`ผู้รับตรงกับ PromptPay ร้าน${slip.receiverName ? ` (${slip.receiverName})` : ""}`, slip.checks.receiver],
  ];
  return (
    <div className={cn("mt-2 rounded-lg p-2.5 text-xs", slip.ok ? "bg-success-soft" : "bg-danger-soft")}>
      <p className={cn("mb-1 font-semibold", slip.ok ? "text-success" : "text-danger")}>{slip.ok ? "สลิปผ่านการตรวจ" : "สลิปไม่ผ่าน — ตรวจแอปธนาคารของร้านก่อนรับ"}</p>
      <ul className="space-y-0.5">
        {rows.map(([label, ok]) => (
          <li key={label} className="flex items-center gap-1.5">
            {ok === null ? <span className="size-3.5 text-center text-muted-foreground">–</span> : ok ? <CheckCircle2 className="size-3.5 text-success" /> : <XCircle className="size-3.5 text-danger" />}
            {label}
          </li>
        ))}
      </ul>
      {slip.bank && (
        <p className="mt-1 text-muted-foreground">
          {slip.bank}
          {slip.paidAt ? ` · ${slip.paidAt}` : ""}
        </p>
      )}
    </div>
  );
}

function PromptPayQr({ amount, enabled, onPayload }: { amount: number; enabled: boolean; onPayload: (p: string | null) => void }) {
  const [svg, setSvg] = useState<string | null>(null);
  const payload = useQuery({
    queryKey: ["pos", "promptpay", amount],
    queryFn: () => api.get<{ payload: string }>("/pos/promptpay", { amount }),
    enabled: enabled && amount > 0,
  });
  useEffect(() => {
    if (!payload.data) return;
    let alive = true;
    onPayload(payload.data.payload);
    void QRCode.toString(payload.data.payload, { type: "svg", margin: 1, width: 200, errorCorrectionLevel: "M" }).then((s) => {
      if (alive) setSvg(s);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onPayload is a fresh closure each render
  }, [payload.data]);

  if (!enabled) {
    return (
      <p className="rounded-lg bg-warning-soft p-3 text-sm text-warning">
        ยังไม่ได้ตั้งค่าหมายเลข PromptPay ของร้าน (ผู้จัดการตั้งได้ที่ปุ่ม &quot;ตั้งค่า&quot;) — ยังรับโอนได้ แต่ไม่มี QR
      </p>
    );
  }
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border p-3">
      <div className="grid size-[200px] shrink-0 place-items-center rounded-lg bg-white" data-testid="promptpay-qr">
        {svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <Loader2 className="size-6 animate-spin text-muted-foreground" />}
      </div>
      <div className="text-sm text-muted-foreground">
        <p className="font-medium text-foreground">QR ใส่ยอด {formatMoney(amount)}</p>
        <p className="mt-1">ลูกค้าสแกนแล้วยอดขึ้นเอง ไม่ต้องพิมพ์</p>
        <p className="mt-1">QR แสดงบนจอลูกค้าด้วย (ถ้าเปิดไว้)</p>
        <p className="mt-2 text-xs">ตรวจสลิปด้วย AI หรือดูแจ้งเตือนเงินเข้าก่อนยืนยัน</p>
      </div>
    </div>
  );
}
