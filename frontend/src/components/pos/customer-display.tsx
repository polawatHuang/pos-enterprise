"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { CheckCircle2, ScanBarcode, ShieldCheck, Sparkles } from "lucide-react";
import { formatMoney, formatNumber } from "@/lib/utils";
import { type DisplayMessage, openDisplayChannel } from "./display-channel";

type Screen = Extract<DisplayMessage, { type: "cart" | "pay" | "paid" | "done" | "idle" }>;

/**
 * Customer-facing screen (second monitor / tablet). Mirrors the cart, shows the PromptPay QR with
 * the exact amount, asks the customer to confirm age for restricted items and says thank you.
 */
export function CustomerDisplay() {
  const [screen, setScreen] = useState<Screen>({ type: "idle" });
  const [cart, setCart] = useState<Extract<DisplayMessage, { type: "cart" }> | null>(null);
  const [asking, setAsking] = useState(false);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const ch = openDisplayChannel();
    channel.current = ch;
    if (!ch) return;
    ch.onmessage = (e: MessageEvent<DisplayMessage>) => {
      const m = e.data;
      if (m.type === "age") return setAsking(m.asking);
      if (m.type === "cart") setCart(m);
      if (m.type === "pay") {
        setQrSvg(null);
        if (m.qr)
          void QRCode.toString(m.qr, { type: "svg", margin: 1, width: 360, errorCorrectionLevel: "M" }).then(setQrSvg);
      }
      if (m.type === "done") {
        setAsking(false);
        if (doneTimer.current) clearTimeout(doneTimer.current);
        doneTimer.current = setTimeout(() => setScreen({ type: "idle" }), 8000);
      }
      if (m.type === "cart" || m.type === "pay" || m.type === "paid" || m.type === "done" || m.type === "idle") setScreen(m);
    };
    ch.postMessage({ type: "hello" } satisfies DisplayMessage);
    return () => ch.close();
  }, []);

  const confirmAge = () => {
    channel.current?.postMessage({ type: "age-confirmed" } satisfies DisplayMessage);
    setAsking(false);
  };

  return (
    <main className="relative flex min-h-dvh flex-col bg-gradient-to-br from-primary/10 via-background to-background p-6 sm:p-10">
      {screen.type === "idle" && (
        <div className="m-auto text-center">
          <div className="mx-auto grid size-24 place-items-center rounded-3xl bg-primary text-primary-foreground shadow-lg">
            <ScanBarcode className="size-12" />
          </div>
          <h1 className="mt-6 text-4xl font-bold tracking-tight">ยินดีต้อนรับ</h1>
          <p className="mt-2 text-lg text-muted-foreground">สมัครสมาชิกด้วยเบอร์โทร รับแต้มทุกการซื้อ</p>
        </div>
      )}

      {screen.type === "cart" && (
        <div className="grid flex-1 gap-6 lg:grid-cols-[1fr_380px]">
          <ul className="space-y-2 overflow-y-auto">
            {screen.lines.map((l, i) => (
              <li key={i} className="flex items-baseline gap-4 rounded-2xl bg-card px-5 py-3 text-xl shadow-sm">
                <span className="flex-1 truncate">{l.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {formatNumber(l.quantity)} {l.unit}
                </span>
                <span className="w-32 text-right font-semibold tabular-nums">{formatMoney(l.total)}</span>
              </li>
            ))}
          </ul>
          <Total total={screen.total} discount={screen.discount} member={screen.member} />
        </div>
      )}

      {screen.type === "pay" && (
        <div className="m-auto flex flex-col items-center text-center">
          <p className="text-2xl text-muted-foreground">ยอดชำระ</p>
          <p className="text-7xl font-bold tracking-tight text-primary tabular-nums" data-testid="display-total">
            {formatMoney(screen.total)}
          </p>
          {screen.qrImage ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- a QR image from the payment provider */}
              <img src={screen.qrImage} alt="QR PromptPay" className="mt-6 size-[360px] rounded-3xl bg-white object-contain p-4 shadow-xl" data-testid="display-qr" />
              <p className="mt-4 text-xl">สแกนด้วยแอปธนาคาร ยอดขึ้นอัตโนมัติ</p>
            </>
          ) : qrSvg ? (
            <>
              <div className="mt-6 rounded-3xl bg-white p-4 shadow-xl" dangerouslySetInnerHTML={{ __html: qrSvg }} data-testid="display-qr" />
              <p className="mt-4 text-xl">สแกนด้วยแอปธนาคาร ยอดขึ้นอัตโนมัติ</p>
            </>
          ) : screen.bank ? (
            <div className="mt-6 rounded-3xl bg-card px-10 py-6 shadow-xl" data-testid="display-bank">
              <p className="text-xl text-muted-foreground">โอนเข้าบัญชี {screen.bank.bank}</p>
              <p className="mt-1 text-5xl font-bold tracking-wider tabular-nums">{screen.bank.number}</p>
              <p className="mt-2 text-2xl">{screen.bank.name}</p>
            </div>
          ) : (
            <p className="mt-6 text-2xl text-muted-foreground">ชำระด้วย{screen.method}</p>
          )}
          {cart?.member && <p className="mt-4 text-lg text-muted-foreground">สมาชิก {cart.member.name} · {formatNumber(cart.member.points)} แต้ม</p>}
        </div>
      )}

      {screen.type === "paid" && (
        <div className="m-auto text-center">
          <CheckCircle2 className="mx-auto size-28 text-success" />
          <h1 className="mt-4 text-5xl font-bold">ชำระเงินแล้ว</h1>
          <p className="mt-3 text-3xl font-semibold tabular-nums">{formatMoney(screen.total)}</p>
        </div>
      )}

      {screen.type === "done" && (
        <div className="m-auto text-center">
          <CheckCircle2 className="mx-auto size-24 text-success" />
          <h1 className="mt-4 text-5xl font-bold">ขอบคุณค่ะ</h1>
          {screen.change > 0 && (
            <p className="mt-4 text-3xl">
              เงินทอน <span className="font-bold tabular-nums">{formatMoney(screen.change)}</span>
            </p>
          )}
          {screen.pointsEarned > 0 && (
            <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-primary-soft px-5 py-2 text-xl text-primary">
              <Sparkles className="size-5" /> ได้รับ +{formatNumber(screen.pointsEarned)} แต้ม
            </p>
          )}
        </div>
      )}

      {asking && (
        <div className="fixed inset-0 z-10 grid place-items-center bg-black/60 p-6">
          <div className="w-full max-w-lg rounded-3xl bg-card p-8 text-center shadow-2xl">
            <ShieldCheck className="mx-auto size-16 text-warning" />
            <h2 className="mt-4 text-3xl font-bold">ยืนยันอายุ</h2>
            <p className="mt-2 text-lg text-muted-foreground">มีสินค้าที่จำหน่ายเฉพาะผู้มีอายุ 20 ปีขึ้นไป</p>
            <button onClick={confirmAge} className="mt-6 h-16 w-full rounded-2xl bg-primary text-2xl font-semibold text-primary-foreground active:scale-[0.98]">
              ฉันอายุ 20 ปีขึ้นไป
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function Total({ total, discount, member }: { total: number; discount: number; member: { name: string; points: number } | null }) {
  return (
    <aside className="flex flex-col justify-end gap-3 rounded-3xl bg-primary p-6 text-primary-foreground shadow-xl">
      {member && (
        <p className="text-lg opacity-90">
          สมาชิก {member.name} · {formatNumber(member.points)} แต้ม
        </p>
      )}
      {discount > 0 && <p className="text-xl opacity-90">ประหยัด {formatMoney(discount)}</p>}
      <p className="text-xl opacity-80">ยอดรวม</p>
      <p className="text-6xl font-bold tracking-tight tabular-nums" data-testid="display-cart-total">
        {formatMoney(total)}
      </p>
    </aside>
  );
}
