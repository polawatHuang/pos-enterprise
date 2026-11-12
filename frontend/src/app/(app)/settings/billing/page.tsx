"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import QRCode from "qrcode";
import { BadgeCheck, Bot, CreditCard, FileImage, Loader2, ReceiptText, RefreshCw, Wallet } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";

interface BillingOverview {
  subscription: {
    planCode: string;
    planName: string;
    status: string;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    monthlyPrice: number | null;
    maxBranches: number | null;
    maxUsers: number | null;
  };
  credits: { balance: number; creditValue: number; unit: string };
  creditPacks: number[];
}

interface Checkout {
  id: string;
  type: "subscription" | "ai_credits";
  amount: number;
  qrPayload: string;
  expiresAt: string | null;
}

interface LedgerEntry {
  id: number;
  amount: number;
  balanceAfter: number;
  type: string;
  description: string;
  createdAt: string;
}

const plans = [
  { code: "starter", name: "Starter", price: 990, branches: 1, users: 3 },
  { code: "growth", name: "Growth", price: 1990, branches: 3, users: 10 },
  { code: "business", name: "Business", price: 4990, branches: 10, users: 30 },
];

const statusNames: Record<string, string> = {
  trialing: "ทดลองใช้งาน",
  active: "ใช้งานอยู่",
  expired: "หมดอายุ",
  past_due: "รอชำระ",
  canceled: "ยกเลิก",
  legacy: "สมาชิกเดิม",
};

export default function BillingPage() {
  const queryClient = useQueryClient();
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifyingSlip, setVerifyingSlip] = useState(false);
  const [qrImage, setQrImage] = useState<{ payload: string; url: string } | null>(null);
  const overview = useQuery({
    queryKey: ["saas", "me"],
    queryFn: () => api.get<BillingOverview>("/saas/me"),
    staleTime: 30_000,
  });
  const ledger = useQuery({
    queryKey: ["saas", "credits", "ledger"],
    queryFn: () => api.get<LedgerEntry[]>("/saas/credits/ledger"),
    staleTime: 30_000,
  });
  const payment = useQuery({
    queryKey: ["saas", "order", checkout?.id],
    queryFn: () => api.get<{ status: string }>(`/saas/orders/${checkout?.id}`),
    enabled: Boolean(checkout?.id),
    refetchInterval: (query) => query.state.data?.status === "pending" ? 3500 : false,
  });
  const data = overview.data;
  const status = payment.data?.status;
  const trialEnd = data?.subscription.trialEndsAt ? new Date(data.subscription.trialEndsAt) : null;
  const periodEnd = data?.subscription.currentPeriodEnd ? new Date(data.subscription.currentPeriodEnd) : null;

  useEffect(() => {
    if (status === "paid") void queryClient.invalidateQueries({ queryKey: ["saas"] });
  }, [status, queryClient]);

  useEffect(() => {
    if (!checkout?.qrPayload) return;
    let active = true;
    QRCode.toDataURL(checkout.qrPayload, { width: 320, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => { if (active) setQrImage({ payload: checkout.qrPayload, url }); })
      .catch(() => {
        if (active) {
          setQrImage(null);
          toast.error("สร้าง PromptPay QR ไม่สำเร็จ กรุณาสร้างรายการชำระใหม่");
        }
      });
    return () => { active = false; };
  }, [checkout?.qrPayload]);

  async function startCheckout(body: { planCode?: string; credits?: number }) {
    setBusy(true);
    try {
      const made = await api.post<Checkout>("/saas/checkout", body);
      setCheckout(made);
      await queryClient.invalidateQueries({ queryKey: ["saas", "order"] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "สร้างรายการชำระเงินไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function submitSlip(file: File | undefined) {
    if (!file || !checkout) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("เลือกไฟล์สลิปชนิด JPG, PNG หรือ WebP");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("ไฟล์สลิปต้องมีขนาดไม่เกิน 5 MB");
      return;
    }
    setVerifyingSlip(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("อ่านไฟล์ไม่สำเร็จ"));
        reader.onerror = () => reject(new Error("อ่านไฟล์ไม่สำเร็จ"));
        reader.readAsDataURL(file);
      });
      const imageBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      const result = await api.post<{ status: string; verified: boolean; message?: string }>(
        `/saas/orders/${checkout.id}/verify-slip`,
        { mimeType: file.type, imageBase64 },
      );
      if (result.verified) {
        toast.success("ตรวจสอบสลิปและยืนยันการชำระเงินแล้ว");
        await queryClient.invalidateQueries({ queryKey: ["saas"] });
      } else {
        toast.error(result.message || "สลิปไม่ผ่านการตรวจสอบ กรุณาตรวจยอดเงินและลองใหม่");
      }
      await queryClient.invalidateQueries({ queryKey: ["saas", "order", checkout.id] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "ตรวจสอบสลิปไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setVerifyingSlip(false);
    }
  }

  if (overview.isLoading) return <div className="grid min-h-64 place-items-center"><Loader2 className="size-6 animate-spin text-primary" aria-label="กำลังโหลด" /></div>;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <p className="text-sm text-muted-foreground">แพ็กเกจ · AI Credits</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">การเรียกเก็บเงิน</h1>
      </header>

      {overview.error && <p role="alert" className="rounded-xl border border-danger/20 bg-danger-soft p-4 text-sm text-danger">{overview.error instanceof Error ? overview.error.message : "โหลดข้อมูลแพ็กเกจไม่สำเร็จ"}</p>}

      {data && (
        <>
          <section className="grid gap-4 sm:grid-cols-2">
            <article className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-sm text-muted-foreground">แพ็กเกจปัจจุบัน</p><p className="mt-1 text-xl font-semibold">{data.subscription.planName}</p></div>
                <span className="rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary">{statusNames[data.subscription.status] ?? data.subscription.status}</span>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {data.subscription.status === "trialing" && trialEnd ? `ทดลองถึง ${trialEnd.toLocaleDateString("th-TH")}` : periodEnd ? `ใช้งานถึง ${periodEnd.toLocaleDateString("th-TH")}` : "จัดการแพ็กเกจรายเดือนได้ที่นี่"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{data.subscription.maxBranches ?? "ไม่จำกัด"} สาขา · {data.subscription.maxUsers ?? "ไม่จำกัด"} ผู้ใช้</p>
            </article>
            <article className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/10 to-card p-5">
              <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-violet-500/10 text-violet-600"><Wallet className="size-5" /></span><div><p className="text-sm text-muted-foreground">เครดิต AI คงเหลือ</p><p className="text-2xl font-semibold">{data.credits.balance.toLocaleString("th-TH")} <span className="text-sm font-normal text-muted-foreground">เครดิต</span></p></div></div>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">1 เครดิต = ฿1 ก่อน VAT · เครดิตไม่รวมในค่าสมาชิก · ไม่มีเครดิตฟรีทดลองใช้</p>
            </article>
          </section>

          <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-500/10 text-amber-600"><Bot className="size-5" /></span>
              <div><h2 className="font-semibold">เติมเครดิต AI</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">เติมล่วงหน้าเพื่อใช้แชต AI อ่านเอกสาร ค้นเทรนด์ สร้างภาพ เสียง และวิดีโอ ระบบกันเครดิตก่อนเริ่มงานและคืนส่วนที่ไม่ได้ใช้</p></div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {data.creditPacks.map((credits) => (
                <button key={credits} onClick={() => void startCheckout({ credits })} disabled={busy} className="rounded-xl border border-border p-4 text-left transition hover:border-primary/50 hover:bg-accent disabled:opacity-50">
                  <p className="text-lg font-semibold">{credits.toLocaleString("th-TH")} เครดิต</p>
                  <p className="mt-1 text-sm text-muted-foreground">฿{Math.round(credits * 1.07).toLocaleString("th-TH")} รวม VAT</p>
                  <p className="mt-3 text-xs text-primary">PromptPay · ตรวจสลิปด้วย Slip2Go</p>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-blue-500/10 text-blue-600"><CreditCard className="size-5" /></span><div><h2 className="font-semibold">แพ็กเกจรายเดือน</h2><p className="mt-1 text-sm text-muted-foreground">เลือกราคาและจำนวนสาขา/ผู้ใช้ให้เหมาะกับกิจการ</p></div></div>
            <div className="mt-5 grid gap-3 lg:grid-cols-3">
              {plans.map((plan) => (
                <article key={plan.code} className={`rounded-xl border p-4 ${data.subscription.planCode === plan.code ? "border-primary/50 bg-primary-soft/40" : "border-border"}`}>
                  <div className="flex items-center justify-between gap-2"><p className="font-semibold">{plan.name}</p>{data.subscription.planCode === plan.code && <BadgeCheck className="size-4 text-primary" />}</div>
                  <p className="mt-2 text-2xl font-semibold">฿{plan.price.toLocaleString("th-TH")}<span className="text-xs font-normal text-muted-foreground"> / เดือน</span></p>
                  <p className="mt-1 text-xs text-muted-foreground">{plan.branches} สาขา · {plan.users} ผู้ใช้ · ก่อน VAT</p>
                  <Button className="mt-4 w-full" variant={data.subscription.planCode === plan.code ? "secondary" : "outline"} onClick={() => void startCheckout({ planCode: plan.code })} disabled={busy}>
                    {data.subscription.planCode === plan.code ? "ต่ออายุ / ชำระแพ็กเกจ" : "เลือกแพ็กเกจ"}
                  </Button>
                </article>
              ))}
            </div>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">ชำระรายเดือนผ่าน PromptPay QR ในขณะนี้ ระบบยังไม่เรียกเก็บอัตโนมัติ กรุณาต่ออายุก่อนวันหมดอายุ</p>
          </section>

          {checkout && (
            <section className="rounded-2xl border border-primary/25 bg-primary-soft/30 p-5 sm:p-6">
              <div className="flex items-center justify-between gap-4">
                <div><h2 className="font-semibold">สแกนเพื่อชำระเงิน</h2><p className="mt-1 text-sm text-muted-foreground">ยอดรวม VAT ฿{checkout.amount.toLocaleString("th-TH")}</p></div>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${status === "paid" ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-700"}`}>{status === "paid" ? "ชำระแล้ว" : status === "pending" ? "รอชำระ" : status ?? "กำลังตรวจสอบ"}</span>
              </div>
              {status !== "paid" && status !== "expired" && status !== "failed" && (
                <div className="mt-4 flex flex-col items-center gap-4 rounded-xl bg-white p-4">
                  {qrImage?.payload === checkout.qrPayload ? <Image src={qrImage.url} alt="PromptPay QR สำหรับชำระเงิน" width={224} height={224} unoptimized className="size-56 max-w-full object-contain" /> : <Loader2 className="size-8 animate-spin text-primary" aria-label="กำลังสร้าง QR" />}
                  <p className="text-center text-xs text-slate-600">สแกนจ่ายยอดตาม QR แล้วแนบภาพสลิปเพื่อให้ Slip2Go ตรวจสอบ</p>
                  <label className="flex w-full max-w-sm cursor-pointer items-center justify-center gap-2 rounded-lg border border-border px-4 py-3 text-sm font-medium text-foreground transition hover:bg-accent has-[:disabled]:cursor-wait has-[:disabled]:opacity-60">
                    {verifyingSlip ? <Loader2 className="size-4 animate-spin" /> : <FileImage className="size-4" />}
                    {verifyingSlip ? "กำลังตรวจสอบสลิป..." : "เลือกรูปสลิปเพื่อตรวจสอบ"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      disabled={verifyingSlip || status === "paid"}
                      onChange={(event) => {
                        void submitSlip(event.currentTarget.files?.[0]);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <p className="text-center text-[11px] leading-5 text-slate-500">รับไฟล์ JPG, PNG หรือ WebP ไม่เกิน 5 MB · สถานะจะอัปเดตเมื่อยืนยันสำเร็จ</p>
                </div>
              )}
              {status === "paid" && <p className="mt-4 flex items-center gap-2 text-sm text-emerald-700"><BadgeCheck className="size-4" />ชำระสำเร็จแล้ว ข้อมูลเครดิตหรือแพ็กเกจอัปเดตแล้ว</p>}
              {status && ["expired", "failed"].includes(status) && <p className="mt-4 text-sm text-danger">รายการนี้หมดอายุหรือชำระไม่สำเร็จ กรุณาสร้างรายการใหม่</p>}
            </section>
          )}

          <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div className="flex items-center gap-3"><ReceiptText className="size-5 text-muted-foreground" /><h2 className="font-semibold">ประวัติเครดิต AI</h2><Button variant="ghost" size="icon" className="ml-auto" onClick={() => void queryClient.invalidateQueries({ queryKey: ["saas", "credits", "ledger"] })} aria-label="รีเฟรช"><RefreshCw className="size-4" /></Button></div>
            {ledger.isLoading ? <Loader2 className="mt-5 size-5 animate-spin text-primary" /> : ledger.data?.length ? (
              <div className="mt-4 divide-y divide-border">
                {ledger.data.map((entry) => <div key={entry.id} className="flex items-center gap-3 py-3 text-sm"><div className="min-w-0 flex-1"><p className="truncate font-medium">{entry.description}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString("th-TH")}</p></div><span className={entry.amount > 0 ? "font-medium text-emerald-700" : "font-medium"}>{entry.amount > 0 ? "+" : ""}{entry.amount.toLocaleString("th-TH")}</span></div>)}
              </div>
            ) : <p className="mt-4 text-sm text-muted-foreground">ยังไม่มีรายการเครดิต</p>}
          </section>
        </>
      )}
    </div>
  );
}
