import type { Metadata } from "next";
import { LandingPage } from "@/components/marketing/landing-page";

export const metadata: Metadata = { title: "แพ็กเกจและราคา", robots: { index: true, follow: true } };

export default function PricingPage() {
  return <LandingPage />;
}
