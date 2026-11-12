import type { Metadata } from "next";
import { LandingPage } from "@/components/marketing/landing-page";

export const metadata: Metadata = {
  title: "POS, สต๊อก, บัญชี และ AI ในระบบเดียว",
  description: "บริหารหน้าร้าน หลายสาขา สต๊อก บัญชี และงาน AI ใน POS Enterprise เริ่มทดลองใช้ได้ 14 วัน",
  robots: { index: true, follow: true },
};

export default function Home() {
  return <LandingPage />;
}
