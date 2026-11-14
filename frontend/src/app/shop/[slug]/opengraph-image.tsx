import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { getPublicStoreSeoData } from "@/lib/ecommerce-seo";

export const alt = "หน้าร้านออนไลน์";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getPublicStoreSeoData(slug);
  if (!data) notFound();

  const productNames = data.products.slice(0, 3).map((product) => product.name);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 76px",
          color: "#17142b",
          background: "radial-gradient(ellipse at 82% 45%, #d7c8ff 0%, #efe9ff 38%, #faf9ff 100%)",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              width: 56,
              height: 56,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 18,
              background: "linear-gradient(135deg, #8b5cf6, #5b45d8)",
              color: "white",
              fontSize: 28,
              fontWeight: 700,
            }}
          >
            ✦
          </div>
          <div style={{ display: "flex", fontSize: 25, fontWeight: 700 }}>{data.store.name}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 850 }}>
          <div style={{ display: "flex", color: "#6941c6", fontSize: 24, fontWeight: 700 }}>ร้านค้าออนไลน์</div>
          <div style={{ display: "flex", fontSize: 56, fontWeight: 700, lineHeight: 1.15 }}>
            เลือกช้อปสินค้าจาก {data.store.name}
          </div>
          <div style={{ display: "flex", color: "#5c5870", fontSize: 24 }}>
            {productNames.length ? productNames.join(" · ") : "เลือกชมสินค้าและสั่งซื้อออนไลน์"}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", color: "#514779", fontSize: 20 }}>
          <span>จัดส่งทั่วไทย · ค่าจัดส่ง {data.shippingFee} บาท · ชำระผ่าน PromptPay</span>
          <span>POSWITHAI</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
