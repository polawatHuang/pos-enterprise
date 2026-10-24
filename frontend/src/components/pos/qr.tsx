import QRCode from "qrcode";
import { cn } from "@/lib/utils";

/** A QR as inline SVG (drawn synchronously from the text, so it can sit in a receipt or a dialog). */
export function QrSvg({ data, className }: { data: string; className?: string }) {
  const { size, data: bits } = QRCode.create(data, { errorCorrectionLevel: "M" }).modules;
  let path = "";
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (bits[y * size + x]) path += `M${x} ${y}h1v1h-1z`;
  return (
    <svg viewBox={`${-2} ${-2} ${size + 4} ${size + 4}`} className={cn("bg-white", className)} shapeRendering="crispEdges" role="img" aria-label="QR">
      <path d={path} fill="#000" />
    </svg>
  );
}
