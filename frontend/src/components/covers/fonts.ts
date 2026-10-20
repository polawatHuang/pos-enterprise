import { Chakra_Petch, Kanit, Mitr, Prompt } from "next/font/google";
import type { CoverFont } from "@/lib/types";

// Display fonts for cover titles (drawn on <canvas>, so we need the generated family names)
const kanit = Kanit({ subsets: ["thai", "latin"], weight: ["700", "800"], display: "swap" });
const prompt = Prompt({ subsets: ["thai", "latin"], weight: ["700", "800"], display: "swap" });
const mitr = Mitr({ subsets: ["thai", "latin"], weight: ["600", "700"], display: "swap" });
const chakra = Chakra_Petch({ subsets: ["thai", "latin"], weight: ["700"], display: "swap" });

export const COVER_FONTS: Record<CoverFont, { label: string; family: string; weight: number }> = {
  kanit: { label: "Kanit (หนา ทันสมัย)", family: kanit.style.fontFamily, weight: 800 },
  prompt: { label: "Prompt (เรียบ อ่านง่าย)", family: prompt.style.fontFamily, weight: 800 },
  mitr: { label: "Mitr (กลม เป็นมิตร)", family: mitr.style.fontFamily, weight: 700 },
  chakra: { label: "Chakra Petch (เทค สปอร์ต)", family: chakra.style.fontFamily, weight: 700 },
};

/** Wait until the font can be drawn on canvas (canvas does not trigger font loading by itself). */
export async function ensureFont(font: CoverFont) {
  const f = COVER_FONTS[font];
  try {
    await document.fonts.load(`${f.weight} 64px ${f.family}`, "กขคABC");
  } catch {
    /* fall back to whatever is available */
  }
}
