"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Circle, Store, Users, Package, ShoppingCart } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

interface Activation {
  activeBranches: number;
  activeProducts: number;
  activeStaff: number;
  salesOrders: number;
  firstSaleAt: string | null;
  daysToFirstSale: number | null;
}

export function StoreSetup() {
  const { can } = useAuth();
  const activation = useQuery({
    queryKey: ["dashboard", "activation"],
    queryFn: () => api.get<Activation>("/dashboard/activation"),
  });

  if (activation.isPending) return null;
  if (activation.isError) {
    return (
      <Card className="mb-5 border-warning/30">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p role="alert" className="text-sm text-warning">โหลดสถานะการเริ่มต้นใช้งานไม่สำเร็จ</p>
          <Button size="sm" variant="outline" onClick={() => void activation.refetch()}>ลองอีกครั้ง</Button>
        </CardContent>
      </Card>
    );
  }

  const data = activation.data;
  const steps = [
    { title: "ตรวจสอบสาขา", detail: "เตรียมสาขาและคลังสำหรับขาย", complete: data.activeBranches > 0, href: "/settings/branches", allowed: can("settings:manage"), icon: Store },
    { title: "เพิ่มสินค้า", detail: "เพิ่มสินค้าเพื่อให้พร้อมขายและติดตามสต๊อก", complete: data.activeProducts > 0, href: "/products", allowed: can("products:read"), icon: Package },
    { title: "เพิ่มทีมงาน", detail: "เชิญพนักงานและกำหนดสิทธิ์การใช้งาน", complete: data.activeStaff > 1, href: "/settings/users", allowed: can("users:write"), icon: Users },
    { title: "บันทึกยอดขายแรก", detail: "เปิดหน้าขายและเริ่มใช้งาน POS", complete: data.salesOrders > 0, href: "/pos", allowed: can("pos:sell"), icon: ShoppingCart },
  ];
  const completed = steps.filter((step) => step.complete).length;
  const allComplete = completed === steps.length;

  return (
    <Card className="relative mb-5 overflow-hidden border-primary/20 bg-gradient-to-br from-primary-soft/50 via-card to-card">
      <CardHeader className="flex-wrap items-center gap-3">
        <div>
          <CardTitle>{allComplete ? "ร้านของคุณพร้อมใช้งานแล้ว" : "เริ่มต้นใช้งานร้าน"}</CardTitle>
          <CardDescription>
            {allComplete
              ? `ตั้งค่าพื้นฐานครบแล้ว${data.daysToFirstSale != null ? ` · เริ่มขายได้ใน ${data.daysToFirstSale} วัน` : ""}`
              : "เช็กลิสต์ช่วยตั้งค่าร้านค้าปลีกให้พร้อมขายและติดตามสต๊อก"}
          </CardDescription>
        </div>
        <span className="ml-auto text-sm font-semibold tabular-nums text-primary">{completed}/{steps.length} ขั้นตอน</span>
      </CardHeader>
      <CardContent>
        <div
          className="mb-4 h-2 overflow-hidden rounded-full bg-primary/10"
          role="progressbar"
          aria-label="ความคืบหน้าการตั้งค่าร้าน"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={completed}
        >
          <div className="h-full rounded-full bg-gradient-to-r from-primary to-chart-2 transition-[width]" style={{ width: `${(completed / steps.length) * 100}%` }} />
        </div>
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {steps.map((step) => {
            const Icon = step.icon;
            const content = (
              <>
                <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", step.complete ? "bg-success-soft text-success" : "bg-muted text-muted-foreground")}>
                  {step.complete ? <Check className="size-4" /> : <Icon className="size-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm font-medium", step.complete && "text-muted-foreground")}>{step.title}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{step.complete ? "เรียบร้อย" : step.detail}</span>
                </span>
                {!step.complete && step.allowed && <ArrowRight className="size-4 shrink-0 text-primary" />}
                {!step.complete && !step.allowed && <Circle className="size-4 shrink-0 text-muted-foreground" />}
              </>
            );
            return (
              <li key={step.title}>
                {step.allowed && !step.complete ? (
                  <Link href={step.href} className="flex min-h-[68px] items-center gap-3 rounded-xl border border-border bg-card/80 p-3 transition-colors hover:border-primary/40 hover:bg-primary/5">
                    {content}
                  </Link>
                ) : (
                  <div className="flex min-h-[68px] items-center gap-3 rounded-xl border border-border/70 bg-card/60 p-3">
                    {content}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
