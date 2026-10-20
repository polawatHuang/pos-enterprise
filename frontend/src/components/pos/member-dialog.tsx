"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Loader2, UserPlus, UserRound } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { PosMember } from "@/lib/types";
import { formatMoney, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";

/** Find a member by phone / member no. / name, or sign one up in two fields (Wongnai/7-Eleven style). */
export function MemberDialog({ onPick }: { onPick: (m: PosMember) => void }) {
  const [q, setQ] = useState("");
  const [signup, setSignup] = useState(false);
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const term = q.trim();
  const found = useQuery({
    queryKey: ["pos", "members", term],
    queryFn: () => api.get<PosMember[]>("/pos/customers", { q: term }),
    enabled: term.length >= 3,
    placeholderData: keepPreviousData,
  });
  const phone = term.replace(/\D/g, "");

  const register = async () => {
    setBusy(true);
    try {
      const m = await api.post<PosMember>("/pos/customers", { name, phone, consentMarketing: consent });
      toast.success(`สมัครสมาชิกแล้ว ${m.memberNo}`);
      onPick(m);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "สมัครไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent title="สมาชิก" description="ค้นด้วยเบอร์โทร รหัสสมาชิก หรือชื่อ" className="max-w-md">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="เช่น 0812345678 หรือ M000012"
        inputMode="search"
        className="h-12 text-lg"
        aria-label="ค้นหาสมาชิก"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && found.data?.length === 1) onPick(found.data[0]);
        }}
      />
      <ul className="mt-3 space-y-1.5">
        {found.isFetching && !found.data && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />}
        {found.data?.map((m) => (
          <li key={m.id}>
            <button onClick={() => onPick(m)} className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left hover:border-primary hover:bg-primary-soft/40">
              <span className="grid size-9 place-items-center rounded-full bg-primary-soft text-primary">
                <UserRound className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{m.name}</span>
                <span className="text-xs text-muted-foreground">
                  {m.memberNo} · {m.phone} · ซื้อแล้ว {formatMoney(m.totalSpent)}
                </span>
              </span>
              <span className="text-right">
                <span className="block text-lg font-semibold text-primary tabular-nums">{formatNumber(m.points)}</span>
                <span className="text-[11px] text-muted-foreground">แต้ม</span>
              </span>
            </button>
          </li>
        ))}
        {term.length >= 3 && found.data?.length === 0 && <li className="py-3 text-center text-sm text-muted-foreground">ไม่พบสมาชิก</li>}
      </ul>
      {signup ? (
        <form
          className="mt-4 grid gap-3 rounded-xl border border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void register();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="m-name">ชื่อ</Label>
            <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <p className="text-sm">
            เบอร์โทร <span className="font-medium">{phone || "— พิมพ์เบอร์ในช่องค้นหา"}</span>
          </p>
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
            ลูกค้ายินยอมรับข่าวสารโปรโมชั่น (PDPA)
          </label>
          <Button type="submit" disabled={busy || !name.trim() || !/^0\d{8,9}$/.test(phone)}>
            {busy && <Loader2 className="animate-spin" />}
            สมัครและใช้กับบิลนี้
          </Button>
        </form>
      ) : (
        <Button variant="outline" className="mt-4 w-full" onClick={() => setSignup(true)}>
          <UserPlus /> สมัครสมาชิกใหม่
        </Button>
      )}
    </DialogContent>
  );
}
