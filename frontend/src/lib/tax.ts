import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { withOfflineCopy } from "@/lib/offline-cache";
import type { VatType } from "@/lib/types";

/** Shop VAT settings (Settings > ภาษีมูลค่าเพิ่ม). "vat7" on a product means the shop's standard rate. */
export interface TaxSettings {
  vatRegistered: boolean;
  vatRate: number;
  defaultVatType: VatType;
}

export const TAX_KEY = ["org", "tax"] as const;
/** Used until the settings load; matches the server default. */
export const DEFAULT_TAX: TaxSettings = { vatRegistered: true, vatRate: 7, defaultVatType: "vat7" };

export function useTaxSettings() {
  const q = useQuery({ queryKey: TAX_KEY, queryFn: () => withOfflineCopy("tax", () => api.get<TaxSettings>("/org/tax")), staleTime: 10 * 60_000 });
  return { ...q, tax: q.data ?? DEFAULT_TAX };
}

/** Percent that applies to a line: 0 for exempt/zero lines or when the shop is not VAT registered. */
export const lineVatRate = (tax: TaxSettings, vatType: VatType) => (tax.vatRegistered && vatType === "vat7" ? tax.vatRate : 0);

/** Price without VAT from a VAT-inclusive price. */
export const netOfInclusive = (amount: number, rate: number) => (amount * 100) / (100 + rate);

export const vatTypeLabel = (tax: TaxSettings, t: VatType) =>
  t === "vat7" ? `VAT ${tax.vatRate}%` : t === "zero" ? "VAT 0%" : "ยกเว้น VAT";
