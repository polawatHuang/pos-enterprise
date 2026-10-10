import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { AccountsView } from "@/components/social/accounts-view";

export const metadata: Metadata = { title: "บัญชีโซเชียล" };

export default function SocialAccountsPage() {
  return (
    <RequirePermission permission="social:read">
      <AccountsView />
    </RequirePermission>
  );
}
