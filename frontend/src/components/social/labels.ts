import type { PostStatus, SocialPlatform, TikTokPrivacy } from "@/lib/types";

type Tone = "neutral" | "primary" | "success" | "danger" | "warning";

export const SOCIAL: Record<SocialPlatform, { label: string; short: string; className: string; dot: string }> = {
  tiktok: { label: "TikTok", short: "TT", className: "bg-black text-white dark:bg-white dark:text-black", dot: "bg-black dark:bg-white" },
  facebook: { label: "Facebook", short: "FB", className: "bg-[#1877F2] text-white", dot: "bg-[#1877F2]" },
  instagram: { label: "Instagram", short: "IG", className: "bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#8134AF] text-white", dot: "bg-[#DD2A7B]" },
};

export const POST_STATUS: Record<PostStatus, { label: string; tone: Tone }> = {
  draft: { label: "ร่าง", tone: "neutral" },
  scheduled: { label: "ตั้งเวลาแล้ว", tone: "primary" },
  publishing: { label: "กำลังโพสต์", tone: "warning" },
  published: { label: "โพสต์แล้ว", tone: "success" },
  failed: { label: "ไม่สำเร็จ", tone: "danger" },
  cancelled: { label: "ยกเลิก", tone: "neutral" },
};

export const PRIVACY_LABEL: Record<TikTokPrivacy, string> = {
  PUBLIC_TO_EVERYONE: "ทุกคน",
  MUTUAL_FOLLOW_FRIENDS: "เพื่อน (ติดตามกันและกัน)",
  FOLLOWER_OF_CREATOR: "ผู้ติดตาม",
  SELF_ONLY: "เฉพาะฉัน",
};

export const PLACEMENT_LABEL = {
  caption: "ใส่ลิงก์ในแคปชัน",
  bio: "บอกว่า ลิงก์อยู่ในโปรไฟล์",
  none: "ไม่ใส่ลิงก์",
} as const;

/** Local "YYYY-MM-DDTHH:mm" for <input type="datetime-local"> */
export function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
