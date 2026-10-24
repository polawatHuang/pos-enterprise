"use client";

import { useState } from "react";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";
import { useOnline } from "@/lib/reachability";
import { formatDateTime, formatMoney } from "@/lib/utils";
import { removeBill, retryBill, syncBills, useOfflineBills } from "./offline";

/** Cash bills sold while the internet was down: what is waiting, and what the system refused. */
export function OfflineBillsDialog({ onSynced }: { onSynced: () => void }) {
  const { user, can } = useAuth();
  const online = useOnline();
  const bills = useOfflineBills();
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const r = await syncBills(user.id);
      if (r.sent) toast.success(`ส่งบิล ${r.sent} ใบเข้าระบบแล้ว`);
      if (r.failed) toast.error(`ระบบไม่รับ ${r.failed} ใบ — ดูเหตุผลในรายการ`);
      onSynced();
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent title="บิลออฟไลน์" description="บิลเงินสดที่ขายตอนเน็ตหลุด เก็บไว้ในเครื่องนี้และส่งเข้าระบบเองเมื่อเน็ตกลับ" className="max-w-xl">
      {bills.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">ไม่มีบิลค้างส่ง</p>
      ) : (
        <ul className="divide-y divide-border">
          {bills.map((b) => (
            <li key={b.clientRef} className="py-3 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{b.summary.orderNo}</span>
                <Badge tone={b.status === "failed" ? "danger" : "warning"}>{b.status === "failed" ? "ระบบไม่รับ" : "รอส่ง"}</Badge>
                <span className="text-muted-foreground">
                  {formatDateTime(b.soldAt)} · {b.summary.units} ชิ้น · {b.userName}
                </span>
                <span className="ml-auto font-semibold tabular-nums">{formatMoney(b.summary.total)}</span>
              </div>
              {b.error && <p className="mt-1 text-danger">{b.error}</p>}
              {b.status === "failed" && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="h-10" onClick={() => void retryBill(b.clientRef).then(send)}>
                    <RefreshCw /> ลองส่งใหม่
                  </Button>
                  {can("pos:manage") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-10 text-danger"
                      onClick={() => {
                        if (window.confirm(`ลบบิล ${b.summary.orderNo} (${formatMoney(b.summary.total)}) ออกจากเครื่อง? เงินที่รับมาจะไม่มีบิลในระบบ`))
                          void removeBill(b.clientRef);
                      }}
                    >
                      <Trash2 /> ลบออกจากเครื่อง
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{online ? "ออนไลน์อยู่" : "ยังออฟไลน์ — จะส่งเมื่อเน็ตกลับ"}</p>
        <Button onClick={() => void send()} disabled={busy || !online || !bills.some((b) => b.status === "queued" && b.userId === user?.id)}>
          {busy && <Loader2 className="animate-spin" />} ส่งตอนนี้
        </Button>
      </div>
    </DialogContent>
  );
}
