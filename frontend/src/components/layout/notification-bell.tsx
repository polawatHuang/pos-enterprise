"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, CheckCheck, Info, PackageX } from "lucide-react";
import { api } from "@/lib/api";
import type { AppNotification } from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/overlays";

const ICON = { danger: PackageX, warning: AlertTriangle, info: Info } as const;
const TONE = { danger: "bg-danger-soft text-danger", warning: "bg-warning-soft text-warning", info: "bg-primary-soft text-primary" } as const;

/** Top-bar bell: unread badge (polled every minute) and the latest alerts. */
export function NotificationBell() {
  const qc = useQueryClient();
  const unread = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () => api.get<{ count: number }>("/notifications/unread-count"),
    refetchInterval: 60_000,
  });
  const list = useQuery({ queryKey: ["notifications", "list"], queryFn: () => api.get<AppNotification[]>("/notifications", { limit: 20 }) });
  const count = unread.data?.count ?? 0;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["notifications"] });
  };
  const read = async (n: AppNotification) => {
    if (!n.read) await api.post(`/notifications/${n.id}/read`).catch(() => undefined);
    refresh();
  };

  return (
    <DropdownMenu onOpenChange={(o) => o && void list.refetch()}>
      <DropdownMenuTrigger asChild>
        <button className="relative grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-accent" aria-label={`แจ้งเตือน ${count} รายการใหม่`}>
          <Bell className="size-5" />
          {count > 0 && (
            <span className="absolute right-0.5 top-0.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-white" data-testid="bell-count">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(92vw,380px)] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <p className="font-semibold">แจ้งเตือน</p>
          {count > 0 && (
            <button
              className="flex items-center gap-1 text-xs text-primary hover:underline"
              onClick={() => void api.post("/notifications/read-all").then(refresh)}
            >
              <CheckCheck className="size-3.5" /> อ่านทั้งหมด
            </button>
          )}
        </div>
        <ul className="max-h-[70dvh] overflow-y-auto">
          {list.data?.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted-foreground">ยังไม่มีแจ้งเตือน</li>}
          {list.data?.map((n) => {
            const Icon = ICON[n.severity];
            const body = (
              <div className={cn("flex gap-3 px-4 py-3 text-sm", !n.read && "bg-primary-soft/30")}>
                <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", TONE[n.severity])}>
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block", !n.read && "font-semibold")}>{n.title}</span>
                  {n.body && <span className="line-clamp-3 whitespace-pre-line text-xs text-muted-foreground">{n.body}</span>}
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">{formatRelativeTime(n.createdAt)}</span>
                </span>
                {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
              </div>
            );
            return (
              <li key={n.id} className="border-b border-border last:border-0">
                {n.link ? (
                  <Link href={n.link} onClick={() => void read(n)} className="block hover:bg-accent/60">
                    {body}
                  </Link>
                ) : (
                  <button onClick={() => void read(n)} className="block w-full text-left hover:bg-accent/60">
                    {body}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
