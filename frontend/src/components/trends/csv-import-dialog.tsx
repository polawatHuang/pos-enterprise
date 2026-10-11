"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { CsvTemplate } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Label, NativeSelect } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";
import { CSV_FIELDS, TREND_PLATFORM } from "./labels";

interface Preview {
  header: string[];
  mapping: Record<string, number>;
  rows: {
    title: string;
    price: number | null;
    soldCount: number | null;
    commissionRate: number | null;
    shopName: string | null;
    category: string | null;
    categoryRank: number | null;
  }[];
  total: number;
  errors: { row: number; message: string }[];
}

const MAX_BYTES = 2 * 1024 * 1024;

/** Save the sample with a UTF-8 BOM so Excel shows Thai text correctly. */
function downloadCsv(t: CsvTemplate) {
  const url = URL.createObjectURL(new Blob(["\uFEFF", t.csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = t.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Upload an export (Seller Center, analytics tools) → preview with detected columns → import. */
export function CsvImportDialog({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [platform, setPlatform] = useState("tiktok_shop");
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [isSample, setIsSample] = useState(false);
  const template = useQuery({
    queryKey: ["trends", "csv-template"],
    queryFn: () => api.get<CsvTemplate>("/scraping/csv-template"),
    staleTime: Infinity,
  });

  const loadPreview = async (text: string, map?: Record<string, number>, sample = false) => {
    setBusy(true);
    try {
      const p = await api.post<Preview>("/scraping/trends/import-csv", { csv: text, platform, preview: true, mapping: map, allowSample: sample });
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
    setIsSample(false);
    await loadPreview(text);
  };

  const trySample = async () => {
    if (!template.data) return;
    setCsv(template.data.csv);
    setFileName(template.data.filename);
    setIsSample(true);
    await loadPreview(template.data.csv, undefined, true);
  };

  const remap = (field: string, idx: string) => {
    const next = { ...mapping };
    if (idx === "") delete next[field];
    else next[field] = Number(idx);
    setMapping(next);
    if (csv) void loadPreview(csv, next, isSample);
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
        <TemplateHelp template={template.data} loading={template.isPending} error={template.isError} busy={busy} onTry={() => void trySample()} />

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="csv-platform">แพลตฟอร์มของข้อมูล</Label>
            <NativeSelect id="csv-platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              {Object.entries(TREND_PLATFORM).map(([v, p]) => (
                <option key={v} value={v}>
                  {p.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="csv-file">ไฟล์ CSV (≤ 2 MB)</Label>
            <label
              htmlFor="csv-file"
              className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-3 text-sm text-muted-foreground hover:bg-accent"
            >
              <FileUp className="size-4 shrink-0" />
              <span className="truncate">{fileName || "เลือกไฟล์…"}</span>
            </label>
            <input
              id="csv-file"
              type="file"
              accept=".csv,text/csv,.tsv,text/tab-separated-values"
              className="sr-only"
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                e.target.value = ""; // allow picking the same file again after editing it
              }}
            />
          </div>
        </div>

        {preview && (
          <>
            <div>
              <p className="mb-2 text-sm font-medium">จับคู่คอลัมน์</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {CSV_FIELDS.map((f) => (
                  <div key={f.key} className="flex min-w-0 flex-col gap-1">
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
                    <th className="px-3 py-2 font-medium">หมวด / อันดับ</th>
                    <th className="px-3 py-2 text-right font-medium">ราคา</th>
                    <th className="px-3 py-2 text-right font-medium">ยอดขาย</th>
                    <th className="px-3 py-2 text-right font-medium">ค่าคอม</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.rows.map((r, i) => (
                    <tr key={i}>
                      <td className="max-w-[240px] truncate px-3 py-1.5">{r.title}</td>
                      <td className="max-w-[160px] truncate px-3 py-1.5 text-muted-foreground">
                        {r.category ?? "—"}
                        {r.categoryRank != null && ` · #${r.categoryRank}`}
                      </td>
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
            {isSample && (
              <p className="rounded-lg bg-primary-soft/60 px-3 py-2 text-xs">
                นี่คือไฟล์ตัวอย่าง ใช้ดูว่าระบบอ่านคอลัมน์อย่างไร — ดาวน์โหลดไปแก้เป็นข้อมูลสินค้าจริง (ลบแถว [ตัวอย่าง] ออก) แล้วอัปโหลดใหม่เพื่อนำเข้า
              </p>
            )}
          </>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            ยกเลิก
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !preview?.total || isSample}>
            {busy && <Loader2 className="animate-spin" />} นำเข้า {preview?.total ? `${preview.total} รายการ` : ""}
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}

/** Sample file download, a dry run with it, and what each column means. */
function TemplateHelp({ template, loading, error, busy, onTry }: { template?: CsvTemplate; loading: boolean; error: boolean; busy: boolean; onTry: () => void }) {
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 basis-56">
          ยังไม่มีไฟล์? ดาวน์โหลดไฟล์ตัวอย่างไปกรอกใน Excel หรือ Google Sheets แล้วบันทึกเป็น CSV (UTF-8)
        </p>
        <Button type="button" size="sm" variant="outline" disabled={!template || busy} onClick={onTry}>
          <Eye /> ลองกับไฟล์ตัวอย่าง
        </Button>
        <Button type="button" size="sm" disabled={!template} onClick={() => template && downloadCsv(template)}>
          {loading ? <Loader2 className="animate-spin" /> : <Download />} ดาวน์โหลดไฟล์ตัวอย่าง
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-danger">โหลดไฟล์ตัวอย่างไม่สำเร็จ ลองเปิดหน้าต่างนี้ใหม่</p>}
      {template && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-primary hover:underline">ดูคำอธิบายคอลัมน์ ({template.columns.length} คอลัมน์)</summary>
          <p className="mt-2 text-xs text-muted-foreground">
            ใส่เฉพาะคอลัมน์ที่มีข้อมูลก็ได้ ต้องมีแค่ชื่อสินค้า ช่องที่ไม่รู้ให้เว้นว่าง (เช็กลิสต์จะขึ้นว่า &quot;ยังไม่มีข้อมูล&quot;) ใช้ชื่อหัวคอลัมน์ภาษาอังกฤษก็ได้ หรือเลือกจับคู่เองหลังอัปโหลด
          </p>
          <ul className="mt-2 max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-card text-xs">
            {template.columns.map((c) => (
              <li key={c.field} className="px-3 py-2">
                <div className="flex items-baseline gap-2">
                  <span className="shrink-0 whitespace-nowrap font-medium">
                    {c.header}
                    {c.required && <span className="text-danger"> * จำเป็น</span>}
                  </span>
                  <span className="ml-auto min-w-0 truncate text-muted-foreground" title={c.example == null ? undefined : String(c.example)}>
                    {c.example == null ? "" : `เช่น ${c.example}`}
                  </span>
                </div>
                <p className="mt-0.5 text-muted-foreground">{c.description}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
