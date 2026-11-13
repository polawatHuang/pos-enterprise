import { ImageResponse } from "next/og";

export const alt = "POS Enterprise — POS, inventory, accounting and AI for growing businesses";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          color: "white",
          background: "linear-gradient(135deg, #090d19 0%, #17152b 55%, #10172a 100%)",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              display: "flex",
              width: 58,
              height: 58,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 16,
              background: "linear-gradient(135deg, #a78bfa, #6366f1)",
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            POS
          </div>
          <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: -0.5 }}>POS Enterprise</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 58, fontWeight: 700, letterSpacing: -2, lineHeight: 1.12 }}>
            <span>Retail operations,</span>
            <span>all in one system.</span>
          </div>
          <div style={{ display: "flex", gap: 14, color: "#c4b5fd", fontSize: 23 }}>
            <span>POS</span><span>·</span><span>Inventory</span><span>·</span><span>Accounting</span><span>·</span><span>AI</span>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", color: "#a1a1aa", fontSize: 18 }}>
          <span>Manage your growing business with confidence</span>
          <span>app.poswithai.com</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
