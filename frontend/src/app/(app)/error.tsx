"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A page that crashed while rendering: say so, keep the menu, and offer a retry instead of a blank screen. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[page error]", error);
  }, [error]);
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-danger-soft text-danger">
        <AlertTriangle className="size-7" />
      </div>
      <h1 className="mt-5 text-xl font-semibold">หน้านี้แสดงผลไม่สำเร็จ</h1>
      <p className="mt-2 text-sm text-muted-foreground">เกิดข้อผิดพลาดระหว่างแสดงหน้า ข้อมูลของคุณยังอยู่ครบ ลองโหลดใหม่อีกครั้ง</p>
      {error.message && <p className="mt-3 break-words rounded-lg bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">{error.message.slice(0, 300)}</p>}
      {error.digest && <p className="mt-1 text-[11px] text-muted-foreground">รหัสอ้างอิง {error.digest}</p>}
      <div className="mt-5 flex justify-center gap-2">
        <Button onClick={reset}>
          <RotateCcw className="size-4" /> ลองใหม่
        </Button>
        <Button variant="outline" asChild>
          <Link href="/">กลับหน้าแรก</Link>
        </Button>
      </div>
    </div>
  );
}
