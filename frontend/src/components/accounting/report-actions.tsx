"use client";

import { useState } from "react";
import { Download, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import { apiDownload } from "@/lib/api";
import { Button } from "@/components/ui/button";

type Query = Record<string, string | number | undefined>;

/** "ส่งออก CSV" + "พิมพ์" for a report card. Hidden when printing. */
export function ReportActions({ csvPath, query, filename, disabled }: { csvPath: string; query: Query; filename: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      await apiDownload(csvPath, query, filename);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ส่งออกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <Button size="sm" variant="outline" onClick={() => void download()} disabled={busy || disabled}>
        {busy ? <Loader2 className="animate-spin" /> : <Download />} ส่งออก CSV
      </Button>
      <Button size="sm" variant="outline" onClick={() => window.print()} disabled={disabled}>
        <Printer /> พิมพ์
      </Button>
    </div>
  );
}

/** Report title block that only appears on paper (the on-screen card header is hidden there). */
export function PrintHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-4 hidden text-center print:block">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm">{subtitle}</p>
    </div>
  );
}
