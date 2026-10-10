import type { Metadata } from "next";
import { AccountSettings } from "@/components/settings/change-password-form";

export const metadata: Metadata = { title: "บัญชีของฉัน" };

export default function AccountPage() {
  return <AccountSettings />;
}
