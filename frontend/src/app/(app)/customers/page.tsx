import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { CustomersView } from "@/components/customers/customers-view";
import { CUSTOMERS_READ } from "@/config/nav";

export const metadata: Metadata = { title: "ลูกค้า" };

export default function CustomersPage() {
  return (
    <RequirePermission permission={CUSTOMERS_READ}>
      <CustomersView />
    </RequirePermission>
  );
}
