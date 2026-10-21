import type { Metadata } from "next";
import { Bot, LineChart, ShieldCheck, Store } from "lucide-react";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "เข้าสู่ระบบ" };

const highlights = [
  { icon: Store, text: "POS หน้าร้าน สต๊อกหลายสาขา สั่งซื้อและรับของ" },
  { icon: Bot, text: "AI ตอบแชต LINE / Facebook / Instagram ปิดการขายให้อัตโนมัติ" },
  { icon: LineChart, text: "บัญชี ภาษี และ Smart Dashboard ในที่เดียว" },
  { icon: ShieldCheck, text: "สิทธิ์ผู้ใช้ระดับองค์กร พร้อม audit log" },
];

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 size-[520px] rounded-full bg-primary/30 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -left-20 size-[420px] rounded-full bg-chart-2/20 blur-3xl"
        />
        <div className="relative flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">P</div>
          <span className="text-lg font-semibold text-white">POS Enterprise</span>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-4xl font-semibold leading-tight text-white">ขายได้ทุกช่องทาง บริหารได้ในระบบเดียว</h1>
          <ul className="mt-8 space-y-4">
            {highlights.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-[15px]">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-white/10">
                  <Icon className="size-4 text-white" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-sidebar-muted">POS Enterprise · Commerce Operating System</p>
      </section>

      <section className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="grid size-10 place-items-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">P</div>
            <span className="text-lg font-semibold">POS Enterprise</span>
          </div>
          <h2 className="text-2xl font-semibold">เข้าสู่ระบบ</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">ใช้อีเมลและรหัสผ่านที่ผู้ดูแลระบบให้ไว้</p>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
