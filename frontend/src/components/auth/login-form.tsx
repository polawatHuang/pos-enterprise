"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/primitives";
import { api, ApiError } from "@/lib/api";
import type { User } from "@/lib/types";
import { findNavItem, hasPermission, homeFor } from "@/config/nav";

const schema = z.object({
  email: z.email("กรุณากรอกอีเมลให้ถูกต้อง"),
  password: z.string().min(1, "กรุณากรอกรหัสผ่าน"),
});
type FormValues = z.infer<typeof schema>;

/**
 * Post-login destination: the requested page if it is a same-site path the user may open,
 * otherwise the first page their role allows (e.g. a cashier lands on POS, not the dashboard).
 */
function postLoginTarget(user: User) {
  const home = homeFor(user.permissions);
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//")) return home;
  const item = findNavItem(next.split("?")[0]);
  return item && !hasPermission(user.permissions, item.permission) ? home : next;
}

export function LoginForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    try {
      const { user } = await api.post<{ user: User }>("/auth/login", values);
      const target = user.mustChangePassword ? "/settings/account?first=1" : postLoginTarget(user);
      // Full navigation so the app shell boots with the fresh session cookies
      window.location.assign(target);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-5" noValidate>
      {serverError && (
        <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger">
          {serverError}
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="email">อีเมล</Label>
        <Input id="email" type="email" autoComplete="username" placeholder="you@company.com" aria-invalid={!!errors.email} {...register("email")} />
        <FieldError message={errors.email?.message} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">รหัสผ่าน</Label>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            className="pr-10"
            aria-invalid={!!errors.password}
            {...register("password")}
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
            aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <FieldError message={errors.password?.message} />
      </div>
      <Button type="submit" className="w-full" size="lg" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="animate-spin" />}
        เข้าสู่ระบบ
      </Button>
      <p className="text-center text-xs text-muted-foreground">ลืมรหัสผ่าน? ติดต่อผู้ดูแลระบบขององค์กรเพื่อรีเซ็ต</p>
    </form>
  );
}
