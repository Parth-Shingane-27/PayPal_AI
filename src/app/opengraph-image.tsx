import { ImageResponse } from "next/og";

export const alt = "GlobalCart: sell your craft in ten countries from one listing";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const SEGMENTS = [
  { w: 85, c: "#c99a2e" },
  { w: 5.5, c: "#2a78d6" },
  { w: 5, c: "#e87ba4" },
  { w: 1.5, c: "#6250d6" },
  { w: 3, c: "#e34948" },
];
const STAMPS = ["US", "GB", "CA", "AU", "DE", "FR", "ES", "IT", "MX", "JP", "IN"];

/** Social card: the waybill strip, the headline and the market stamps. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#fbf8f1", padding: 72, color: "#1a1514" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 56, height: 56, borderRadius: 28, background: "#c99a2e", display: "flex", alignItems: "center", justifyContent: "center", color: "#1a1514", fontSize: 32, fontWeight: 800 }}>G</div>
          <div style={{ fontSize: 40, fontWeight: 800 }}>GlobalCart</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.02, letterSpacing: -2, maxWidth: 980 }}>Sell your craft in ten countries from one listing.</div>
          <div style={{ display: "flex", height: 40, gap: 4 }}>
            {SEGMENTS.map((s, i) => (
              <div key={i} style={{ width: `${s.w}%`, background: s.c, borderRadius: 6 }} />
            ))}
          </div>
          <div style={{ fontSize: 28, color: "#3e3532" }}>Localized listings, PayPal checkout, and every fee in plain sight.</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {STAMPS.map((s) => (
            <div key={s} style={{ border: "3px dashed #5e5450", borderRadius: 6, padding: "6px 12px", fontSize: 24, fontWeight: 700, color: "#3e3532" }}>
              {s}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
