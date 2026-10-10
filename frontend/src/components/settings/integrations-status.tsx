"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleDashed, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import type { IntegrationStatus } from "@/lib/types";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { PageHeader } from "@/components/layout/page";

const CATEGORY_LABEL: Record<string, string> = {
  ai: "AI",
  social: "โซเชียล",
  commerce: "มาร์เก็ตเพลส",
  chat: "แชต",
  video: "วิดีโอ AI",
  storage: "พื้นที่เก็บไฟล์",
};

export function IntegrationsStatus() {
  const { data, isPending } = useQuery({
    queryKey: ["integrations", "status"],
    queryFn: () => api.get<IntegrationStatus[]>("/integrations/status"),
  });
  const configured = data?.filter((d) => d.configured).length ?? 0;

  return (
    <>
      <PageHeader
        title="การเชื่อมต่อ API"
        description="คีย์ทั้งหมดตั้งค่าเป็น environment variables บนเซิร์ฟเวอร์ backend (Plesk) — หน้านี้แสดงเฉพาะสถานะ ไม่แสดงค่าคีย์"
        actions={data && <Badge tone={configured === data.length ? "success" : "warning"}>{configured}/{data.length} พร้อมใช้งาน</Badge>}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {isPending
          ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-52 rounded-xl" />)
          : data?.map((it) => (
              <Card key={it.id} className="flex flex-col p-5">
                <div className="flex items-start gap-3">
                  {it.configured ? (
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
                  ) : (
                    <CircleDashed className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0">
                    <h2 className="font-semibold leading-tight">{it.name}</h2>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <Badge>{CATEGORY_LABEL[it.category] ?? it.category}</Badge>
                      <Badge tone="primary">ใช้ในเฟส {it.phase}</Badge>
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">{it.purpose}</p>
                <ul className="mt-3 space-y-1">
                  {it.env.map((e) => (
                    <li key={e.name} className="flex items-center gap-2 font-mono text-[11px]">
                      <span className={e.set ? "text-success" : e.optional ? "text-muted-foreground" : "text-danger"}>{e.set ? "●" : "○"}</span>
                      {e.name}
                      {e.optional && <span className="font-sans text-muted-foreground">(ไม่บังคับ)</span>}
                    </li>
                  ))}
                </ul>
                <a
                  href={it.applyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-medium text-primary hover:underline"
                >
                  ขอ API key <ExternalLink className="size-3.5" />
                </a>
              </Card>
            ))}
      </div>
    </>
  );
}
