import type { PoStatus, StockTransfer } from "@/lib/types";

export const PO_STATUS: Record<PoStatus, { label: string; tone: "neutral" | "primary" | "warning" | "success" | "danger" }> = {
  draft: { label: "ร่าง", tone: "neutral" },
  ordered: { label: "สั่งแล้ว รอของ", tone: "primary" },
  partial: { label: "รับบางส่วน", tone: "warning" },
  received: { label: "รับครบ", tone: "success" },
  cancelled: { label: "ยกเลิก", tone: "danger" },
};

export const TRANSFER_STATUS: Record<StockTransfer["status"], { label: string; tone: "primary" | "success" | "neutral" }> = {
  in_transit: { label: "ระหว่างทาง", tone: "primary" },
  received: { label: "รับแล้ว", tone: "success" },
  cancelled: { label: "ยกเลิก", tone: "neutral" },
};
