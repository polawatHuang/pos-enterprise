import type { Metadata } from "next";
import { LandingPage } from "@/components/marketing/landing-page";
import { siteUrl } from "@/lib/site";

const title = "โปรแกรม POS ร้านค้าปลีกหลายสาขา จัดการสต๊อกและบัญชี | POSWITHAI";
const description =
  "ระบบ POS สำหรับร้านค้าปลีกไทยหลายสาขา เชื่อมขายหน้าร้าน สต๊อก จัดซื้อ บัญชี และทีมงานไว้ในที่เดียว ทดลองใช้ POSWITHAI ฟรี 14 วัน";
const keywords = [
  "โปรแกรม POS",
  "ระบบ POS",
  "POS ร้านค้า",
  "โปรแกรมขายหน้าร้าน",
  "ระบบจัดการร้านค้า",
  "โปรแกรมสต๊อกสินค้า",
  "ระบบจัดการสต๊อก",
  "POS หลายสาขา",
  "ระบบ POS ร้านค้าปลีก",
  "โปรแกรมบริหารร้านค้าหลายสาขา",
  "โปรแกรมบัญชีร้านค้า",
  "ระบบบริหารร้านค้าปลีก",
  "ซอฟต์แวร์บริหารธุรกิจ",
];

export const metadata: Metadata = {
  title,
  description,
  keywords,
  alternates: { canonical: siteUrl },
  applicationName: "POSWITHAI",
  openGraph: {
    type: "website",
    locale: "th_TH",
    siteName: "POSWITHAI",
    title,
    description,
    url: siteUrl,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "POSWITHAI — ระบบ POS จัดการร้านค้า สต๊อก และบัญชี",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/opengraph-image"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export default function Home() {
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "POSWITHAI",
      url: siteUrl.href,
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "POSWITHAI",
      url: siteUrl.href,
      inLanguage: "th-TH",
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "POSWITHAI",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      inLanguage: "th-TH",
      url: siteUrl.href,
      description,
      featureList: [
        "ระบบขายหน้าร้าน POS",
        "จัดการสต๊อกสินค้าและหลายสาขา",
        "รายงานและงานบัญชี",
        "จัดการทีมงานและสิทธิ์ผู้ใช้",
        "เครื่องมือ AI สำหรับงานธุรกิจ",
      ],
      provider: { "@type": "Organization", name: "POSWITHAI", url: siteUrl.href },
    },
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />
      <LandingPage />
    </>
  );
}
