import { Badge } from "@/components/ui/primitives";
import type { MovementType } from "@/lib/types";

export const MOVEMENT_META: Record<MovementType, { label: string; tone: "success" | "danger" | "warning" | "primary" | "neutral" }> = {
  purchase: { label: "รับเข้า", tone: "success" },
  sale: { label: "ขาย", tone: "primary" },
  return: { label: "รับคืน", tone: "warning" },
  adjustment: { label: "ปรับยอด", tone: "neutral" },
  transfer_in: { label: "โอนเข้า", tone: "success" },
  transfer_out: { label: "โอนออก", tone: "danger" },
  opening: { label: "ยอดยกมา", tone: "neutral" },
  count: { label: "ตรวจนับ", tone: "warning" },
  waste: { label: "ของเสีย", tone: "danger" },
};

export function MovementTypeBadge({ type }: { type: MovementType }) {
  const m = MOVEMENT_META[type];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
