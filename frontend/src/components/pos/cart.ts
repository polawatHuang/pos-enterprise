import type { CatalogItem, SaleBlock } from "@/lib/types";
import { DEFAULT_TAX, lineVatRate, type TaxSettings } from "@/lib/tax";

export interface CartLine {
  /** product id + unit id: the same product sold by piece and by pack are separate lines */
  key: string;
  item: CatalogItem;
  unitId: number | null;
  quantity: number;
  /** baht off this line */
  discount: number;
  /** server quote for this line (POST /pos/quote): promotion discount, and the markdown it kept */
  promo?: LinePromo;
}

export interface LinePromo {
  discount: number;
  markdown: number;
  name: string | null;
}

export const r2 = (n: number) => Math.round(n * 100) / 100;
export const lineKey = (productId: number, unitId: number | null) => `${productId}:${unitId ?? 0}`;

export function unitOf(line: Pick<CartLine, "item" | "unitId">) {
  return line.unitId ? (line.item.units.find((u) => u.id === line.unitId) ?? null) : null;
}

export const unitPrice = (line: Pick<CartLine, "item" | "unitId">) => unitOf(line)?.price ?? line.item.price;
export const unitName = (line: Pick<CartLine, "item" | "unitId">) => unitOf(line)?.name ?? line.item.unit;
/** Base units (pieces) this line takes from stock. */
export const baseQty = (line: Pick<CartLine, "item" | "unitId" | "quantity">) => line.quantity * (unitOf(line)?.factor ?? 1);
/**
 * Near-expiry markdown the till applies automatically (server is the authority: it allocates
 * first-expiry-first-out and may differ slightly when one product sits on several cart lines).
 */
export function lineMarkdown(line: Pick<CartLine, "item" | "unitId" | "quantity">) {
  const md = line.item.markdown;
  if (!md) return 0;
  const factor = unitOf(line)?.factor ?? 1;
  return r2((Math.min(baseQty(line), md.qty) * (unitPrice(line) / factor) * md.pct) / 100);
}
/** Shop price cuts on the line: the quoted promotion (it already chose against the markdown), else the markdown. */
export const linePromoOff = (line: CartLine) => (line.promo ? r2(line.promo.discount + line.promo.markdown) : lineMarkdown(line));
export const lineTotal = (line: CartLine) => r2(unitPrice(line) * line.quantity - line.discount - linePromoOff(line));

/** Mirrors the server: VAT is extracted from VAT-inclusive prices at the shop's rate after spreading bill-level discounts. */
export function totalsOf(lines: CartLine[], billDiscount: number, pointsDiscount = 0, tax: TaxSettings = DEFAULT_TAX) {
  const gross = r2(lines.reduce((s, l) => s + unitPrice(l) * l.quantity, 0));
  const subtotal = r2(lines.reduce((s, l) => s + lineTotal(l), 0));
  const total = r2(Math.max(subtotal - billDiscount - pointsDiscount, 0));
  const ratio = subtotal ? total / subtotal : 0;
  const vat = lines.reduce((s, l) => {
    const rate = lineVatRate(tax, l.item.vatType);
    return s + (lineTotal(l) * ratio * rate) / (100 + rate);
  }, 0);
  return {
    gross,
    subtotal,
    total,
    lineDiscounts: r2(gross - subtotal),
    promo: r2(lines.reduce((s, l) => s + (l.promo?.discount ?? 0), 0)),
    vat: r2(vat),
    units: lines.reduce((s, l) => s + l.quantity, 0),
  };
}

/** True when local "HH:MM" falls inside the window (windows may wrap midnight). */
export function inWindow(now: string, from: string, to: string) {
  if (from === to) return false;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

export function blockedNow(block: SaleBlock | null, now: string) {
  return block ? inWindow(now, block.from, block.to) : false;
}

export const nowHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
