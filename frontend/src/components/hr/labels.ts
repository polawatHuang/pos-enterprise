import type { LeaveRequest, LeaveType, PayrollRun } from "@/lib/types";

type Tone = "neutral" | "primary" | "success" | "danger" | "warning";

export const RUN_STATUS: Record<PayrollRun["status"], { label: string; tone: Tone }> = {
  draft: { label: "ร่าง", tone: "neutral" },
  approved: { label: "อนุมัติแล้ว รอจ่าย", tone: "primary" },
  paid: { label: "จ่ายแล้ว", tone: "success" },
  void: { label: "ยกเลิก", tone: "danger" },
};

export const LEAVE_TYPE: Record<LeaveType, string> = {
  sick: "ลาป่วย",
  personal: "ลากิจ",
  vacation: "ลาพักร้อน",
  maternity: "ลาคลอด",
  other: "ลาอื่นๆ",
};

export const LEAVE_STATUS: Record<LeaveRequest["status"], { label: string; tone: Tone }> = {
  pending: { label: "รออนุมัติ", tone: "warning" },
  approved: { label: "อนุมัติแล้ว", tone: "success" },
  rejected: { label: "ไม่อนุมัติ", tone: "danger" },
  cancelled: { label: "ยกเลิก", tone: "neutral" },
};

/** "2026-10" -> "ตุลาคม 2569" */
export const monthLabel = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString("th-TH", { month: "long", year: "numeric" });
};

export const n2 = (v: number) => v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
