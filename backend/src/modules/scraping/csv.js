'use strict';

/** RFC 4180 CSV (quotes, escaped quotes, CRLF, embedded newlines). Also accepts tab-separated text. */
function parseCsv(text) {
  const src = String(text).replace(/^\uFEFF/, '');
  const firstLine = src.slice(0, src.indexOf('\n') === -1 ? src.length : src.indexOf('\n'));
  const sep = (firstLine.match(/\t/g) ?? []).length > (firstLine.match(/,/g) ?? []).length ? '\t' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/** Header aliases (lower-cased, spaces/underscores collapsed) used to auto-map export files. */
const ALIASES = {
  title: ['title', 'name', 'product', 'product name', 'productname', 'item name', 'ชื่อสินค้า', 'สินค้า', 'ชื่อ'],
  externalId: ['id', 'item id', 'itemid', 'product id', 'productid', 'sku', 'รหัสสินค้า', 'รหัส'],
  url: ['url', 'link', 'product link', 'productlink', 'offer link', 'ลิงก์', 'ลิงก์สินค้า', 'ลิ้งค์'],
  imageUrl: ['image', 'image url', 'imageurl', 'รูป', 'รูปภาพ', 'รูปสินค้า'],
  shopName: ['shop', 'shop name', 'shopname', 'store', 'seller', 'ร้าน', 'ชื่อร้าน', 'ร้านค้า'],
  price: ['price', 'price (thb)', 'price min', 'pricemin', 'ราคา', 'ราคา (บาท)', 'ราคาขาย'],
  soldCount: ['sold', 'sales', 'units sold', 'item sold', 'total sold', 'ยอดขาย', 'ขายแล้ว', 'จำนวนที่ขาย', 'ยอดขาย (ชิ้น)'],
  rating: ['rating', 'ratingstar', 'rating star', 'stars', 'คะแนน', 'เรตติ้ง', 'คะแนนรีวิว'],
  commissionRate: [
    'commission',
    'commission rate',
    'commissionrate',
    'commission %',
    'commission (%)',
    'ค่าคอม',
    'ค่าคอมมิชชัน',
    'ค่าคอม (%)',
    'ค่าคอมมิชชั่น',
  ],
  category: ['category', 'หมวดหมู่', 'หมวด'],
  categoryRank: ['rank', 'category rank', 'ranking', 'อันดับ', 'อันดับในหมวด', 'อันดับหมวด'],
  monthlySold: [
    'monthly sold',
    'sold last month',
    'sold 30 days',
    'sold (30 days)',
    'ขายเดือนที่แล้ว',
    'ยอดขายเดือนที่แล้ว',
    'ยอดขาย 30 วัน',
    'ขายแล้วเมื่อเดือนที่แล้ว',
  ],
  prevMonthlySold: ['previous month sold', 'prev monthly sold', 'sold 2 months ago', 'ขายเดือนก่อน', 'ยอดขายเดือนก่อน', 'ยอดขายเดือนก่อนหน้า'],
  reviewCount: ['reviews', 'review count', 'reviewcount', 'จำนวนรีวิว', 'รีวิว'],
  mediaReviewCount: ['media reviews', 'photo reviews', 'photo/video reviews', 'รีวิวรูป', 'รีวิวรูปภาพ', 'รีวิวรูป/วิดีโอ', 'รีวิวภาพถ่าย'],
  positiveReviewPct: ['positive reviews', 'positive review %', 'positive %', '% รีวิวดี', 'รีวิวดี', 'รีวิวเชิงบวก', 'รีวิวเชิงบวก (%)'],
  shopRating: ['shop rating', 'store rating', 'seller rating', 'คะแนนร้าน', 'คะแนนร้านค้า', 'ดาวร้าน'],
  shopResponseRate: ['response rate', 'chat response rate', 'อัตราการตอบกลับ', 'อัตราการตอบกลับ (%)', 'อัตราตอบกลับ', 'ตอบกลับ'],
  shopShip48Rate: [
    'shipped within 48h',
    'ship 48h',
    'ship48',
    'จัดส่งภายใน 48 ชม.',
    'จัดส่งภายใน 48 ชม. (%)',
    'จัดส่งภายใน 48 ชั่วโมง',
    'จัดส่งใน 48 ชม.',
    'ส่งภายใน 48 ชม.',
  ],
  hasFlashSale: ['flash sale', 'flashsale', 'แฟลชเซล', 'แฟลชเซลล์', 'flash'],
};
/** Fields parsed as numbers (everything except text fields and the flash-sale flag). */
const NUMERIC = [
  'price',
  'soldCount',
  'rating',
  'categoryRank',
  'monthlySold',
  'prevMonthlySold',
  'reviewCount',
  'mediaReviewCount',
  'positiveReviewPct',
  'shopRating',
  'shopResponseRate',
  'shopShip48Rate',
];
/** Percent fields given as a fraction ("0.92") are converted to percent. */
const PERCENT = ['commissionRate', 'positiveReviewPct', 'shopResponseRate', 'shopShip48Rate'];
const FIELDS = Object.keys(ALIASES);
const norm = (h) =>
  String(h)
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ');

/** @returns {Record<string, number>} field → column index (only detected fields) */
function detectMapping(header) {
  const mapping = {};
  header.forEach((h, idx) => {
    const n = norm(h);
    for (const f of FIELDS) if (mapping[f] === undefined && ALIASES[f].includes(n)) mapping[f] = idx;
  });
  return mapping;
}

/** "12,345", "฿199", "1.2k", "3.4K+", "1.5M", "15%" → number */
function parseNumber(v) {
  if (v == null) return null;
  const s = String(v)
    .trim()
    .replace(/[฿,\s+]/g, '')
    .replace(/บาท|ชิ้น/g, '');
  if (!s) return null;
  const m = s.match(/^(-?\d+(?:\.\d+)?)([kKmM]|พัน|หมื่น|แสน|ล้าน)?%?$/);
  if (!m) return null;
  const mult =
    {
      k: 1e3,
      K: 1e3,
      m: 1e6,
      M: 1e6,
      พัน: 1e3,
      หมื่น: 1e4,
      แสน: 1e5,
      ล้าน: 1e6,
    }[m[2]] ?? 1;
  return Number(m[1]) * mult;
}

/** Title prefix of the sample rows in the downloadable template. */
const SAMPLE_MARK = '[ตัวอย่าง]';

/**
 * CSV text → trend items + per-row errors. Sample rows (SAMPLE_MARK) are skipped unless allowSample.
 * @param {string} text
 * @param {{platform:string, mapping?:Record<string,number>}} opts
 */
function csvToItems(text, { platform, mapping: override, allowSample = false } = {}) {
  const rows = parseCsv(text);
  if (rows.length < 2)
    return {
      header: rows[0] ?? [],
      mapping: {},
      items: [],
      errors: [{ row: 1, message: 'ไม่พบข้อมูล (ต้องมีหัวตาราง + อย่างน้อย 1 แถว)' }],
    };
  const [header, ...data] = rows;
  const mapping = { ...detectMapping(header), ...(override ?? {}) };
  const items = [];
  const errors = [];
  if (mapping.title === undefined)
    errors.push({
      row: 1,
      message: 'ไม่พบคอลัมน์ชื่อสินค้า กรุณาเลือกคอลัมน์ "ชื่อสินค้า"',
    });
  else {
    data.forEach((r, i) => {
      const get = (f) => (mapping[f] === undefined ? null : (r[mapping[f]] ?? '').trim() || null);
      const title = get('title');
      if (!title) {
        errors.push({ row: i + 2, message: 'ไม่มีชื่อสินค้า' });
        return;
      }
      // Rows left over from the downloadable sample must not become real trend items
      if (!allowSample && title.startsWith(SAMPLE_MARK)) {
        errors.push({ row: i + 2, message: 'เป็นแถวจากไฟล์ตัวอย่าง (แก้เป็นข้อมูลจริงหรือลบแถว)' });
        return;
      }
      const item = {
        platform,
        externalId: get('externalId'),
        title,
        url: get('url'),
        imageUrl: get('imageUrl'),
        shopName: get('shopName'),
        category: get('category'),
      };
      for (const f of NUMERIC) item[f] = parseNumber(get(f));
      item.commissionRate = parseNumber(get('commissionRate'));
      // Fractions ("0.12") are rates, not percents
      for (const f of PERCENT) {
        const v = item[f];
        if (v != null && v > 0 && v < 1 && !String(get(f)).includes('%')) item[f] = v * 100;
      }
      item.hasFlashSale = get('hasFlashSale');
      items.push(item);
    });
  }
  return { header, mapping, items, errors };
}

/* ----------------------------------------------------------------- template */

/**
 * Sample file users download to see the expected layout. Headers are aliases above, so the file
 * maps itself on import (checked in test/phase5b.test.js). Rows follow docs/PRODUCT_RESEARCH.md;
 * blank cells are fine — unknown data shows as "ยังไม่มีข้อมูล" in the checklist.
 */
const TEMPLATE_COLUMNS = [
  { field: 'title', header: 'ชื่อสินค้า', required: true, description: 'ชื่อสินค้าตามหน้าร้าน' },
  { field: 'externalId', header: 'รหัสสินค้า', description: 'Item ID/SKU ใช้จับคู่ตอนนำเข้าซ้ำ ถ้าเว้นว่าง ระบบใช้ชื่อสินค้า + ร้านแทน' },
  { field: 'url', header: 'ลิงก์สินค้า', description: 'ลิงก์หน้าสินค้า (ใช้สร้างลิงก์ affiliate)' },
  { field: 'shopName', header: 'ชื่อร้าน', description: 'ชื่อร้านที่ขาย' },
  { field: 'category', header: 'หมวดหมู่', description: 'สะกดให้เหมือนกันทุกแถวในหมวดเดียวกัน ระบบใช้เทียบกับยอดขายสูงสุดของหมวด' },
  { field: 'categoryRank', header: 'อันดับในหมวด', description: 'อันดับในหน้า "สินค้ายอดนิยม" (30 วัน) ของหมวด — อันดับ 1–10 ถือว่าตลาดอิ่มตัว' },
  { field: 'price', header: 'ราคา', description: 'ราคาขาย (บาท) ตัวเลขอย่างเดียว' },
  { field: 'soldCount', header: 'ขายแล้ว', description: 'ยอดขายสะสม ตัวเลข "ขายแล้ว X ชิ้น" (ใส่ 1.2k หรือ 1,200 ก็ได้)' },
  { field: 'monthlySold', header: 'ยอดขายเดือนที่แล้ว', description: 'ยอดขายในเดือนที่ผ่านมา (ตัวเลข "ขายแล้ว X เมื่อเดือนที่แล้ว")' },
  { field: 'prevMonthlySold', header: 'ยอดขายเดือนก่อนหน้า', description: 'ยอดขายของเดือนก่อนหน้านั้น ใช้ดูว่ายอดกำลังขึ้นหรือลง (ขาลง = เลยจุดสูงสุดแล้ว)' },
  { field: 'rating', header: 'คะแนนรีวิว', description: 'ดาวสินค้าเฉลี่ย 0–5 (เกณฑ์ 4.5 ขึ้นไป)' },
  { field: 'reviewCount', header: 'จำนวนรีวิว', description: 'จำนวนรีวิวทั้งหมด' },
  { field: 'mediaReviewCount', header: 'รีวิวรูป/วิดีโอ', description: 'จำนวนรีวิวที่มีรูปหรือวิดีโอจากผู้ซื้อจริง' },
  { field: 'positiveReviewPct', header: 'รีวิวเชิงบวก (%)', description: 'สัดส่วนรีวิว 4–5 ดาว (เกณฑ์ 80% ขึ้นไป)' },
  { field: 'shopRating', header: 'คะแนนร้าน', description: 'คะแนนร้าน 0–5 (เกณฑ์ 4.5 ขึ้นไป)' },
  { field: 'shopResponseRate', header: 'อัตราการตอบกลับ (%)', description: 'อัตราการตอบกลับแชตของร้าน (เกณฑ์ 75% ขึ้นไป)' },
  { field: 'shopShip48Rate', header: 'จัดส่งภายใน 48 ชม. (%)', description: 'สัดส่วนออร์เดอร์ที่ส่งภายใน 48 ชั่วโมง (เกณฑ์ 65% ขึ้นไป)' },
  { field: 'commissionRate', header: 'ค่าคอม (%)', description: 'ค่าคอมมิชชัน % (เกณฑ์ 8% ขึ้นไป) ใส่ 12 หรือ 0.12 ก็ได้' },
  { field: 'hasFlashSale', header: 'แฟลชเซล', description: 'มี / ไม่มี — เว้นว่างถ้าไม่ทราบ' },
];

const TEMPLATE_ROWS = [
  {
    title: `${SAMPLE_MARK} เสื้อยืดโอเวอร์ไซซ์ผ้าคอตตอน`,
    externalId: 'EX-1001',
    url: 'https://example.com/products/oversize-tshirt',
    shopName: 'Basic Wear',
    category: 'เสื้อยืด',
    categoryRank: 16,
    price: 199,
    soldCount: 29000,
    monthlySold: 7400,
    prevMonthlySold: 6100,
    rating: 4.7,
    reviewCount: 4800,
    mediaReviewCount: 1250,
    positiveReviewPct: 92,
    shopRating: 4.8,
    shopResponseRate: 90,
    shopShip48Rate: 82,
    commissionRate: 10,
    hasFlashSale: 'มี',
  },
  {
    title: `${SAMPLE_MARK} กล่องใส่รองเท้าแบบใส`,
    externalId: 'EX-1002',
    url: 'https://example.com/products/clear-shoe-box',
    shopName: 'Neat Box',
    category: 'กล่องเก็บของ',
    categoryRank: 64,
    price: 89,
    soldCount: 3300,
    monthlySold: 900,
    prevMonthlySold: 700,
    rating: 4.6,
    reviewCount: 420,
    mediaReviewCount: 60,
    positiveReviewPct: 89,
    shopRating: 4.8,
    shopResponseRate: 94,
    shopShip48Rate: 89,
    commissionRate: 9,
    hasFlashSale: 'ไม่มี',
  },
  {
    // Partly filled on purpose: unknown cells may stay blank
    title: `${SAMPLE_MARK} ชั้นวางของเหล็ก 4 ชั้น`,
    shopName: 'Steel Home',
    category: 'ชั้นวางของ',
    categoryRank: 2,
    price: 499,
    soldCount: 23000,
    monthlySold: 3151,
    prevMonthlySold: 9800,
    rating: 4.5,
    commissionRate: 8,
  },
];

/** One CSV cell (RFC 4180): quote when it holds a separator, quote or newline. */
const csvCell = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Sample import file (CRLF, no BOM — the client adds one so Excel opens Thai text correctly). */
function csvTemplate() {
  const lines = [TEMPLATE_COLUMNS.map((c) => csvCell(c.header)).join(',')];
  for (const row of TEMPLATE_ROWS) lines.push(TEMPLATE_COLUMNS.map((c) => csvCell(row[c.field])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

module.exports = { parseCsv, detectMapping, parseNumber, csvToItems, csvTemplate, FIELDS, SAMPLE_MARK, TEMPLATE_COLUMNS, TEMPLATE_ROWS };
