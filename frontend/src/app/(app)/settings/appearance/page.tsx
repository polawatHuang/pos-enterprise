import type { Metadata } from "next";
import { AppearanceSettings } from "@/components/settings/appearance-settings";

export const metadata: Metadata = { title: "การแสดงผล" };

export default function AppearancePage() {
  return <AppearanceSettings />;
}
