/**
 * Reading files the user picked or dropped.
 *
 * Safari can fail to read a File later on ("The I/O read operation failed." / NotReadableError),
 * e.g. a macOS screenshot dragged from the floating thumbnail (the file moves once the thumbnail
 * closes), a file evicted to iCloud, or a file changed after it was picked. So the bytes are read
 * into memory right away and every later step works on that copy.
 */

export const UNREADABLE_HELP =
  "อ่านไฟล์จากเครื่องไม่ได้ — ถ้าเป็นภาพหน้าจอ ให้รอจนไฟล์ขึ้นบน Desktop แล้วเลือกผ่านปุ่มเลือกไฟล์ (อย่าลากจากภาพย่อที่มุมจอ) หรือคัดลอกไฟล์ไปไว้ใน Downloads แล้วลองใหม่ · ถ้าไฟล์อยู่ใน iCloud ให้ดาวน์โหลดลงเครื่องก่อน";

export function isUnreadable(err: unknown) {
  if (err instanceof DOMException && (err.name === "NotReadableError" || err.name === "NotFoundError")) return true;
  return err instanceof Error && /I\/O read operation failed|could not be read|NotReadableError/i.test(err.message);
}

/** The file's bytes as an in-memory File (same name/type); retries once after a short pause. */
export async function readFileNow(file: File): Promise<File> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const buf = await file.arrayBuffer();
      return new File([buf], file.name, { type: file.type, lastModified: file.lastModified });
    } catch (err) {
      if (attempt >= 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}

/** Read every file immediately (before any re-render); unreadable ones are reported and dropped. */
export async function readFilesNow(files: File[], onUnreadable: (file: File, err: unknown) => void): Promise<File[]> {
  const out: File[] = [];
  for (const f of files) {
    try {
      out.push(await readFileNow(f));
    } catch (err) {
      onUnreadable(f, err);
    }
  }
  return out;
}
