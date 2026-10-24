"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import type { PaymentIntent } from "@/lib/types";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { QrSvg } from "./qr";

const pendingCancel = new Map<number, ReturnType<typeof setTimeout>>();

/**
 * PromptPay QR from the shop's payment provider. The till watches the payment (every 2 seconds) and
 * hands it over as soon as the money arrives, so the cashier never has to look at a banking app.
 */
export function GatewayQr({
  amount,
  onShow,
  onPaid,
  onManual,
}: {
  amount: number;
  /** what to show on the customer display */
  onShow: (qrPayload: string | null, qrImage: string | null, amount: number) => void;
  onPaid: (intent: PaymentIntent) => void;
  /** the customer cannot use this QR: fall back to the plain one + "I saw the money" tick */
  onManual: () => void;
}) {
  const [committed, setCommitted] = useState(amount);
  const [nonce, setNonce] = useState(0);
  const create = useQuery({
    // not under "pos": a finished sale invalidates ["pos"] and that must not create a second QR
    queryKey: ["gateway-intent-new", committed, nonce],
    queryFn: () => api.post<PaymentIntent>("/pos/payment-intents", { amount: committed }),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const made = create.data;
  const status = useQuery({
    queryKey: ["gateway-intent", made?.id],
    queryFn: () => api.get<PaymentIntent>(`/pos/payment-intents/${made!.id}`),
    enabled: !!made,
    refetchInterval: (q) => (q.state.data && q.state.data.status !== "pending" ? false : 2000),
    refetchIntervalInBackground: true,
    gcTime: 0,
  });
  const live = status.data ?? made;

  // the QR on the customer display
  useEffect(() => {
    if (made) onShow(made.qrPayload, made.qrImage, made.amount);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onShow is a fresh closure each render
  }, [made?.id]);

  // hand over the payment once
  const handed = useRef<number | null>(null);
  useEffect(() => {
    if (live?.status === "paid" && handed.current !== live.id) {
      handed.current = live.id;
      onPaid(live);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onPaid is a fresh closure each render
  }, [live?.status, live?.id]);

  // a QR nobody paid is cancelled when the cashier leaves it (a paid one is untouched: cancel only hits pending).
  // The short delay keeps it alive across a remount of the same QR (React strict mode in development).
  useEffect(() => {
    const id = made?.id;
    if (id) {
      const t = pendingCancel.get(id);
      if (t) clearTimeout(t);
      pendingCancel.delete(id);
    }
    return () => {
      if (id)
        pendingCancel.set(
          id,
          setTimeout(() => (pendingCancel.delete(id), void api.post(`/pos/payment-intents/${id}/cancel`).catch(() => undefined)), 1000),
        );
    };
  }, [made?.id]);

  const retry = () => {
    setCommitted(amount);
    setNonce((n) => n + 1);
  };

  if (create.isError)
    return (
      <div className="space-y-2 rounded-xl border border-warning bg-warning-soft p-3 text-sm">
        <p className="flex items-center gap-2 font-medium text-warning">
          <TriangleAlert className="size-4" /> สร้าง QR อัตโนมัติไม่สำเร็จ
        </p>
        <p className="text-muted-foreground">{create.error instanceof Error ? create.error.message : "ลองใหม่อีกครั้ง"}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="h-10" onClick={retry}>
            <RefreshCw /> ลองใหม่
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-10" onClick={onManual}>
            ใช้ QR ธรรมดา
          </Button>
        </div>
      </div>
    );
  if (!live)
    return (
      <div className="grid h-[220px] place-items-center rounded-xl border border-border">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  const dead = live.status === "expired" || live.status === "failed" || live.status === "cancelled";
  return (
    <div className="space-y-3">
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border p-3 sm:flex-row sm:gap-4">
        <div className="relative grid size-[200px] shrink-0 place-items-center rounded-lg bg-white" data-testid="gateway-qr">
          {live.qrImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- a QR image from the payment provider
            <img src={live.qrImage} alt="QR PromptPay" className="size-full object-contain" />
          ) : live.qrPayload ? (
            <QrSvg data={live.qrPayload} className="size-full" />
          ) : null}
          {(live.status === "paid" || live.status === "used") && (
            <div className="absolute inset-0 grid place-items-center rounded-lg bg-success/90 text-white">
              <CheckCircle2 className="size-16" />
            </div>
          )}
          {dead && <div className="absolute inset-0 rounded-lg bg-white/85" />}
        </div>
        <div className="text-center text-sm text-muted-foreground sm:text-left">
          <p className="text-lg font-semibold text-foreground">QR ยอด {formatMoney(live.amount)}</p>
          {live.status === "pending" && (
            <p className="mt-1 flex items-center justify-center gap-2 sm:justify-start">
              <Loader2 className="size-4 animate-spin" /> รอลูกค้าสแกนจ่าย — จบการขายเองเมื่อเงินเข้า
            </p>
          )}
          {(live.status === "paid" || live.status === "used") && <p className="mt-1 font-medium text-success">ได้รับเงินแล้ว</p>}
          {dead && <p className="mt-1 text-danger">{live.status === "expired" ? "QR หมดอายุแล้ว" : "QR ใช้ไม่ได้แล้ว"}</p>}
          <p className="mt-1 text-xs">QR แสดงบนจอลูกค้าด้วย (ถ้าเปิดไว้)</p>
        </div>
      </div>
      {live.status === "pending" && Math.abs(amount - committed) > 0.001 && (
        <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setCommitted(amount)}>
          <RefreshCw /> สร้าง QR ใหม่ตามยอด {formatMoney(amount)}
        </Button>
      )}
      {dead && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="h-11" onClick={retry}>
            <RefreshCw /> สร้าง QR ใหม่
          </Button>
          <Button type="button" variant="ghost" className="h-11" onClick={onManual}>
            ใช้ QR ธรรมดา
          </Button>
        </div>
      )}
      {live.status === "pending" && (
        <button type="button" onClick={onManual} className="min-h-10 text-xs text-muted-foreground underline-offset-2 hover:underline">
          ลูกค้าจ่ายไม่ได้? ใช้ QR ธรรมดาแล้วตรวจสลิปเอง
        </button>
      )}
    </div>
  );
}
