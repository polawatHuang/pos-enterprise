/**
 * ESC/POS for USB thermal printers. Receipts go out as a bitmap (GS v 0) drawn on a canvas, so Thai
 * vowels and tone marks print correctly on any printer — the Thai code pages of cheap printers
 * differ from model to model and stack marks wrongly.
 */
import QRCode from "qrcode";
import type { ReceiptBlock } from "@/components/pos/receipt-doc";
import { segmentWords } from "@/components/covers/compose";

/** Printable dots across: 58mm paper = 384, 80mm paper = 576 (203 dpi heads). */
export const PAPER_DOTS = { 58: 384, 80: 576 } as const;
export type PaperWidth = keyof typeof PAPER_DOTS;

const ESC = 0x1b;
const GS = 0x1d;
export const CMD = {
  init: [ESC, 0x40],
  /** pulse drawer pin 2 for 50ms on / 500ms off — the RJ11 kick cable most drawers use */
  drawer: [ESC, 0x70, 0x00, 0x19, 0xfa],
  feed: (lines: number) => [ESC, 0x64, Math.min(255, lines)],
  /** feed to the cutter and cut partially */
  cut: [GS, 0x56, 0x42, 0x00],
};

/** 1-bit image rows as GS v 0 commands, in bands so small printer buffers keep up. */
export function rasterCommands(bits: Uint8Array, widthBytes: number, height: number, band = 128): Uint8Array {
  const parts: number[][] = [];
  for (let y = 0; y < height; y += band) {
    const h = Math.min(band, height - y);
    parts.push([GS, 0x76, 0x30, 0x00, widthBytes & 0xff, widthBytes >> 8, h & 0xff, h >> 8]);
    parts.push(Array.from(bits.subarray(y * widthBytes, (y + h) * widthBytes)));
  }
  return Uint8Array.from(parts.flat());
}

/** Dark pixels (luminance < 160) to packed bits, most significant bit = leftmost dot. */
export function packBits(rgba: Uint8ClampedArray, width: number, height: number): { bits: Uint8Array; widthBytes: number } {
  const widthBytes = Math.ceil(width / 8);
  const bits = new Uint8Array(widthBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = rgba[i + 3] < 128 ? 255 : 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      if (lum < 160) bits[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { bits, widthBytes };
}

const FONT = '"Sarabun", "Noto Sans Thai", "Leelawadee UI", "Thonburi", Tahoma, sans-serif';

/** Draws the blocks on a canvas `dots` wide and returns it (tall enough for everything). */
export function drawBlocks(blocks: ReceiptBlock[], dots: number): HTMLCanvasElement {
  const scale = dots / 384; // sizes below are tuned for 58mm and grow with the paper
  const base = Math.round(22 * scale);
  const pad = Math.round(6 * scale);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const sizeFor = (b: { big?: boolean; small?: boolean }) => Math.round(base * (b.big ? 1.25 : b.small ? 0.85 : 1));
  const fontFor = (b: { bold?: boolean; big?: boolean; small?: boolean }) => `${b.bold ? "bold " : ""}${sizeFor(b)}px ${FONT}`;
  const wrap = (text: string, max: number) => {
    const lines: string[] = [];
    let line = "";
    for (const seg of segmentWords(text)) {
      const next = line + seg;
      if (line && ctx.measureText(next.trimEnd()).width > max) {
        lines.push(line.trimEnd());
        line = seg.trimStart();
      } else line = next;
    }
    if (line.trim() || !lines.length) lines.push(line.trimEnd());
    return lines;
  };

  // pass 1 lays out, pass 2 draws on a canvas of the measured height
  type Op = (y: number) => void;
  const ops: { h: number; draw: Op }[] = [];
  for (const b of blocks) {
    if (b.kind === "rule") {
      ops.push({ h: base, draw: (y) => {
        ctx.setLineDash([6 * scale, 4 * scale]);
        ctx.beginPath();
        ctx.moveTo(pad, y + base / 2);
        ctx.lineTo(dots - pad, y + base / 2);
        ctx.stroke();
        ctx.setLineDash([]);
      } });
      continue;
    }
    if (b.kind === "qr") {
      const { size, data } = QRCode.create(b.data, { errorCorrectionLevel: "M" }).modules;
      const cell = Math.floor((dots * 0.5) / size);
      const side = cell * size;
      const capLines = b.caption ? (ctx.font = fontFor({ small: true }), wrap(b.caption, dots - pad * 2)) : [];
      const lh = Math.round(base * 1.2);
      ops.push({ h: side + pad * 2 + capLines.length * lh, draw: (y) => {
        const x0 = Math.round((dots - side) / 2);
        for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (data[r * size + c]) ctx.fillRect(x0 + c * cell, y + pad + r * cell, cell, cell);
        ctx.font = fontFor({ small: true });
        ctx.textAlign = "center";
        capLines.forEach((l, i) => ctx.fillText(l, dots / 2, y + pad * 2 + side + (i + 0.8) * lh));
        ctx.textAlign = "left";
      } });
      continue;
    }
    ctx.font = fontFor(b);
    const lh = Math.round(sizeFor(b) * 1.35);
    if (b.kind === "row") {
      const rightW = ctx.measureText(b.right).width;
      const lines = wrap(b.left, dots - pad * 3 - rightW);
      const font = ctx.font;
      ops.push({ h: lines.length * lh, draw: (y) => {
        ctx.font = font;
        lines.forEach((l, i) => ctx.fillText(l, pad, y + (i + 0.8) * lh));
        ctx.textAlign = "right";
        ctx.fillText(b.right, dots - pad, y + 0.8 * lh);
        ctx.textAlign = "left";
        if (b.strike) ctx.fillRect(pad, y + lh * 0.5, dots - pad * 2, Math.max(1, scale * 1.5));
      } });
      continue;
    }
    const lines = wrap(b.text, dots - pad * 2 - (b.boxed ? pad * 2 : 0));
    const font = ctx.font;
    ops.push({ h: lines.length * lh + (b.boxed ? pad * 2 : 0), draw: (y) => {
      ctx.font = font;
      const center = b.align === "center";
      ctx.textAlign = center ? "center" : "left";
      lines.forEach((l, i) => ctx.fillText(l, center ? dots / 2 : pad, y + (b.boxed ? pad : 0) + (i + 0.8) * lh));
      ctx.textAlign = "left";
      if (b.boxed) ctx.strokeRect(pad, y + 2, dots - pad * 2, lines.length * lh + pad * 2 - 4);
      if (b.strike) ctx.fillRect(pad, y + lh * 0.5, dots - pad * 2, Math.max(1, scale * 1.5));
    } });
  }
  const height = ops.reduce((s, o) => s + o.h, 0) + pad * 2;
  canvas.width = dots;
  canvas.height = height;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, dots, height);
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = Math.max(1, scale * 1.5);
  ctx.textBaseline = "alphabetic";
  let y = pad;
  for (const o of ops) {
    o.draw(y);
    y += o.h;
  }
  return canvas;
}

/** Everything the printer needs for one receipt: init, (drawer), bitmap, feed, cut. */
export function receiptBytes(blocks: ReceiptBlock[], paper: PaperWidth, opts: { openDrawer?: boolean } = {}): Uint8Array {
  const canvas = drawBlocks(blocks, PAPER_DOTS[paper]);
  const img = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
  const { bits, widthBytes } = packBits(img.data, canvas.width, canvas.height);
  return Uint8Array.from([...CMD.init, ...(opts.openDrawer ? CMD.drawer : []), ...rasterCommands(bits, widthBytes, canvas.height), ...CMD.feed(4), ...CMD.cut]);
}
