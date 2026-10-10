"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, FieldError, Input, Label } from "@/components/ui/primitives";
import { PageHeader } from "@/components/layout/page";
import { useAuth, ME_QUERY_KEY } from "@/components/auth/auth-provider";
import { ROLE_LABELS } from "@/components/layout/user-menu";
import { api, ApiError } from "@/lib/api";
import type { User } from "@/lib/types";
import { homeFor } from "@/config/nav";

export const passwordRule = z
  .string()
  .min(8, "อย่างน้อย 8 ตัวอักษร")
  .regex(/[A-Za-z]/, "ต้องมีตัวอักษรภาษาอังกฤษ")
  .regex(/\d/, "ต้องมีตัวเลข");

const schema = z
  .object({
    currentPassword: z.string().min(1, "กรุณากรอกรหัสผ่านปัจจุบัน"),
    newPassword: passwordRule,
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ["confirm"], message: "รหัสผ่านไม่ตรงกัน" });
type Values = z.infer<typeof schema>;

export function AccountSettings() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  if (!user) return null;

  const onSubmit = async (v: Values) => {
    try {
      const { user: updated } = await api.post<{ user: User }>("/auth/change-password", {
        currentPassword: v.currentPassword,
        newPassword: v.newPassword,
      });
      qc.setQueryData(ME_QUERY_KEY, updated);
      reset();
      toast.success("เปลี่ยนรหัสผ่านเรียบร้อย อุปกรณ์อื่นถูกออกจากระบบแล้ว");
      if (user.mustChangePassword) window.location.assign(homeFor(updated.permissions));
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setError("currentPassword", { message: err.message });
      else toast.error(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    }
  };

  return (
    <>
      <PageHeader title="บัญชีของฉัน" description="ข้อมูลผู้ใช้และความปลอดภัย" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>ข้อมูลผู้ใช้</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-muted-foreground">ชื่อ</dt>
                <dd className="font-medium">{user.fullName}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">อีเมล</dt>
                <dd className="font-medium">{user.email}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">บทบาท</dt>
                <dd className="font-medium">{user.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">จำนวนสิทธิ์</dt>
                <dd className="font-medium">{user.permissions.length} สิทธิ์</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>เปลี่ยนรหัสผ่าน</CardTitle>
              <CardDescription>
                {user.mustChangePassword
                  ? "นี่คือการเข้าสู่ระบบครั้งแรก กรุณาตั้งรหัสผ่านใหม่ของคุณเองก่อนใช้งาน"
                  : "เมื่อเปลี่ยนแล้ว อุปกรณ์อื่นที่เข้าสู่ระบบไว้จะถูกออกจากระบบ"}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="grid max-w-md gap-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="currentPassword">รหัสผ่านปัจจุบัน</Label>
                <Input id="currentPassword" type="password" autoComplete="current-password" aria-invalid={!!errors.currentPassword} {...register("currentPassword")} />
                <FieldError message={errors.currentPassword?.message} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newPassword">รหัสผ่านใหม่</Label>
                <Input id="newPassword" type="password" autoComplete="new-password" aria-invalid={!!errors.newPassword} {...register("newPassword")} />
                <FieldError message={errors.newPassword?.message} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">ยืนยันรหัสผ่านใหม่</Label>
                <Input id="confirm" type="password" autoComplete="new-password" aria-invalid={!!errors.confirm} {...register("confirm")} />
                <FieldError message={errors.confirm?.message} />
              </div>
              <Button type="submit" disabled={isSubmitting} className="w-fit">
                {isSubmitting && <Loader2 className="animate-spin" />}
                บันทึกรหัสผ่านใหม่
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
