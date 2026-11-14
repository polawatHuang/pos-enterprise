import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import { Providers } from "@/components/providers";
import { siteUrl } from "@/lib/site";
import "./globals.css";

const plexThai = IBM_Plex_Sans_Thai({
  variable: "--font-plex-thai",
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: { default: "POSWITHAI", template: "%s · POSWITHAI" },
  description: "ระบบบริหารร้านค้าออนไลน์และหน้าร้านแบบครบวงจร พร้อม AI",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f9fc" },
    { media: "(prefers-color-scheme: dark)", color: "#14151f" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" suppressHydrationWarning className={`${plexThai.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
