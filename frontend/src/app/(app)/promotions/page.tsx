import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { PromotionsView } from "@/components/pos/promotions-view";

export const metadata: Metadata = { title: "โปรโมชั่น" };

export default function PromotionsPage() {
  return (
    <RequirePermission permission="pos:sell">
      <PromotionsView />
    </RequirePermission>
  );
}
