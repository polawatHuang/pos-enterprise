"use client";

import { useState, useSyncExternalStore } from "react";
import { Loader2, Printer, Usb } from "lucide-react";
import { toast } from "sonner";
import { receiptBytes } from "@/lib/escpos";
import { kickDrawer, loadPrinter, pairPrinter, printerSupport, type PrinterSettings, savePrinter, sendToPrinter } from "@/lib/usb-printer";
import { Button } from "@/components/ui/button";
import { Label, Segmented } from "@/components/ui/primitives";
import { DialogContent } from "@/components/ui/overlays";
import type { ReceiptBlock } from "./receipt-doc";

// One printer setting for the whole page, shared by every component that prints
let current: PrinterSettings | null = null;
const listeners = new Set<() => void>();
const read = () => (current ??= loadPrinter());
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
function update(s: PrinterSettings) {
  current = s;
  savePrinter(s);
  listeners.forEach((l) => l());
}

export const usePrinterSettings = () => useSyncExternalStore(subscribe, read, () => null);

/** True when a USB printer is set up and took the job; false = use the browser's print dialog. */
export async function printOnUsb(blocks: ReceiptBlock[], opts: { openDrawer?: boolean } = {}): Promise<boolean> {
  const s = read();
  if (!s.kind) return false;
  await sendToPrinter(s, receiptBytes(blocks, s.paper, { openDrawer: opts.openDrawer && s.drawer }));
  return true;
}

/** Print on the USB printer when there is one, else open the browser's print dialog. */
export async function printReceipt(blocks: ReceiptBlock[]) {
  try {
    if (await printOnUsb(blocks)) return;
  } catch (err) {
    toast.error(`พิมพ์ผ่านเครื่องพิมพ์ไม่สำเร็จ: ${err instanceof Error ? err.message : err} — เปิดหน้าพิมพ์ของเบราว์เซอร์แทน`);
  }
  window.print();
}

/** Opens the drawer (cash in/out, no sale) when one is wired to the printer. */
export async function openDrawer() {
  const s = read();
  if (!s.kind || !s.drawer) return;
  try {
    await kickDrawer(s);
  } catch (err) {
    toast.warning(`เปิดลิ้นชักไม่สำเร็จ: ${err instanceof Error ? err.message : err}`);
  }
}

export function PrinterDialog() {
  const s = usePrinterSettings() ?? read();
  const support = printerSupport();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      // the user closing the browser's device picker is not an error worth shouting about
      if (!(err instanceof DOMException && err.name === "NotFoundError")) toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  const test: ReceiptBlock[] = [
    { kind: "text", text: "ทดสอบเครื่องพิมพ์", align: "center", bold: true, big: true },
    { kind: "text", text: "ภาษาไทย สระ วรรณยุกต์ ก่ ก้ ก๊ ก๋ กิ กี กึ กื กุ กู", align: "center" },
    { kind: "rule" },
    { kind: "row", left: "น้ำดื่ม 600 มล.", right: "7.00" },
    { kind: "row", left: "ยอดสุทธิ", right: "7.00", bold: true, big: true },
  ];

  return (
    <DialogContent title="เครื่องพิมพ์ใบเสร็จ" description="ตั้งค่าเฉพาะเครื่องนี้ — ต่อเครื่องพิมพ์ความร้อนผ่าน USB แล้วกดจับคู่" className="max-w-md">
      {support === "none" ? (
        <p className="rounded-xl bg-muted p-4 text-sm">
          เบราว์เซอร์นี้ต่อเครื่องพิมพ์ USB โดยตรงไม่ได้ — ใช้ Google Chrome หรือ Microsoft Edge บนคอมพิวเตอร์หรือ Android ตอนนี้ปุ่มพิมพ์จะเปิดหน้าพิมพ์ของเบราว์เซอร์แทน
        </p>
      ) : (
        <div className="grid gap-4">
          <div className="flex items-center gap-3 rounded-xl border border-border p-3 text-sm">
            <Usb className="size-5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">{s.kind ? <b>{s.name}</b> : "ยังไม่ได้จับคู่เครื่องพิมพ์"}</span>
            {s.kind && (
              <Button variant="ghost" size="sm" className="h-10 text-danger" onClick={() => update({ ...s, kind: null })}>
                เลิกใช้
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {(support === "usb" || support === "both") && (
              <Button variant="outline" disabled={!!busy} onClick={() => run("usb", async () => update(await pairPrinter("usb", s)))}>
                {busy === "usb" && <Loader2 className="animate-spin" />} จับคู่ผ่าน USB
              </Button>
            )}
            {(support === "serial" || support === "both") && (
              <Button variant="ghost" disabled={!!busy} onClick={() => run("serial", async () => update(await pairPrinter("serial", s)))}>
                {busy === "serial" && <Loader2 className="animate-spin" />} เครื่องแบบ COM port
              </Button>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>ขนาดกระดาษ</Label>
            <Segmented
              label="ขนาดกระดาษ"
              value={String(s.paper)}
              onChange={(v) => update({ ...s, paper: Number(v) as 58 | 80 })}
              options={[
                { value: "80", label: "80 มม." },
                { value: "58", label: "58 มม." },
              ]}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-5" checked={s.autoPrint} onChange={(e) => update({ ...s, autoPrint: e.target.checked })} />
            พิมพ์ใบเสร็จเองทุกครั้งที่ขายเสร็จ
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-5" checked={s.drawer} onChange={(e) => update({ ...s, drawer: e.target.checked })} />
            เปิดลิ้นชักเงินเมื่อรับเงินสด หรือบันทึกเงินเข้า/ออก (ลิ้นชักต่อกับเครื่องพิมพ์)
          </label>
          {s.kind && (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" disabled={!!busy} onClick={() => run("test", async () => void (await printOnUsb(test)))}>
                {busy === "test" ? <Loader2 className="animate-spin" /> : <Printer />} พิมพ์ทดสอบ
              </Button>
              <Button variant="outline" disabled={!!busy} onClick={() => run("drawer", () => kickDrawer(s))}>
                {busy === "drawer" && <Loader2 className="animate-spin" />} เปิดลิ้นชักทดสอบ
              </Button>
            </div>
          )}
        </div>
      )}
    </DialogContent>
  );
}
