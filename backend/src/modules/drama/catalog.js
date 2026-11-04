'use strict';

/**
 * ละคร AI: story genres (with their sub-types), visual styles and lengths offered in step 01.
 * Prompts for images are English; labels and descriptions are Thai.
 */

const GENRES = [
  {
    id: 'ghost',
    label: 'เรื่องผี',
    hint: 'ผีไทย บ้านร้าง ตำนานสยองขวัญ',
    tone: 'Thai horror folklore, eerie atmosphere, suspense',
    sample: 'a frightened young Thai woman in an old wooden Thai house at night, a pale ghostly figure in the doorway',
    substyles: ['ผีไทยพื้นบ้าน', 'บ้านร้าง', 'คำสาปโบราณ', 'ผีในเมือง'],
  },
  {
    id: 'folktale',
    label: 'นิทานพื้นบ้าน',
    hint: 'นิทานไทย ข้อคิด เมืองในตำนาน',
    tone: 'Thai folktale, warm storytelling, village life, moral lesson',
    sample: 'Thai villagers in traditional clothes in a rice field village beside a river at golden hour',
    substyles: ['นิทานอีสป', 'นิทานชาดก', 'วรรณคดีไทย', 'นิทานหมู่บ้าน'],
  },
  {
    id: 'myth',
    label: 'ตำนานเทพเจ้า',
    hint: 'เทพ ยักษ์ นาค ตำนานโลก',
    tone: 'epic mythology, divine beings, grand fantasy scale',
    sample: 'a mighty naga serpent rising from a stormy sea before a golden Thai temple, a celestial warrior in front',
    substyles: ['เทพไทย-ฮินดู', 'ตำนานกรีก', 'ตำนานจีน', 'ตำนานนอร์ส'],
  },
  {
    id: 'history',
    label: 'ประวัติศาสตร์',
    hint: 'อยุธยา สงคราม บุคคลสำคัญ',
    tone: 'Thai historical drama, period costumes, cinematic epic',
    sample: 'Ayutthaya era Thai warriors on war elephants before an ancient city wall, dramatic sky',
    substyles: ['กรุงศรีอยุธยา', 'สุโขทัย', 'รัตนโกสินทร์', 'สงครามโลก'],
  },
  {
    id: 'drama',
    label: 'ดราม่าครอบครัว',
    hint: 'ครอบครัว มรดก ความลับ น้ำตา',
    tone: 'emotional Thai family drama, intimate, heartfelt',
    sample: 'a Thai family in tension around a dinner table in a classic Thai house, a letter in the mother\'s hand',
    substyles: ['แย่งมรดก', 'แม่ลูก', 'ความลับในบ้าน', 'ตบจูบ'],
  },
  {
    id: 'romance',
    label: 'รักโรแมนติก',
    hint: 'รักแรก รักต่างชนชั้น รักข้ามเวลา',
    tone: 'romantic Thai drama, soft light, longing',
    sample: 'a young Thai couple sharing a quiet look on a rainy Bangkok street at night, warm neon reflections',
    substyles: ['รักวัยเรียน', 'รักต่างชนชั้น', 'รักข้ามภพ', 'รักออฟฟิศ'],
  },
  {
    id: 'comedy',
    label: 'ตลก',
    hint: 'ฮาเบา ๆ ชีวิตประจำวัน',
    tone: 'lighthearted Thai comedy, playful, bright',
    sample: 'two Thai friends in a funny chase through a lively village market, exaggerated expressions',
    substyles: ['ตลกหมู่บ้าน', 'ตลกออฟฟิศ', 'ครอบครัวป่วน', 'แก๊งเพื่อน'],
  },
  {
    id: 'thriller',
    label: 'ระทึกขวัญ-สืบสวน',
    hint: 'ฆาตกรรม ปริศนา หักมุม',
    tone: 'Thai crime thriller, tense, mysterious, plot twist',
    sample: 'a Thai detective examining clues in a dim alley at night, rain and flashlights',
    substyles: ['สืบฆาตกรรม', 'ปริศนาหักมุม', 'จิตวิทยา', 'ปล้น'],
  },
  {
    id: 'documentary',
    label: 'สารคดี-เล่าเรื่องจริง',
    hint: 'เรื่องจริง บุคคล เหตุการณ์',
    tone: 'documentary storytelling, factual, cinematic reconstruction',
    sample: 'an old Thai fisherman mending nets at dawn on a wooden pier, documentary photo',
    substyles: ['ชีวิตคนจริง', 'เหตุการณ์ดัง', 'ธุรกิจ-แรงบันดาลใจ', 'ธรรมชาติ'],
  },
  {
    id: 'custom',
    label: 'ระบุเอง',
    hint: 'บอกแนวเรื่องเองในไอเดียเรื่อง',
    tone: 'cinematic storytelling',
    sample: 'a cinematic Thai street scene at dusk with a lone traveler',
    substyles: [],
  },
];

const STYLES = [
  { id: 'realistic', label: 'ภาพสไตล์สมจริง', hint: 'คนและสถานที่สมจริง รายละเอียดเป็นธรรมชาติ', prompt: 'photorealistic, natural light, highly detailed, 35mm photo' },
  { id: 'cinematic', label: 'ภาพสไตล์ภาพยนตร์', hint: 'แสงเงาแบบภาพยนตร์ อารมณ์ชัด มีมิติ', prompt: 'cinematic film still, dramatic lighting, shallow depth of field, color graded' },
  { id: 'vintage', label: 'ภาพสีเก่า', hint: 'ฟิล์มสีเก่าย้อนยุค สีซีด มีเกรน', prompt: 'vintage 1970s color film photo, faded colors, film grain, scratches' },
  { id: 'noir', label: 'ภาพสไตล์ขาวดำ', hint: 'โทนขาวดำ เงาลึก หมอก บรรยากาศเก่า', prompt: 'black and white film noir, deep shadows, high contrast, fog' },
  { id: 'cartoon2d', label: 'ภาพสไตล์ 2D', hint: 'ภาพวาดสองมิติ ลายเส้นและสีชัดเจน', prompt: '2D illustrated cartoon, clean bold outlines, flat vibrant colors' },
  { id: 'anime', label: 'ภาพสไตล์อนิเมะ', hint: 'อนิเมะคุณภาพสูง รายละเอียด แสงภาพยนตร์', prompt: 'high quality anime key visual, detailed background, cinematic lighting' },
  { id: 'watercolor', label: 'ภาพสีน้ำ', hint: 'สีไหลฟุ้ง เม็ดสี บรรยากาศบนกระดาษ', prompt: 'watercolor painting on textured paper, soft bleeding colors, delicate ink lines' },
  { id: 'pencil', label: 'ภาพสีไม้', hint: 'เส้นสีไม้เข้ม แรงเงาหนัก กระดาษหยาบ', prompt: 'colored pencil drawing, heavy cross-hatching, rough paper texture' },
  { id: 'cgi3d', label: 'ภาพสไตล์ 3D', hint: 'ตัวละครสามมิติ มีคาแรกเตอร์และมิติ', prompt: '3D animated film style, stylized characters, soft global illumination' },
  { id: 'fantasy', label: 'แฟนตาซี CGI', hint: 'โลกเหนือจริง แสงศักดิ์สิทธิ์ เอฟเฟกต์', prompt: 'epic fantasy CGI concept art, glowing magic, grand scale, volumetric light' },
  { id: 'papercut', label: 'ภาพกระดาษซ้อน', hint: 'กระดาษตัดหลายชั้น มีขอบและเงา', prompt: 'layered paper cut art, papercraft diorama, soft shadows between layers' },
];

/** Lengths offered (short vertical videos) → number of shots the script asks for. */
const LENGTHS = [
  { sec: 60, label: '1 นาที', shots: 10 },
  { sec: 120, label: '2 นาที', shots: 18 },
  { sec: 180, label: '3 นาที', shots: 26 },
];

/** Visual modes: how shots become moving pictures. */
const VISUAL_MODES = [
  { id: 'clips', label: 'วิดีโอเคลื่อนไหวทุกช็อต (แนะนำ)', hint: 'ตัวละครขยับ พูด และแสดงอารมณ์ทุกช็อตด้วย MiniMax H3 ยาวเท่าบทพูด เหมือนละครจริง', clipShare: 1 },
  { id: 'mixed', label: 'ผสม: ช็อตสำคัญเป็นวิดีโอ', hint: 'ช็อตไคลแมกซ์เป็นวิดีโอ H3 (~30%) ที่เหลือภาพนิ่งขยับกล้อง ประหยัดกว่า', clipShare: 0.3 },
  { id: 'stills', label: 'ภาพนิ่งขยับกล้อง', hint: 'สไลด์ภาพ AI ซูม/แพน เร็วและถูกที่สุด (ไม่ใช่วิดีโอเคลื่อนไหว)', clipShare: 0 },
];

const genreOf = (id) => GENRES.find((g) => g.id === id) ?? GENRES.find((g) => g.id === 'custom');
const styleOf = (id) => STYLES.find((s) => s.id === id) ?? STYLES[0];
const lengthOf = (sec) => LENGTHS.find((l) => l.sec === Number(sec)) ?? LENGTHS[0];

/** Image prompt for the style gallery: the genre's sample scene in that style, vertical. */
const previewPrompt = (genreId, styleId) => `${genreOf(genreId).sample}. ${styleOf(styleId).prompt}. Vertical composition. No text, no letters, no watermark.`;

/** Work an approach needs, shown before the user starts (counts, not prices: provider prices change). */
function estimate({ lengthSec, visualMode, shots = null, characters = 4 }) {
  const n = shots ?? lengthOf(lengthSec).shots;
  const share = (VISUAL_MODES.find((m) => m.id === visualMode) ?? VISUAL_MODES[0]).clipShare;
  const clips = Math.round(n * share);
  return {
    shots: n,
    images: n + characters + 1,
    clips,
    clipSeconds: clips * 6,
    voiceLines: Math.round(n * 1.6),
    minutes: Math.max(3, Math.round(n * 0.4 + clips * 1.5)),
  };
}

module.exports = { GENRES, STYLES, LENGTHS, VISUAL_MODES, genreOf, styleOf, lengthOf, previewPrompt, estimate };
