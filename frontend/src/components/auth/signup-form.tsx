"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, api } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function SignupForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await api.post("/saas/signup", {
        organizationName: data.get("organizationName"),
        fullName: data.get("fullName"),
        email: data.get("email"),
        password: data.get("password"),
        acceptTerms: data.get("acceptTerms") === "on",
      });
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "สมัครใช้งานไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">ชื่อกิจการ</span>
        <input name="organizationName" autoComplete="organization" required minLength={2} maxLength={191} className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" placeholder="เช่น ร้านของฉัน" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">ชื่อผู้ดูแลกิจการ</span>
        <input name="fullName" autoComplete="name" required maxLength={191} className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" placeholder="ชื่อและนามสกุล" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">อีเมล</span>
        <input name="email" type="email" autoComplete="email" required maxLength={191} className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" placeholder="you@company.com" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">รหัสผ่าน</span>
        <input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} pattern="(?=.*[A-Za-z])(?=.*\d).{8,128}" title="อย่างน้อย 8 ตัวอักษร มีตัวอักษรอังกฤษและตัวเลข" className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" placeholder="อย่างน้อย 8 ตัวอักษร มีตัวอักษรและตัวเลข" />
      </label>
      <label className="flex items-start gap-2.5 text-xs leading-5 text-muted-foreground">
        <input name="acceptTerms" type="checkbox" required className="mt-1 size-4 shrink-0 accent-violet-600" />
        <span>ฉันยอมรับ <Link href="/terms" className="font-medium text-primary underline underline-offset-2">ข้อกำหนดการใช้บริการ</Link> และ <Link href="/privacy" className="font-medium text-primary underline underline-offset-2">นโยบายความเป็นส่วนตัว</Link></span>
      </label>
      {error && <p role="alert" className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <Button type="submit" className="h-11 w-full" disabled={busy}>{busy ? "กำลังสร้างบัญชี..." : "เริ่มทดลองใช้ 14 วัน"}</Button>
      <p className="text-center text-xs leading-5 text-muted-foreground">ไม่ผูกบัตร · ไม่ได้รับเครดิตฟรี AI · AI ใช้งานได้เมื่อเติมเครดิต</p>
    </form>
  );
}
