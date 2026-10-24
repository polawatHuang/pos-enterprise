/**
 * Cashier screen -> customer display (a second monitor or tablet tab on the same machine).
 * Uses BroadcastChannel, so no server round-trip and nothing to configure.
 */
export const DISPLAY_CHANNEL = "pos-customer-display";

export interface DisplayLine {
  name: string;
  unit: string;
  quantity: number;
  total: number;
}

export type DisplayMessage =
  | { type: "cart"; lines: DisplayLine[]; total: number; discount: number; member: { name: string; points: number } | null }
  | { type: "pay"; total: number; qr: string | null; qrImage?: string | null; method: string; bank?: { bank: string; number: string; name: string } | null }
  /** the payment provider confirmed the money: show it before the sale finishes */
  | { type: "paid"; total: number }
  | { type: "age"; asking: boolean }
  | { type: "done"; total: number; change: number; pointsEarned: number }
  | { type: "idle" }
  /** display -> cashier */
  | { type: "age-confirmed" }
  | { type: "hello" };

export function openDisplayChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return null;
  return new BroadcastChannel(DISPLAY_CHANNEL);
}
