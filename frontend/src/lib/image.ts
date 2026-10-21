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
