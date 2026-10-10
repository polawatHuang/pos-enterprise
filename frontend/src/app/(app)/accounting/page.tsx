import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import { modules } from "@/config/modules";

export const metadata: Metadata = { title: "รายรับรายจ่ายและภาษี" };

export default function Page() {
  return <ModulePlaceholder spec={modules.accounting} />;
}
