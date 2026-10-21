import type { CaptionStyle, VideoStatus, VideoVisualMode } from "@/lib/types";

type Tone = "neutral" | "primary" | "success" | "danger" | "warning";

export const VIDEO_STATUS: Record<VideoStatus, { label: string; tone: Tone }> = {
  draft: { label: "ฉบับร่าง", tone: "neutral" },
  scripting: { label: "AI กำลังเขียนสคริปต์", tone: "primary" },
  script_ready: { label: "สคริปต์พร้อม", tone: "primary" },
  voicing: { label: "กำลังสร้างเสียง", tone: "warning" },
  generating_clips: { label: "กำลังสร้างคลิป AI", tone: "warning" },
  rendering_avatar: { label: "กำลังสร้าง avatar", tone: "warning" },
  compositing: { label: "กำลังประกอบคลิป", tone: "warning" },
  parts_ready: { label: "ชิ้นส่วนพร้อม", tone: "success" },
  ready: { label: "พร้อมโพสต์", tone: "success" },
  failed: { label: "ไม่สำเร็จ", tone: "danger" },
};

export const IN_PROGRESS: VideoStatus[] = ["scripting", "voicing", "generating_clips", "rendering_avatar", "compositing"];

/** Steps shown on the progress rail (AI clips step only when chosen). */
export function steps(visualMode: VideoVisualMode) {
  return [
    { key: "script", label: "สคริปต์", statuses: ["script_ready"] },
    { key: "voice", label: "เสียงพากย์", statuses: ["voicing"] },
    ...(visualMode !== "product_images" ? [{ key: "clips", label: "คลิป AI", statuses: ["generating_clips"] }] : []),
    { key: "compose", label: "ประกอบคลิป", statuses: ["compositing"] },
    { key: "done", label: "เสร็จ", statuses: ["ready", "parts_ready"] },
  ] as { key: string; label: string; statuses: VideoStatus[] }[];
}

export const LENGTHS = [15, 30, 45, 60];

export const VISUAL_MODES: { value: VideoVisualMode; title: string; hint: string }[] = [
  {
    value: "my_footage",
    title: "AI วิดีโอจากภาพฉาก (แนะนำ)",
    hint: "ใส่ภาพฉากเรียงตามลำดับ (ไม่ใส่ AI สร้างให้) แล้ว AI ทำแต่ละภาพให้เคลื่อนไหวเป็นคลิป ต่อกันตามลำดับ · มีค่าใช้จ่ายต่อฉาก",
  },
  { value: "product_images", title: "รูปสินค้า + เคลื่อนไหว", hint: "เร็ว ประหยัด ใช้รูปสินค้าในระบบ" },
  { value: "ai_clips", title: "คลิป AI จากข้อความ", hint: "AI สร้างคลิปจาก prompt ของแต่ละฉากโดยไม่ใช้ภาพ มีค่าใช้จ่ายต่อฉาก" },
];

export const CAPTION_STYLES: { value: CaptionStyle; label: string }[] = [
  { value: "pop", label: "ซับเด้งทีละคำ (ตัวใหญ่ ขอบดำ)" },
  { value: "clean", label: "ซับทีละคำ แบบมีพื้นหลัง" },
  { value: "none", label: "ไม่ใส่ซับทีละคำ" },
];

export const ANGLE_LABELS: Record<string, string> = {
  auto: "ให้ AI เลือก",
  problem_solution: "ปัญหา → ทางแก้",
  unboxing: "แกะกล่อง",
  before_after: "ก่อน/หลัง",
  top3: "3 เหตุผลที่ต้องมี",
  pov: "POV ชีวิตประจำวัน",
  comparison: "เทียบของทั่วไป",
};
