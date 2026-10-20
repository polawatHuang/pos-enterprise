import type { CoverLayout, CoverOrientation } from "@/lib/types";

/**
 * Draws a finished cover on a canvas: AI background (cover-fit) → readability shading → optional
 * product photo → Thai headline (word-wrapped with Intl.Segmenter, auto-sized, outlined) → subtext
 * pill → badge sticker. Pure drawing; no React.
 */

export const COVER_SIZE: Record<CoverOrientation, { width: number; height: number }> = {
  portrait: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
};

export interface ComposeInput {
  orientation: CoverOrientation;
  background: CanvasImageSource | null;
  product: CanvasImageSource | null;
  headline: string;
  subtext: string | null;
  badge: string | null;
  layout: CoverLayout;
  fontFamily: string;
  fontWeight: number;
  textColor: string;
  strokeColor: string;
  accentColor: string;
  bandColor: string;
  titleScale: number;
  emphasisWord: string | null;
  imageX: number;
  imageY: number;
  imageScale: number;
}

type Box = { x: number; y: number; w: number; h: number };

const sizeOf = (img: CanvasImageSource) => {
  const i = img as { width: number; height: number; naturalWidth?: number; naturalHeight?: number };
  return { w: i.naturalWidth || i.width, h: i.naturalHeight || i.height };
};

function drawCover(ctx: CanvasRenderingContext2D, img: CanvasImageSource, box: Box) {
  const { w, h } = sizeOf(img);
  const s = Math.max(box.w / w, box.h / h);
  ctx.drawImage(img, box.x + (box.w - w * s) / 2, box.y + (box.h - h * s) / 2, w * s, h * s);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Thai has no spaces between words: split into word segments, keep spaces as their own tokens. */
export function segmentWords(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    return Array.from(new Intl.Segmenter("th", { granularity: "word" }).segment(text), (s) => s.segment);
  }
  return text.split(/(\s+)/).filter(Boolean);
}

/** Greedy line wrap over word segments; a single segment wider than the line is kept whole. */
export function wrapLines(measure: (s: string) => number, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const seg of segmentWords(text)) {
    const next = line + seg;
    if (line && measure(next.trimEnd()) > maxWidth) {
      lines.push(line.trim());
      line = seg.trimStart();
    } else line = next;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

/** Largest font size (step 2px) whose wrapped text fits maxWidth × maxLines. */
export function fitTitle(measureAt: (s: string, size: number) => number, text: string, maxWidth: number, maxLines: number, start: number, min: number) {
  for (let size = start; size >= min; size -= 2) {
    const lines = wrapLines((s) => measureAt(s, size), text, maxWidth);
    if (lines.length <= maxLines && lines.every((l) => measureAt(l, size) <= maxWidth)) return { size, lines };
  }
  return { size: min, lines: wrapLines((s) => measureAt(s, min), text, maxWidth) };
}

function titleArea(layout: CoverLayout, W: number, H: number, portrait: boolean): Box {
  const pad = Math.round(Math.min(W, H) * 0.07);
  if (layout === "split-left") return { x: pad, y: pad, w: W * 0.5 - pad, h: H - pad * 2 };
  if (layout === "bottom-band") return { x: pad, y: H * (portrait ? 0.62 : 0.55), w: W - pad * 2, h: H * (portrait ? 0.3 : 0.38) };
  if (layout === "center-burst") return { x: pad, y: H * 0.3, w: W - pad * 2, h: H * 0.4 };
  return { x: pad, y: pad * (portrait ? 2 : 1), w: W - pad * 2, h: H * (portrait ? 0.32 : 0.42) };
}

/** Default spot for the product photo, away from the title. */
export function defaultImagePos(layout: CoverLayout, portrait: boolean) {
  if (layout === "split-left") return { x: 0.75, y: 0.5 };
  if (layout === "bottom-band") return { x: 0.5, y: portrait ? 0.33 : 0.3 };
  if (layout === "center-burst") return { x: 0.5, y: portrait ? 0.82 : 0.8 };
  return { x: 0.5, y: portrait ? 0.66 : 0.68 };
}

function shade(ctx: CanvasRenderingContext2D, layout: CoverLayout, W: number, H: number, band: string) {
  ctx.save();
  if (layout === "top-title") {
    const g = ctx.createLinearGradient(0, 0, 0, H * 0.55);
    g.addColorStop(0, "rgba(0,0,0,0.6)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H * 0.55);
  } else if (layout === "bottom-band") {
    const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
    g.addColorStop(0, hexA(band, 0));
    g.addColorStop(0.35, hexA(band, 0.75));
    g.addColorStop(1, hexA(band, 0.95));
    ctx.fillStyle = g;
    ctx.fillRect(0, H * 0.45, W, H * 0.55);
  } else if (layout === "split-left") {
    const g = ctx.createLinearGradient(0, 0, W * 0.62, 0);
    g.addColorStop(0, hexA(band, 0.92));
    g.addColorStop(0.75, hexA(band, 0.6));
    g.addColorStop(1, hexA(band, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W * 0.62, H);
  } else {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.1, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, "rgba(0,0,0,0.45)");
    g.addColorStop(1, "rgba(0,0,0,0.15)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

function drawProduct(ctx: CanvasRenderingContext2D, img: CanvasImageSource, inp: ComposeInput, W: number, H: number) {
  const { w, h } = sizeOf(img);
  const maxSide = Math.min(W, H) * 0.62 * inp.imageScale;
  const s = maxSide / Math.max(w, h);
  const dw = w * s;
  const dh = h * s;
  const cx = inp.imageX * W;
  const cy = inp.imageY * H;
  const x = Math.min(Math.max(cx - dw / 2, 0), W - dw);
  const y = Math.min(Math.max(cy - dh / 2, 0), H - dh);
  const border = Math.round(Math.min(W, H) * 0.012);
  const r = Math.round(Math.min(dw, dh) * 0.08);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = Math.min(W, H) * 0.04;
  ctx.shadowOffsetY = Math.min(W, H) * 0.012;
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, x - border, y - border, dw + border * 2, dh + border * 2, r + border);
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, x, y, dw, dh, r);
  ctx.clip();
  ctx.drawImage(img, x, y, dw, dh);
  ctx.restore();
}

/** Character ranges covered by the emphasis phrase (first occurrence). */
function emphasisRange(text: string, word: string | null): [number, number] | null {
  if (!word) return null;
  const i = text.indexOf(word);
  return i < 0 ? null : [i, i + word.length];
}

function drawTitle(ctx: CanvasRenderingContext2D, inp: ComposeInput, area: Box, portrait: boolean, W: number) {
  const font = (size: number) => `${inp.fontWeight} ${size}px ${inp.fontFamily}`;
  const measureAt = (s: string, size: number) => {
    ctx.font = font(size);
    return ctx.measureText(s).width;
  };
  const start = Math.round(W * (portrait ? 0.15 : 0.085) * inp.titleScale);
  const maxLines = inp.layout === "split-left" ? 4 : 3;
  const { size, lines } = fitTitle(measureAt, inp.headline, area.w, maxLines, start, Math.round(start * 0.35));
  const lineH = size * 1.18;
  const blockH = lineH * lines.length;
  const top = inp.layout === "center-burst" || inp.layout === "split-left" ? area.y + (area.h - blockH) / 2 : area.y;
  const align = inp.layout === "split-left" ? "left" : "center";
  const range = emphasisRange(inp.headline, inp.emphasisWord);

  ctx.save();
  ctx.font = font(size);
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  // Track where each line starts in the original text to colour the emphasised characters
  let cursor = 0;
  lines.forEach((line, i) => {
    const at = inp.headline.indexOf(line, cursor);
    const lineStart = at < 0 ? cursor : at;
    cursor = lineStart + line.length;
    const width = ctx.measureText(line).width;
    let x = align === "center" ? area.x + (area.w - width) / 2 : area.x;
    const y = top + i * lineH;
    // Split the line into plain / emphasised runs
    const runs: { text: string; em: boolean }[] = [];
    for (let k = 0; k < line.length; k += 1) {
      const pos = lineStart + k;
      const em = Boolean(range && pos >= range[0] && pos < range[1]);
      const last = runs[runs.length - 1];
      if (last && last.em === em) last.text += line[k];
      else runs.push({ text: line[k], em });
    }
    for (const run of runs) {
      const w = ctx.measureText(run.text).width;
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = size * 0.18;
      ctx.shadowOffsetY = size * 0.05;
      ctx.lineWidth = size * 0.16;
      ctx.strokeStyle = inp.strokeColor;
      ctx.strokeText(run.text, x, y);
      ctx.shadowColor = "transparent";
      ctx.fillStyle = run.em ? inp.accentColor : inp.textColor;
      ctx.fillText(run.text, x, y);
      x += w;
    }
  });
  ctx.restore();
  return { bottom: top + blockH, size };
}

function drawSubtext(ctx: CanvasRenderingContext2D, inp: ComposeInput, area: Box, y: number, titleSize: number) {
  if (!inp.subtext) return;
  const W = ctx.canvas.width;
  const size = Math.round(Math.max(W * (inp.orientation === "portrait" ? 0.045 : 0.026), titleSize * 0.42));
  ctx.save();
  ctx.font = `${inp.fontWeight} ${size}px ${inp.fontFamily}`;
  ctx.textBaseline = "middle";
  const text = inp.subtext;
  const w = Math.min(ctx.measureText(text).width, area.w - size);
  const padX = size * 0.7;
  const h = size * 1.6;
  const x = inp.layout === "split-left" ? area.x : area.x + (area.w - w - padX * 2) / 2;
  ctx.fillStyle = inp.accentColor;
  roundRect(ctx, x, y, w + padX * 2, h, h / 2);
  ctx.fill();
  ctx.fillStyle = inp.strokeColor;
  ctx.fillText(text, x + padX, y + h / 2, area.w - size);
  ctx.restore();
}

function drawBadge(ctx: CanvasRenderingContext2D, inp: ComposeInput, W: number, H: number, portrait: boolean) {
  if (!inp.badge) return;
  const r = Math.min(W, H) * (portrait ? 0.13 : 0.11);
  const cx = inp.layout === "split-left" ? W * 0.5 : W - r * 1.25;
  const cy = inp.layout === "top-title" ? H - r * (portrait ? 3.2 : 1.3) : r * 1.3;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.18);
  // Starburst sticker
  ctx.beginPath();
  const spikes = 16;
  for (let i = 0; i < spikes * 2; i += 1) {
    const rad = i % 2 === 0 ? r : r * 0.84;
    const a = (Math.PI * i) / spikes;
    ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = r * 0.25;
  ctx.fillStyle = inp.accentColor;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = r * 0.06;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  let size = r * 0.55;
  ctx.font = `${inp.fontWeight} ${size}px ${inp.fontFamily}`;
  while (ctx.measureText(inp.badge).width > r * 1.4 && size > 12) {
    size -= 2;
    ctx.font = `${inp.fontWeight} ${size}px ${inp.fontFamily}`;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = inp.strokeColor;
  ctx.fillText(inp.badge, 0, 0);
  ctx.restore();
}

export function composeCover(canvas: HTMLCanvasElement, inp: ComposeInput) {
  const { width: W, height: H } = COVER_SIZE[inp.orientation];
  const portrait = inp.orientation === "portrait";
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);
  if (inp.background) drawCover(ctx, inp.background, { x: 0, y: 0, w: W, h: H });
  else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, inp.bandColor);
    g.addColorStop(1, inp.accentColor);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  shade(ctx, inp.layout, W, H, inp.bandColor);
  if (inp.product) drawProduct(ctx, inp.product, inp, W, H);
  const area = titleArea(inp.layout, W, H, portrait);
  const title = drawTitle(ctx, inp, area, portrait, W);
  drawSubtext(ctx, inp, area, title.bottom + title.size * 0.25, title.size);
  drawBadge(ctx, inp, W, H, portrait);
}
