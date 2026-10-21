/**
 * Decoding user images in the browser.
 *
 * createImageBitmap(blob) is fast but Safari rejects some files it can display perfectly well
 * (e.g. macOS screenshots with a Display P3 profile, iPhone HEIC photos), so every caller falls
 * back to an <img> element, which decodes anything the browser can show.
 */

export interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
}

async function viaImgElement(blob: Blob): Promise<DecodedImage> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function decodeImage(blob: Blob): Promise<DecodedImage> {
  try {
    const bmp = await createImageBitmap(blob);
    return { source: bmp, width: bmp.width, height: bmp.height };
  } catch (first) {
    try {
      return await viaImgElement(blob);
    } catch {
      console.error("[image] cannot decode", blob.type, blob.size, first);
      throw new Error(`ไฟล์รูปนี้เปิดไม่ได้ (${blob.type || "ไม่ทราบชนิด"}) ลองบันทึกเป็น JPEG หรือ PNG แล้วแนบใหม่`);
    }
  }
}

/** Shrink to at most maxSide px and re-encode; PNG keeps transparency. Returns a data URL. */
export async function downscaleToDataUrl(blob: Blob, { maxSide, type = "jpeg", quality = 0.85 }: { maxSide: number; type?: "png" | "jpeg"; quality?: number }) {
  const img = await decodeImage(blob);
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext("2d")!.drawImage(img.source, 0, 0, canvas.width, canvas.height);
  if (img.source instanceof ImageBitmap) img.source.close();
  return type === "png" ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", quality);
}

/** Base64 payload of a data URL (without the "data:...;base64," prefix). */
export const base64Of = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(",") + 1);

/** Picture types the server keeps as they are (and the video renderer accepts). */
const KEEP_AS_IS = new Set(["image/jpeg", "image/png", "image/webp"]);
const HEIC = /\.(heic|heif)$/i;
const IMAGE_EXT = /\.(heic|heif|gif|bmp|tiff?|avif|svg|jfif|ico)$/i;

/** True for any picture file, including ones the browser reports without a type (HEIC on Chrome). */
export const isImageFile = (file: File) => file.type.startsWith("image/") || IMAGE_EXT.test(file.name);

/**
 * Make a picture uploadable: JPEG/PNG/WebP pass through; anything else (iPhone HEIC, GIF, BMP,
 * TIFF, AVIF, SVG …) is redrawn as a JPEG of at most `maxSide` px. HEIC is decoded with heic2any,
 * loaded only when needed, because only Safari can decode it natively.
 * @returns the file to upload and whether it was converted
 */
export async function toUploadableImage(file: File, { maxSide = 2560, quality = 0.9 } = {}): Promise<{ file: File; converted: boolean }> {
  if (KEEP_AS_IS.has(file.type)) return { file, converted: false };
  let source: Blob = file;
  if (HEIC.test(file.name) || /image\/hei[cf]/.test(file.type)) {
    try {
      await decodeImage(file); // Safari reads HEIC itself
    } catch {
      const heic2any = (await import("heic2any")).default;
      const out = await heic2any({ blob: file, toType: "image/jpeg", quality });
      source = Array.isArray(out) ? out[0] : out;
    }
  }
  const img = await decodeImage(source);
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; // JPEG has no transparency: GIF/SVG/PNG-like sources go on white
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img.source, 0, 0, canvas.width, canvas.height);
  if (img.source instanceof ImageBitmap) img.source.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("แปลงไฟล์นี้เป็น JPG ไม่ได้ ลองบันทึกเป็น JPG แล้วอัปโหลดใหม่");
  const name = `${file.name.replace(/\.[^.]+$/, "") || "image"}.jpg`;
  return { file: new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified }), converted: true };
}
