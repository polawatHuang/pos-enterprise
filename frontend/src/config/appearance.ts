export const APPEARANCE_ACCENTS = [
  { id: "violet", label: "ม่วง", color: "oklch(0.51 0.21 272)" },
  { id: "blue", label: "น้ำเงิน", color: "oklch(0.54 0.19 252)" },
  { id: "teal", label: "เขียวอมฟ้า", color: "oklch(0.56 0.14 190)" },
  { id: "green", label: "เขียว", color: "oklch(0.55 0.16 150)" },
  { id: "orange", label: "ส้ม", color: "oklch(0.62 0.18 45)" },
  { id: "rose", label: "ชมพู", color: "oklch(0.57 0.2 5)" },
] as const;

export type AppearanceAccent = (typeof APPEARANCE_ACCENTS)[number]["id"];

export const appearanceStorageKey = (userId: number) => `pe.appearance.accent.${userId}`;
