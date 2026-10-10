"use client";

import Link from "next/link";
import { CheckCircle2, KeyRound, Rocket } from "lucide-react";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { PageHeader, RequirePermission } from "./page";
import { findNavItem } from "@/config/nav";
import { useAuth } from "@/components/auth/auth-provider";

export interface ModuleSpec {
  href: string;
  description: string;
  features: string[];
  /** Third-party keys this module needs (names match /settings/integrations) */
  keys: string[];
  notes?: string[];
}

/** Placeholder for modules delivered in later phases: shows scope and required API keys. */
export function ModulePlaceholder({ spec }: { spec: ModuleSpec }) {
  const nav = findNavItem(spec.href)!;
  const { can } = useAuth();
  const Icon = nav.icon;
  return (
    <RequirePermission permission={nav.permission}>
      <PageHeader title={nav.label} description={spec.description} actions={<Badge tone="primary">ส่งมอบในเฟส {nav.phase}</Badge>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Icon className="size-4 text-primary" /> ขอบเขตของโมดูล
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3 sm:grid-cols-2">
              {spec.features.map((f) => (
                <li key={f} className="flex gap-2.5 text-sm">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  {f}
                </li>
              ))}
            </ul>
            {spec.notes && (
              <div className="mt-5 space-y-2 rounded-lg bg-warning-soft p-4 text-sm text-warning">
                {spec.notes.map((n) => (
                  <p key={n}>⚠️ {n}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4 text-primary" /> สิ่งที่ต้องเตรียม
            </CardTitle>
          </CardHeader>
          <CardContent>
            {spec.keys.length ? (
              <ul className="space-y-2 text-sm">
                {spec.keys.map((k) => (
                  <li key={k} className="rounded-md bg-muted px-3 py-2">
                    {k}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">ไม่ต้องใช้ API ภายนอก</p>
            )}
            {can("integrations:manage") && spec.keys.length > 0 && (
              <Link href="/settings/integrations" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
                ดูสถานะการตั้งค่า API →
              </Link>
            )}
            <div className="mt-6 flex items-start gap-2 text-xs text-muted-foreground">
              <Rocket className="size-4 shrink-0" />
              โครงสร้างฐานข้อมูล, API route และสิทธิ์ของโมดูลนี้เตรียมไว้แล้วในเฟส 1
            </div>
          </CardContent>
        </Card>
      </div>
    </RequirePermission>
  );
}
