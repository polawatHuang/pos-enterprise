import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Bot, Check } from "lucide-react";
import { SignupForm } from "@/components/auth/signup-form";

export const metadata: Metadata = {
  title: "สร้างบัญชีทดลอง",
  description: "ทดลองใช้ POSWITHAI ฟรี 14 วัน",
  robots: { index: false, follow: false },
};

export default function SignupPage() {
  return (
    <main className="grid min-h-dvh bg-background lg:grid-cols-[1fr_.9fr]">
      <section className="relative hidden overflow-hidden bg-[#101329] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="pointer-events-none absolute -right-36 -top-32 size-[520px] rounded-full bg-violet-500/25 blur-3xl" />
        <Link href="/" className="relative flex items-center gap-3 text-lg font-semibold"><span className="grid size-10 place-items-center rounded-xl bg-violet-500">P</span>POSWITHAI</Link>
        <div className="relative max-w-lg">
          <p className="text-sm font-medium text-violet-200">ทดลองใช้งานได้ 14 วัน</p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight">เริ่มบริหารหน้าร้านและหลังร้านจากที่เดียว</h1>
          <p className="mt-4 leading-7 text-slate-300">เปิดบัญชีองค์กรพร้อมสาขาแรกและสิทธิ์เจ้าของกิจการอัตโนมัติ ทดลองระบบได้โดยไม่ต้องผูกบัตร</p>
          <ul className="mt-8 space-y-4 text-sm text-slate-200">
            {["POS · สต๊อก · บัญชี · ทีมงาน", "ทดลองระบบ 14 วัน", "AI จ่ายแยกด้วยเครดิตเติมล่วงหน้า"].map((item) => <li key={item} className="flex items-center gap-3"><span className="grid size-6 place-items-center rounded-full bg-white/10"><Check className="size-3.5 text-emerald-300" /></span>{item}</li>)}
          </ul>
        </div>
        <p className="relative text-xs text-slate-500">ไม่รวมเครดิตฟรีสำหรับการใช้ AI</p>
      </section>
      <section className="flex items-center justify-center px-4 py-8 sm:px-8 sm:py-12">
        <div className="w-full max-w-md">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />กลับหน้าแรก</Link>
          <div className="mt-7 flex items-center gap-3 lg:hidden"><span className="grid size-9 place-items-center rounded-xl bg-primary font-bold text-primary-foreground">P</span><span className="font-semibold">POSWITHAI</span></div>
          <div className="mt-6 flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Bot className="size-5" /></span>
            <div><h2 className="text-2xl font-semibold tracking-tight">สร้างบัญชีทดลอง</h2><p className="mt-1 text-sm text-muted-foreground">14 วัน · ไม่ต้องผูกบัตร</p></div>
          </div>
          <div className="mt-6 rounded-xl border border-border bg-card p-4 sm:p-5"><SignupForm /></div>
          <p className="mt-5 text-center text-sm text-muted-foreground">มีบัญชีแล้ว? <Link href="/login" className="font-medium text-primary hover:underline">เข้าสู่ระบบ</Link></p>
        </div>
      </section>
    </main>
  );
}
