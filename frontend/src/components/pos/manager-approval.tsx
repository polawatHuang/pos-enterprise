"use client";

import { useState, useSyncExternalStore } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";

/** What a manager's PIN unlocks on this till, for one sale or one bill. */
export type ApprovalAction = "refund" | "void" | "override";
const ACTION_LABEL: Record<ApprovalAction, string> = {
  refund: "คืนสินค้า / คืนเงิน",
  void: "ยกเลิกบิล",
  override: "ส่วนลดหรือราคาเกินสิทธิ์แคชเชียร์",
};

type Pending = { action: ApprovalAction; resolve: (token: string | null) => void } | null;
let pending: Pending = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

function requestPin(action: ApprovalAction) {
  return new Promise<string | null>((resolve) => {
    pending?.resolve(null);
    pending = { action, resolve };
    emit();
  });
}

export class ApprovalCancelled extends Error {
  constructor() {
    super("ยกเลิกการขออนุมัติ");
  }
}

/**
 * Runs `call`; when the server answers that a manager must approve, asks for a manager's PIN on this
 * screen and runs it once more with the approval ticket. Managers never see the PIN box.
 */
export async function withApproval<T>(action: ApprovalAction, call: (headers?: Record<string, string>) => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (!(err instanceof ApiError && err.code === "MANAGER_APPROVAL")) throw err;
    const token = await requestPin(action);
    if (!token) throw new ApprovalCancelled();
    return call({ "x-manager-approval": token });
  }
}

/** The PIN box; rendered once on the POS screen. */
export function ManagerPinHost() {
  const current = useSyncExternalStore(subscribe, () => pending, () => null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const finish = (token: string | null) => {
    current?.resolve(token);
    pending = null;
    setPin("");
    setError("");
    emit();
  };
  const submit = async () => {
    if (!current) return;
    setBusy(true);
    setError("");
    try {
      const r = await api.post<{ token: string; managerName: string }>("/pos/approvals", { pin, action: current.action });
      finish(r.token);
    } catch (err) {
      setPin("");
      setError(err instanceof Error ? err.message : "อนุมัติไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!current} onOpenChange={(o) => !o && finish(null)}>
      {current && (
        <DialogContent title="ให้ผู้จัดการอนุมัติ" description={`งานนี้ต้องให้ผู้จัดการยืนยัน: ${ACTION_LABEL[current.action]}`} className="max-w-sm">
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="flex items-center gap-3 rounded-xl bg-muted p-3 text-sm">
              <ShieldCheck className="size-6 shrink-0 text-primary" />
              ส่งเครื่องให้ผู้จัดการกรอก PIN 4–6 หลัก (ผู้จัดการตั้ง PIN ได้ที่หน้า บัญชีของฉัน)
            </div>
            <Input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="PIN ผู้จัดการ"
              aria-label="PIN ผู้จัดการ"
              className="h-14 text-center text-2xl tracking-[0.5em] placeholder:text-base placeholder:tracking-normal"
              autoFocus
            />
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" onClick={() => finish(null)}>
                ยกเลิก
              </Button>
              <Button type="submit" disabled={busy || pin.length < 4}>
                {busy && <Loader2 className="animate-spin" />} อนุมัติ
              </Button>
            </div>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
