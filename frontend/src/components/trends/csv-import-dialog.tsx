"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label, NativeSelect } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";
import { CSV_FIELDS, TREND_PLATFORM } from "./labels";

interface Preview {
  header: string[];
  mapping: Record<string, number>;
  rows: { title: string; price: number | null; soldCount: number | null; commissionRate: number | null; shopName: string | null }[];
  total: number;
  errors: { row: number; message: string }[];
}

const MAX_BYTES = 2 * 1024 * 1024;

/** Upload an export (Seller Center, analytics tools) → preview with detected columns → import. */
export function CsvImportDialog({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [platform, setPlatform] = useState("tiktok_shop");
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  const loadPreview = async (text: string, map?: Record<string, number>) => {
    setBusy(true);
    try {
      const p = await api.post<Preview>("/scraping/trends/import-csv", { csv: text, platform, preview: true, mapping: map });
      setPreview(p);
      setMapping(p.mapping);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "อ่านไฟล์ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) return toast.error("ไฟล์ใหญ่เกิน 2 MB");
    if (/\.xlsx?$/i.test(file.name)) return toast.error("กรุณาบันทึกเป็น CSV ก่อน (Excel: ไฟล์ → บันทึกเป็น → CSV UTF-8)");
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    await loadPreview(text);
  };

  const remap = (field: string, idx: string) => {
    const next = { ...mapping };
    if (idx === "") delete next[field];
    else next[field] = Number(idx);
    setMapping(next);
    if (csv) void loadPreview(csv, next);
  };

  const submit = async () => {
    if (!csv) return;
    setBusy(true);
    try {
      const r = await api.post<{ found: number; created: number; skipped: number }>("/scraping/trends/import-csv", { csv, platform, mapping });
      toast.success(`นำเข้า ${r.found} รายการ (ใหม่ ${r.created})`);
      await qc.invalidateQueries({ queryKey: ["trends"] });
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "นำเข้าไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent
      title="นำเข้าสินค้าเทรนด์จาก CSV"
      description="ใช้ไฟล์ export จาก Seller Center หรือเครื่องมือวิเคราะห์ตลาด ระบบจับคู่คอลัมน์ให้อัตโนมัติ (ไทย/อังกฤษ) นำเข้าซ้ำได้ ระบบจะอัปเดตและเก็บประวัติยอดขาย"
      className="max-w-2xl"
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="csv-platform">แพลตฟอร์มของข้อมูล</Label>
            <NativeSelect id="csv-platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              {Object.entries(TREND_PLATFORM).map(([v, p]) => (
                <option key={v} value={v}>
                  {p.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="csv-file">ไฟล์ CSV (≤ 2 MB)</Label>
            <label
              htmlFor="csv-file"
              className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-3 text-sm text-muted-foreground hover:bg-accent"
            >
              <FileUp className="size-4 shrink-0" />
              <span className="truncate">{fileName || "เลือกไฟล์…"}</span>
            </label>
            <input id="csv-file" type="file" accept=".csv,text/csv,.tsv,text/tab-separated-values" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
          </div>
        </div>

        {preview && (
          <>
            <div>
              <p className="mb-2 text-sm font-medium">จับคู่คอลัมน์</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {CSV_FIELDS.map((f) => (
                  <div key={f.key} className="space-y-1">
                    <Label htmlFor={`map-${f.key}`} className="text-xs">
                      {f.label}
                    </Label>
                    <NativeSelect id={`map-${f.key}`} value={mapping[f.key] ?? ""} onChange={(e) => remap(f.key, e.target.value)} className="h-8 text-xs">
                      <option value="">— ไม่ใช้ —</option>
                      {preview.header.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `คอลัมน์ ${i + 1}`}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[480px] text-xs">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">ชื่อสินค้า</th>
                    <th className="px-3 py-2 text-right font-medium">ราคา</th>
                    <th className="px-3 py-2 text-right font-medium">ยอดขาย</th>
                    <th className="px-3 py-2 text-right font-medium">ค่าคอม</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.rows.map((r, i) => (
                    <tr key={i}>
                      <td className="max-w-[240px] truncate px-3 py-1.5">{r.title}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.price ?? "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.soldCount ?? "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.commissionRate == null ? "—" : `${r.commissionRate}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              พร้อมนำเข้า {preview.total} แถว (แสดง {preview.rows.length} แถวแรก)
              {preview.errors.length > 0 && (
                <span className="text-warning"> · ข้าม {preview.errors.length} แถว: {preview.errors.slice(0, 3).map((e) => `แถว ${e.row} ${e.message}`).join(", ")}</span>
              )}
            </p>
          </>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            ยกเลิก
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !preview?.total}>
            {busy && <Loader2 className="animate-spin" />} นำเข้า {preview?.total ? `${preview.total} รายการ` : ""}
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}
