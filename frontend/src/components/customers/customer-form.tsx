"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { CustomerInput, CustomerProfile } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Textarea } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";

type Field = keyof CustomerInput;
type FormState = Omit<Record<Field, string>, "tags" | "consentMarketing"> & { tags: string[]; consentMarketing: boolean };

const toForm = (c: CustomerProfile | null): FormState => ({
  name: c?.name ?? "",
  phone: c?.phone ?? "",
  email: c?.email ?? "",
  taxId: c?.taxId ?? "",
  branchNo: c?.branchNo ?? "",
  address: c?.address ?? "",
  tags: c?.tags ?? [],
  consentMarketing: c?.consentMarketing ?? false,
});

/** Add or edit a customer. Render inside a <Dialog>; `onSaved` receives the saved profile. */
export function CustomerFormDialog({
  customer,
  tagSuggestions = [],
  onSaved,
}: {
  customer: CustomerProfile | null;
  tagSuggestions?: string[];
  onSaved: (c: CustomerProfile) => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState<FormState>(() => toForm(customer));
  const [tagDraft, setTagDraft] = useState("");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setF((prev) => ({ ...prev, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const addTag = (raw: string) => {
    const t = raw.replace(/,/g, " ").trim().slice(0, 30);
    if (!t || f.tags.some((x) => x.toLowerCase() === t.toLowerCase()) || f.tags.length >= 20) return;
    set("tags", [...f.tags, t]);
    setTagDraft("");
  };

  const save = async () => {
    setBusy(true);
    setErrors({});
    const tags = tagDraft.trim() ? [...f.tags, tagDraft.trim()] : f.tags;
    const body: CustomerInput = {
      name: f.name,
      phone: f.phone || null,
      email: f.email || null,
      taxId: f.taxId || null,
      branchNo: f.branchNo || null,
      address: f.address || null,
      tags,
      consentMarketing: f.consentMarketing,
    };
    try {
      const saved = customer ? await api.patch<CustomerProfile>(`/customers/${customer.id}`, body) : await api.post<CustomerProfile>("/customers", body);
      toast.success(customer ? "บันทึกข้อมูลลูกค้าแล้ว" : `เพิ่มลูกค้า ${saved.name} แล้ว (${saved.memberNo})`);
      void qc.invalidateQueries({ queryKey: ["customers"] });
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        const next: Partial<Record<Field, string>> = {};
        for (const d of err.details as { path: string; message: string }[]) next[d.path.split(".")[0] as Field] ??= d.message;
        setErrors(next);
      }
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const text = (k: Exclude<Field, "tags" | "consentMarketing">, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`cust-${k}`}>{label}</Label>
      <Input id={`cust-${k}`} value={f[k]} onChange={(e) => set(k, e.target.value)} aria-invalid={Boolean(errors[k])} {...props} />
      <FieldError message={errors[k]} />
    </div>
  );
  const suggestions = tagSuggestions.filter((t) => !f.tags.includes(t)).slice(0, 8);

  return (
    <DialogContent
      title={customer ? "แก้ไขข้อมูลลูกค้า" : "เพิ่มลูกค้า"}
      description={customer ? (customer.memberNo ? `รหัสสมาชิก ${customer.memberNo}` : undefined) : "ระบบจะออกรหัสสมาชิกให้อัตโนมัติ"}
      className="max-w-xl"
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="sm:col-span-2">{text("name", "ชื่อลูกค้า / บริษัท *", { autoFocus: !customer, maxLength: 191 })}</div>
        {text("phone", "เบอร์โทร", { inputMode: "tel", placeholder: "0812345678" })}
        {text("email", "อีเมล", { type: "email", placeholder: "name@example.com" })}
        {text("taxId", "เลขผู้เสียภาษี (ใบกำกับเต็มรูป)", { inputMode: "numeric", placeholder: "13 หลัก" })}
        {text("branchNo", "สาขา", { inputMode: "numeric", placeholder: "00000 = สำนักงานใหญ่", maxLength: 5 })}
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="cust-address">ที่อยู่ (สำหรับใบกำกับภาษี / จัดส่ง)</Label>
          <Textarea id="cust-address" rows={2} value={f.address} onChange={(e) => set("address", e.target.value)} aria-invalid={Boolean(errors.address)} />
          <FieldError message={errors.address} />
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="cust-tags">แท็ก</Label>
          <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-card px-2 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20">
            {f.tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary">
                {t}
                <button
                  type="button"
                  aria-label={`ลบแท็ก ${t}`}
                  onClick={() =>
                    set(
                      "tags",
                      f.tags.filter((x) => x !== t),
                    )
                  }
                  className="hover:text-danger"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <input
              id="cust-tags"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag(tagDraft);
                } else if (e.key === "Backspace" && !tagDraft && f.tags.length) set("tags", f.tags.slice(0, -1));
              }}
              onBlur={() => addTag(tagDraft)}
              placeholder={f.tags.length ? "" : "เช่น VIP, ขายส่ง แล้วกด Enter"}
              className="h-6 min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => addTag(t)}
                  className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
                >
                  <Plus className="size-3" />
                  {t}
                </button>
              ))}
            </div>
          )}
          <FieldError message={errors.tags} />
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={f.consentMarketing}
            onChange={(e) => set("consentMarketing", e.target.checked)}
            className="mt-0.5 accent-[var(--primary)]"
          />
          <span>
            ยินยอมรับข่าวสารและโปรโมชัน
            <span className="block text-xs text-muted-foreground">ตาม PDPA — ส่งข้อความการตลาดได้เฉพาะลูกค้าที่ยินยอมแล้วเท่านั้น</span>
          </span>
        </label>

        <Button type="submit" className="sm:col-span-2" disabled={busy || !f.name.trim()}>
          {busy && <Loader2 className="animate-spin" />}
          {customer ? "บันทึก" : "เพิ่มลูกค้า"}
        </Button>
      </form>
    </DialogContent>
  );
}
