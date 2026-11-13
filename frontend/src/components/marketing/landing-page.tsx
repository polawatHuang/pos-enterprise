import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bot,
  Boxes,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  MessageCircle,
  PackageCheck,
  Plus,
  ShieldCheck,
  ShoppingBasket,
  Sparkles,
  Store,
  Users,
  Wallet,
} from "lucide-react";

const plans = [
  { name: "Starter", price: "990", branches: "1 สาขา", users: "3 ผู้ใช้" },
  { name: "Growth", price: "1,990", branches: "3 สาขา", users: "10 ผู้ใช้", featured: true },
  { name: "Business", price: "4,990", branches: "10 สาขา", users: "30 ผู้ใช้" },
];

const features = [
  { icon: ShoppingBasket, label: "หน้าร้าน", title: "ขายไว คุมทุกบิล", body: "POS ใช้งานง่าย เชื่อมโปรโมชัน การชำระเงิน และข้อมูลลูกค้าไว้ในจังหวะเดียวกัน", tone: "violet" },
  { icon: Boxes, label: "คลังสินค้า", title: "รู้สต๊อกทุกสาขา", body: "ติดตามสินค้า รับเข้า โอนย้าย และตรวจนับ พร้อมเห็นความเคลื่อนไหวแบบเป็นระบบ", tone: "cyan" },
  { icon: BarChart3, label: "รายงาน", title: "เห็นภาพธุรกิจชัดขึ้น", body: "ดูยอดขาย ต้นทุน เอกสาร และตัวเลขสำคัญจากแหล่งข้อมูลเดียว", tone: "amber" },
  { icon: MessageCircle, label: "แชตและ AI", title: "ให้ AI ช่วยงานซ้ำๆ", body: "ช่วยร่างคำตอบ อ่านเอกสาร ค้นเทรนด์ และสร้างคอนเทนต์ตามงานของคุณ", tone: "pink" },
  { icon: Users, label: "ทีมงาน", title: "ทำงานเป็นทีมอย่างมั่นใจ", body: "กำหนดบทบาทและสิทธิ์พนักงาน พร้อมประวัติการเปลี่ยนแปลงที่ตรวจสอบได้", tone: "green" },
  { icon: ShieldCheck, label: "ความปลอดภัย", title: "ข้อมูลแยกตามองค์กร", body: "ขอบเขตการเข้าถึงถูกตรวจสอบฝั่งเซิร์ฟเวอร์ รองรับการเติบโตหลายสาขา", tone: "blue" },
];

async function CopyrightNotice() {
  await connection();
  return <span>© {new Date().getFullYear()} POS Enterprise. All rights reserved.</span>;
}

function DashboardPreview() {
  return (
    <div className="landing-preview-wrap landing-enter landing-delay-2">
      <div aria-hidden className="landing-orbit landing-orbit-one" />
      <div aria-hidden className="landing-orbit landing-orbit-two" />
      <div className="landing-preview">
        <div className="flex h-12 items-center justify-between border-b border-white/[.07] px-4 sm:h-14 sm:px-5">
          <div className="flex items-center gap-2.5">
            <span className="grid size-7 place-items-center rounded-lg bg-violet-500 text-white"><Store className="size-4" /></span>
            <span className="text-xs font-semibold tracking-tight text-white sm:text-sm">POS <span className="text-violet-300">Enterprise</span></span>
          </div>
          <div className="hidden items-center gap-1.5 rounded-lg border border-white/[.08] bg-white/[.035] px-3 py-1.5 text-[10px] text-slate-400 sm:flex">
            <span className="size-1.5 rounded-full bg-emerald-400" /> สาขาสยาม · วันนี้
          </div>
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-full bg-violet-300/15 text-[10px] font-semibold text-violet-100">PK</span>
            <span className="hidden text-[10px] text-slate-400 sm:inline">ผู้ดูแลร้าน</span>
          </div>
        </div>

        <div className="grid min-h-[348px] grid-cols-[44px_1fr] sm:min-h-[398px] sm:grid-cols-[150px_1fr]">
          <aside className="border-r border-white/[.06] bg-[#0b1020]/70 p-2 sm:p-3">
            <p className="hidden px-2 pb-2 pt-1 text-[9px] font-medium uppercase tracking-[.16em] text-slate-600 sm:block">เมนูหลัก</p>
            {[
              { icon: BarChart3, label: "ภาพรวม", active: true },
              { icon: ShoppingBasket, label: "ขายหน้าร้าน" },
              { icon: PackageCheck, label: "คลังสินค้า" },
              { icon: ClipboardList, label: "รายงาน" },
              { icon: MessageCircle, label: "แชตและ AI" },
            ].map(({ icon: Icon, label, active }) => (
              <div key={label} title={label} className={`mb-1 flex items-center justify-center gap-2 rounded-lg px-2 py-2.5 sm:justify-start ${active ? "bg-violet-400/10 text-violet-200" : "text-slate-500"}`}>
                <Icon className="size-3.5 shrink-0" />
                <span className="hidden truncate text-[10px] sm:block">{label}</span>
              </div>
            ))}
            <div className="mt-4 hidden border-t border-white/[.06] pt-3 sm:block">
              <div className="flex items-center gap-2 rounded-lg bg-white/[.035] p-2">
                <span className="grid size-6 place-items-center rounded-md bg-cyan-300/10 text-cyan-200"><Sparkles className="size-3" /></span>
                <span className="text-[9px] text-slate-400">ผู้ช่วย AI</span>
              </div>
            </div>
          </aside>

          <div className="min-w-0 p-3 sm:p-5">
            <div className="flex items-start justify-between gap-2">
              <div><p className="text-[9px] text-slate-500 sm:text-[10px]">วันพฤหัสบดี · สรุปกิจการ</p><h2 className="mt-1 text-sm font-semibold text-white sm:text-base">สวัสดี, คุณพอล 👋</h2></div>
              <button type="button" className="flex shrink-0 items-center gap-1 rounded-lg border border-white/[.08] bg-white/[.025] px-2 py-1.5 text-[9px] text-slate-400 sm:px-2.5"><span className="hidden sm:inline">วันนี้</span><ChevronRight className="size-3 rotate-90" /></button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:grid-cols-3 sm:gap-2.5">
              <div className="rounded-xl border border-white/[.07] bg-white/[.025] p-2.5 sm:p-3">
                <div className="flex items-center justify-between"><span className="text-[9px] text-slate-500 sm:text-[10px]">ยอดขายวันนี้</span><Wallet className="size-3 text-violet-300" /></div>
                <p className="mt-2 text-base font-semibold tracking-tight text-white sm:text-lg">฿24,850</p>
                <p className="mt-1 flex items-center gap-1 text-[8px] text-emerald-300 sm:text-[9px]"><ArrowUpRight className="size-3" /> 12.8% <span className="text-slate-600">เทียบเมื่อวาน</span></p>
              </div>
              <div className="rounded-xl border border-white/[.07] bg-white/[.025] p-2.5 sm:p-3">
                <div className="flex items-center justify-between"><span className="text-[9px] text-slate-500 sm:text-[10px]">ออเดอร์</span><ShoppingBasket className="size-3 text-cyan-300" /></div>
                <p className="mt-2 text-base font-semibold tracking-tight text-white sm:text-lg">128 <span className="text-[9px] font-normal text-slate-500">บิล</span></p>
                <p className="mt-1 text-[8px] text-slate-500 sm:text-[9px]">เฉลี่ย ฿194 / บิล</p>
              </div>
              <div className="col-span-2 rounded-xl border border-white/[.07] bg-white/[.025] p-2.5 sm:col-span-1 sm:p-3">
                <div className="flex items-center justify-between"><span className="text-[9px] text-slate-500 sm:text-[10px]">สินค้าใกล้หมด</span><PackageCheck className="size-3 text-amber-300" /></div>
                <p className="mt-2 text-base font-semibold tracking-tight text-white sm:text-lg">06 <span className="text-[9px] font-normal text-slate-500">รายการ</span></p>
                <p className="mt-1 text-[8px] text-amber-200/80 sm:text-[9px]">ตรวจสอบสต๊อก</p>
              </div>
            </div>

            <div className="mt-2.5 grid gap-2 sm:mt-3 sm:grid-cols-[1.4fr_.8fr] sm:gap-2.5">
              <div className="rounded-xl border border-white/[.07] bg-white/[.025] p-3 sm:p-3.5">
                <div className="flex items-center justify-between"><div><p className="text-[10px] font-medium text-slate-200">แนวโน้มยอดขาย</p><p className="mt-0.5 text-[8px] text-slate-600">ภาพรวม 7 วันที่ผ่านมา</p></div><span className="text-[8px] text-violet-200">สัปดาห์นี้⌄</span></div>
                <div className="relative mt-3 h-[78px] sm:h-[96px]">
                  <div className="absolute inset-0 flex flex-col justify-between"><span className="border-t border-dashed border-white/[.05]" /><span className="border-t border-dashed border-white/[.05]" /><span className="border-t border-dashed border-white/[.05]" /></div>
                  <svg viewBox="0 0 360 92" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-label="กราฟแนวโน้มยอดขาย">
                    <defs><linearGradient id="salesFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#a78bfa" stopOpacity=".3" /><stop offset="100%" stopColor="#a78bfa" stopOpacity="0" /></linearGradient></defs>
                    <path d="M0 75 C25 68 31 58 54 62 S85 48 108 54 S145 28 162 39 S199 50 216 34 S246 45 270 24 S308 32 324 16 S348 14 360 7 V92 H0Z" fill="url(#salesFill)" />
                    <path d="M0 75 C25 68 31 58 54 62 S85 48 108 54 S145 28 162 39 S199 50 216 34 S246 45 270 24 S308 32 324 16 S348 14 360 7" fill="none" stroke="#a78bfa" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
                    <circle cx="324" cy="16" r="4" fill="#c4b5fd" stroke="#18162d" strokeWidth="3" vectorEffect="non-scaling-stroke" />
                  </svg>
                </div>
                <div className="mt-1 flex justify-between text-[7px] text-slate-600"><span>จ.</span><span>อ.</span><span>พ.</span><span>พฤ.</span><span>ศ.</span><span>ส.</span><span>อา.</span></div>
              </div>
              <div className="rounded-xl border border-white/[.07] bg-white/[.025] p-3 sm:p-3.5">
                <div className="flex items-center justify-between"><p className="text-[10px] font-medium text-slate-200">รายการล่าสุด</p><ArrowRight className="size-3 text-slate-500" /></div>
                {[
                  ["#POS-0128", "฿590", "bg-violet-300/15 text-violet-200"],
                  ["#POS-0127", "฿1,240", "bg-cyan-300/15 text-cyan-200"],
                  ["#POS-0126", "฿320", "bg-amber-300/15 text-amber-200"],
                ].map(([id, amount, tone]) => (
                  <div key={id} className="mt-2.5 flex items-center justify-between gap-1 border-b border-white/[.045] pb-2 last:border-0 last:pb-0">
                    <div className="flex min-w-0 items-center gap-2"><span className={`grid size-6 shrink-0 place-items-center rounded-md ${tone}`}><CreditCard className="size-3" /></span><span className="truncate text-[8px] text-slate-400">{id}</span></div>
                    <span className="shrink-0 text-[9px] font-medium text-slate-200">{amount}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="landing-float landing-float-ai">
          <span className="grid size-8 place-items-center rounded-lg bg-violet-400/15 text-violet-200"><Bot className="size-4" /></span>
          <div><p className="text-[10px] font-semibold text-white">AI ช่วยสรุปให้แล้ว</p><p className="mt-0.5 text-[8px] text-slate-400">ยอดขายสัปดาห์นี้เพิ่มขึ้น 12.8%</p></div>
          <span className="ml-auto size-1.5 rounded-full bg-emerald-400" />
        </div>
        <div className="landing-float landing-float-stock">
          <span className="grid size-8 place-items-center rounded-lg bg-emerald-400/10 text-emerald-200"><PackageCheck className="size-4" /></span>
          <div><p className="text-[10px] font-semibold text-white">คลังอัปเดตแล้ว</p><p className="mt-0.5 text-[8px] text-slate-400">ข้อมูลทุกสาขาพร้อมใช้งาน</p></div>
        </div>
      </div>
    </div>
  );
}

export function LandingPage() {
  return (
    <main className="landing-page min-h-dvh overflow-hidden text-white">
      <header className="landing-header sticky top-0 z-30 border-b border-white/[.06]">
        <div className="mx-auto flex h-[68px] w-full max-w-7xl items-center justify-between px-4 sm:h-[76px] sm:px-8">
          <Link href="/" className="flex items-center gap-2.5" aria-label="POS Enterprise หน้าแรก">
            <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-violet-400 to-indigo-500 text-white shadow-lg shadow-violet-950/40"><Store className="size-[18px]" /></span>
            <span className="text-sm font-semibold tracking-tight text-white sm:text-base">POS <span className="text-violet-300">Enterprise</span></span>
          </Link>
          <nav aria-label="เมนูหลัก" className="flex items-center gap-1.5 sm:gap-6">
            <Link href="#features" className="hidden text-sm text-slate-400 transition hover:text-white sm:inline">ฟีเจอร์</Link>
            <Link href="/pricing" className="hidden text-sm text-slate-400 transition hover:text-white sm:inline">แพ็กเกจ</Link>
            <Link href="/login" className="rounded-lg px-2.5 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/[.06] hover:text-white sm:px-3 sm:text-sm">เข้าสู่ระบบ</Link>
            <Link href="/signup" className="landing-button inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-white sm:h-10 sm:gap-2 sm:px-4 sm:text-sm">
              เริ่มใช้ฟรี <ArrowRight className="size-3.5 sm:size-4" />
            </Link>
          </nav>
        </div>
      </header>

      <section className="landing-hero relative">
        <div aria-hidden className="landing-grid absolute inset-0" />
        <div aria-hidden className="landing-glow landing-glow-left" />
        <div aria-hidden className="landing-glow landing-glow-right" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 pb-14 pt-12 sm:gap-14 sm:px-8 sm:pb-20 sm:pt-16 lg:grid-cols-[.88fr_1.12fr] lg:gap-8 lg:pb-28 lg:pt-20">
          <div className="relative z-10 landing-enter">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-violet-300/[.07] px-3 py-1.5 text-[10px] font-medium tracking-wide text-violet-200 sm:text-xs">
              <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-violet-300 opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-violet-300" /></span>
              ระบบเดียวที่โตไปพร้อมธุรกิจคุณ
              <ArrowUpRight className="size-3 text-violet-300" />
            </div>
            <h1 className="mt-6 max-w-[650px] text-[2.55rem] font-semibold leading-[1.16] tracking-[-.045em] sm:mt-7 sm:text-5xl lg:text-[3.55rem]">
              จัดการร้านให้
              <span className="landing-gradient-text block">ง่ายกว่าที่เคย</span>
              พร้อมโตทุกวัน
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-7 text-slate-400 sm:mt-6 sm:text-base sm:leading-8">
              POS สต๊อกหลายสาขา บัญชี ทีมงาน แชต และ AI ที่เชื่อมถึงกัน
              ให้คุณใช้เวลากับการเติบโต มากกว่างานหลังร้าน
            </p>
            <div className="mt-7 flex flex-col gap-3 min-[400px]:flex-row sm:mt-8">
              <Link href="/signup" className="landing-button group inline-flex h-12 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-white">
                ทดลองฟรี 14 วัน <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link href="#features" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-white/[.12] bg-white/[.025] px-5 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:bg-white/[.06]">
                สำรวจฟีเจอร์ <ArrowDown className="size-4" />
              </Link>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-slate-500 sm:mt-6 sm:gap-x-5 sm:text-xs">
              <span className="inline-flex items-center gap-1.5"><Check className="size-3.5 text-emerald-300" /> ไม่ต้องผูกบัตร</span>
              <span className="inline-flex items-center gap-1.5"><Check className="size-3.5 text-emerald-300" /> เริ่มต้นได้ในไม่กี่นาที</span>
              <span className="inline-flex items-center gap-1.5"><Check className="size-3.5 text-emerald-300" /> AI เติมเครดิตแยก</span>
            </div>
          </div>
          <DashboardPreview />
        </div>
        <div className="relative mx-auto max-w-7xl px-4 pb-8 sm:px-8 sm:pb-10">
          <div className="landing-proof flex flex-wrap items-center justify-center gap-x-5 gap-y-3 rounded-2xl border border-white/[.07] bg-white/[.025] px-4 py-4 sm:justify-between sm:px-6 sm:py-5">
            <p className="w-full text-center text-[9px] font-medium uppercase tracking-[.19em] text-slate-600 sm:w-auto sm:text-left">ทุกส่วนของธุรกิจ เชื่อมอยู่ด้วยกัน</p>
            {[
              { icon: ShoppingBasket, label: "ขายหน้าร้าน" },
              { icon: PackageCheck, label: "สต๊อกสินค้า" },
              { icon: BarChart3, label: "บัญชีและรายงาน" },
              { icon: MessageCircle, label: "แชตและ AI" },
            ].map(({ icon: Icon, label }) => {
              return <span key={label} className="inline-flex items-center gap-2 text-[10px] font-medium text-slate-400 sm:text-xs"><Icon className="size-3.5 text-violet-300/80" />{label}</span>;
            })}
          </div>
        </div>
      </section>

      <section id="features" className="scroll-mt-24 relative mx-auto max-w-7xl px-4 py-16 sm:px-8 sm:py-24">
        <div aria-hidden className="landing-section-glow" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-violet-300 sm:text-xs">จากหน้าร้านถึงหลังบ้าน</p>
            <h2 className="mt-3 max-w-2xl text-2xl font-semibold leading-tight tracking-tight sm:text-4xl">ทุกงานสำคัญ อยู่ในที่เดียวกัน</h2>
          </div>
          <p className="max-w-md text-xs leading-6 text-slate-500 sm:text-sm sm:leading-7">ลดงานซ้ำ มองเห็นภาพรวมได้ไวขึ้น และพาธุรกิจเดินหน้าต่ออย่างมั่นใจ</p>
        </div>
        <div className="relative mt-8 grid gap-3 sm:mt-10 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {features.map(({ icon: Icon, label, title, body, tone }, index) => (
            <article key={title} className={`landing-feature landing-feature-${tone} landing-enter`} style={{ animationDelay: `${index * 80}ms` }}>
              <div className="flex items-start justify-between">
                <span className="landing-feature-icon"><Icon className="size-5" /></span>
                <span className="rounded-full border border-white/[.07] px-2.5 py-1 text-[9px] text-slate-500">{label}</span>
              </div>
              <h3 className="mt-6 text-sm font-semibold text-white sm:text-base">{title}</h3>
              <p className="mt-2 text-xs leading-6 text-slate-400 sm:text-sm">{body}</p>
              <span className="landing-feature-line" />
            </article>
          ))}
        </div>
      </section>

      <section className="relative overflow-hidden border-y border-white/[.06] bg-[#0b0f1d]">
        <div aria-hidden className="landing-glow landing-glow-center" />
        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-8 sm:py-20 lg:grid-cols-[.85fr_1.15fr] lg:items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-cyan-200/15 bg-cyan-200/[.06] px-3 py-1.5 text-[10px] font-medium text-cyan-100 sm:text-xs"><Sparkles className="size-3.5" /> AI ที่ใช้ได้จริงในงานประจำวัน</span>
            <h2 className="mt-5 text-2xl font-semibold leading-tight tracking-tight sm:text-4xl">ให้ทีมโฟกัสกับสิ่งสำคัญ<br className="hidden sm:block" /> แล้วให้ AI ช่วยงานที่เหลือ</h2>
            <p className="mt-4 max-w-lg text-xs leading-6 text-slate-400 sm:text-sm sm:leading-7">ใช้ AI กับแชต เอกสาร เทรนด์ และคอนเทนต์ได้เมื่อต้องการ จ่ายเครดิตแยกตามงานที่ใช้ ควบคุมงบได้ง่าย</p>
            <Link href="/signup" className="mt-6 inline-flex items-center gap-2 text-xs font-semibold text-violet-200 transition hover:text-white sm:text-sm">ดูว่าเริ่มต้นอย่างไร <ArrowRight className="size-4" /></Link>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
            {[
              { icon: MessageCircle, title: "ตอบแชตไวขึ้น", text: "ช่วยร่างคำตอบให้ทีม", tone: "violet" },
              { icon: ClipboardList, title: "สรุปงานซับซ้อน", text: "ค้นข้อมูลในเอกสาร", tone: "cyan" },
              { icon: Sparkles, title: "สร้างคอนเทนต์", text: "ไอเดีย ภาพ และเสียง", tone: "pink" },
              { icon: CircleDollarSign, title: "ควบคุมค่าใช้จ่าย", text: "เติมเครดิตก่อนใช้งาน", tone: "green" },
            ].map(({ icon: Icon, title, text, tone }, index) => (
              <div key={title} className={`landing-ai-card landing-ai-${tone} ${index === 1 || index === 3 ? "translate-y-3 sm:translate-y-4" : ""}`}>
                <span className="landing-feature-icon"><Icon className="size-4 sm:size-5" /></span>
                <p className="mt-5 text-xs font-semibold text-white sm:text-sm">{title}</p>
                <p className="mt-1 text-[9px] text-slate-500 sm:text-xs">{text}</p>
                <Plus className="absolute right-3 top-3 size-3 text-slate-600" />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="scroll-mt-20 mx-auto max-w-7xl px-4 py-16 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-violet-300 sm:text-xs">ราคาชัดเจน ไม่มีเรื่องให้เดา</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-4xl">เริ่มเล็กได้ โตต่อได้เสมอ</h2>
          <p className="mt-3 text-xs leading-6 text-slate-500 sm:text-sm">เริ่มทดลองใช้งาน 14 วัน ไม่ต้องผูกบัตร เลือกแพ็กเกจให้เหมาะกับทีมของคุณ</p>
        </div>
        <div className="mt-8 grid items-stretch gap-3 sm:mt-10 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {plans.map((plan) => (
            <article key={plan.name} className={`landing-plan ${plan.featured ? "landing-plan-featured" : ""}`}>
              {plan.featured && <span className="landing-plan-badge"><Sparkles className="size-3" /> แนะนำสำหรับธุรกิจที่กำลังโต</span>}
              <p className="text-xs font-semibold text-slate-300">{plan.name}</p>
              <div className="mt-4 flex items-baseline gap-1"><span className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">฿{plan.price}</span><span className="text-xs text-slate-500">/ เดือน</span></div>
              <p className="mt-1 text-[10px] text-slate-600">ราคาก่อน VAT 7%</p>
              <div className="my-5 border-t border-white/[.08]" />
              <ul className="space-y-3 text-xs text-slate-300 sm:text-sm">
                {[plan.branches, plan.users, "POS · สต๊อก · บัญชี", "AI เติมเครดิตแยก"].map((item) => <li key={item} className="flex items-center gap-2.5"><Check className="size-3.5 shrink-0 text-emerald-300" />{item}</li>)}
              </ul>
              <Link href="/signup" className={`mt-7 flex h-11 items-center justify-center gap-2 rounded-xl text-xs font-semibold transition sm:text-sm ${plan.featured ? "landing-button text-white" : "border border-white/[.11] bg-white/[.025] text-slate-200 hover:border-white/25 hover:bg-white/[.06]"}`}>
                เริ่มทดลองใช้ <ArrowRight className="size-4" />
              </Link>
            </article>
          ))}
        </div>
        <div className="mx-auto mt-5 flex max-w-3xl flex-col items-center justify-center gap-2 text-center text-[10px] leading-5 text-slate-500 sm:flex-row sm:gap-2.5 sm:text-xs">
          <CreditCard className="hidden size-4 shrink-0 text-violet-300 sm:block" />
          <p>เครดิต AI แยกจากค่าสมาชิก เติมก่อนใช้ ไม่มีเครดิตฟรีระหว่างทดลอง · 1 เครดิต = ฿1 ก่อน VAT · เลือกเติม 500, 1,500 หรือ 3,000 เครดิต</p>
        </div>
      </section>

      <section className="px-4 pb-12 sm:px-8 sm:pb-16">
        <div className="landing-cta relative mx-auto max-w-7xl overflow-hidden rounded-3xl border border-violet-200/15 px-5 py-9 sm:px-10 sm:py-12">
          <div aria-hidden className="landing-cta-glow" />
          <div className="relative flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
            <div>
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[.16em] text-violet-200 sm:text-xs"><Sparkles className="size-3.5" /> พร้อมเริ่มต้นหรือยัง?</span>
              <h2 className="mt-3 text-xl font-semibold tracking-tight text-white sm:text-3xl">ธุรกิจที่ดีขึ้น เริ่มจากวันนี้</h2>
              <p className="mt-2 text-xs text-slate-400 sm:text-sm">ทดลองใช้งานฟรี 14 วัน ไม่ต้องผูกบัตร</p>
            </div>
            <Link href="/signup" className="landing-button group inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-white sm:w-auto">
              สร้างบัญชีทดลอง <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/[.06]">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 text-[10px] text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:text-xs">
          <Link href="/" className="flex items-center gap-2 font-medium text-slate-400"><span className="grid size-6 place-items-center rounded-md bg-violet-500/20 text-violet-200"><Store className="size-3.5" /></span> POS Enterprise</Link>
          <div className="flex flex-wrap gap-x-4 gap-y-2"><Link className="transition hover:text-slate-300" href="/terms">ข้อกำหนด</Link><Link className="transition hover:text-slate-300" href="/privacy">ความเป็นส่วนตัว</Link><Link className="transition hover:text-slate-300" href="/pricing">แพ็กเกจ</Link><Link className="transition hover:text-slate-300" href="/login">เข้าสู่ระบบ</Link></div>
          <Suspense fallback={<span>© POS Enterprise. All rights reserved.</span>}>
            <CopyrightNotice />
          </Suspense>
        </div>
      </footer>
    </main>
  );
}
