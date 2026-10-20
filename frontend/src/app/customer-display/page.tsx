import type { Metadata } from "next";
import { CustomerDisplay } from "@/components/pos/customer-display";

export const metadata: Metadata = { title: "จอลูกค้า" };

export default function CustomerDisplayPage() {
  return <CustomerDisplay />;
}
