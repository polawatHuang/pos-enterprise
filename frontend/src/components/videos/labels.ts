import type { VideoStatus } from "@/lib/types";

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
export function steps(visualMode: "ai_clips" | "product_images") {
  return [
    { key: "script", label: "สคริปต์", statuses: ["script_ready"] },
    { key: "voice", label: "เสียงพากย์", statuses: ["voicing"] },
    ...(visualMode === "ai_clips" ? [{ key: "clips", label: "คลิป AI", statuses: ["generating_clips"] }] : []),
    { key: "compose", label: "ประกอบคลิป", statuses: ["compositing"] },
    { key: "done", label: "เสร็จ", statuses: ["ready", "parts_ready"] },
  ] as { key: string; label: string; statuses: VideoStatus[] }[];
}

export const LENGTHS = [15, 30, 45, 60];
