import type { Metadata } from "next";
import { LandingPage } from "@/components/marketing/landing-page";
import { siteUrl } from "@/lib/site";

const title = "โปรแกรม POS จัดการร้านค้าและสต๊อกหลายสาขา | POS Enterprise";
const description =
  "ระบบ POS สำหรับร้านค้า เชื่อมขายหน้าร้าน สต๊อกหลายสาขา บัญชี ทีมงาน และ AI ในที่เดียว ทดลองใช้ POS Enterprise ฟรี 14 วัน";
const keywords = [
  "โปรแกรม POS",
  "ระบบ POS",
  "POS ร้านค้า",
  "โปรแกรมขายหน้าร้าน",
  "ระบบจัดการร้านค้า",
  "โปรแกรมสต๊อกสินค้า",
  "ระบบจัดการสต๊อก",
  "POS หลายสาขา",
  "โปรแกรมบัญชีร้านค้า",
  "ระบบบริหารร้านค้าปลีก",
  "ซอฟต์แวร์บริหารธุรกิจ",
];

export const metadata: Metadata = {
  title,
  description,
  keywords,
  alternates: { canonical: siteUrl },
  applicationName: "POS Enterprise",
  openGraph: {
    type: "website",
    locale: "th_TH",
    siteName: "POS Enterprise",
    title,
    description,
    url: siteUrl,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "POS Enterprise — ระบบ POS จัดการร้านค้า สต๊อก และบัญชี",
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
      name: "POS Enterprise",
      url: siteUrl.href,
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "POS Enterprise",
      url: siteUrl.href,
      inLanguage: "th-TH",
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "POS Enterprise",
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
      provider: { "@type": "Organization", name: "POS Enterprise", url: siteUrl.href },
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
