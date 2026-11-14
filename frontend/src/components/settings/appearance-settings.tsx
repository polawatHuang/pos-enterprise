"use client";

import { useEffect, useState } from "react";
import { Check, Grip, Pin, Palette } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { APPEARANCE_ACCENTS, appearanceStorageKey, type AppearanceAccent } from "@/config/appearance";

function readAccent(userId?: number): AppearanceAccent {
  if (!userId || typeof window === "undefined") return "violet";
  try {
    const saved = localStorage.getItem(appearanceStorageKey(userId));
    return APPEARANCE_ACCENTS.find((option) => option.id === saved)?.id ?? "violet";
  } catch {
    return "violet";
  }
}

export function AppearanceSettings() {
  const { user } = useAuth();
  const [accent, setAccent] = useState(() => readAccent(user?.id));

  useEffect(() => {
    document.documentElement.dataset.accent = accent;
    if (!user) return;
    try {
      localStorage.setItem(appearanceStorageKey(user.id), accent);
    } catch {
      // The selected accent remains active until this page is closed.
    }
  }, [accent, user]);

  const changeAccent = (next: AppearanceAccent) => {
    setAccent(next);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">การแสดงผล</h1>
        <p className="mt-1 text-sm text-muted-foreground">ปรับแต่งเมนูและสีของ POSWITHAI สำหรับบัญชีนี้</p>
      </div>
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="size-5 text-primary" /> สีธีม
          </CardTitle>
          <CardDescription>เลือกสีหลักที่ใช้กับปุ่ม ลิงก์ และองค์ประกอบสำคัญทั่วทั้งเว็บไซต์</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {APPEARANCE_ACCENTS.map((option) => {
              const selected = accent === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => changeAccent(option.id)}
                  aria-pressed={selected}
                  className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
                    selected ? "border-primary bg-primary-soft" : "border-border hover:bg-accent"
                  }`}
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-full" style={{ backgroundColor: option.color }}>
                    {selected && <Check className="size-4 text-white" />}
                  </span>
                  <span className="text-sm font-medium">{option.label}</span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Pin className="size-5 text-primary" /> จัดการแถบเมนู
          </CardTitle>
          <CardDescription>ปักหมุดเมนูที่ใช้บ่อยเพื่อให้แสดงอยู่ด้านบน หรือถอนหมุดเพื่อคืนไปยังหมวดเดิม</CardDescription>
        </CardHeader>
        <CardContent className="flex items-start gap-3 text-sm text-muted-foreground">
          <Grip className="mt-0.5 size-4 shrink-0" />
          <p>ลากแถบจับด้านซ้ายของเมนูใน sidebar เพื่อเปลี่ยนลำดับภายในหมวด ปักหมุดเมนูที่ใช้บ่อยเพื่อย้ายไปไว้ด้านบน การตั้งค่าจะถูกบันทึกแยกตามบัญชีผู้ใช้บนอุปกรณ์นี้</p>
        </CardContent>
      </Card>
    </div>
  );
}
