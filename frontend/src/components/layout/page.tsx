"use client";

import type { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Renders children only when the user holds `permission`; otherwise a 403 state. */
export function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = useAuth();
  if (can(permission)) return <>{children}</>;
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-danger-soft text-danger">
        <ShieldAlert className="size-7" />
      </div>
      <h1 className="mt-5 text-xl font-semibold">ไม่มีสิทธิ์เข้าถึงหน้านี้</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        บัญชีของคุณไม่มีสิทธิ์ <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{permission}</code> กรุณาติดต่อผู้ดูแลระบบ
      </p>
    </div>
  );
}
