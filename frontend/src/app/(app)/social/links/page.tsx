import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { LinksView } from "@/components/social/links-view";

export const metadata: Metadata = { title: "ลิงก์ Affiliate" };

export default function AffiliateLinksPage() {
  return (
    <RequirePermission permission="social:read">
      <LinksView />
    </RequirePermission>
  );
}
