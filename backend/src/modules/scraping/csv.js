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
  commissionRate: ['commission', 'commission rate', 'commissionrate', 'commission %', 'commission (%)', 'ค่าคอม', 'ค่าคอมมิชชัน', 'ค่าคอม (%)', 'ค่าคอมมิชชั่น'],
  category: ['category', 'หมวดหมู่', 'หมวด'],
};
const FIELDS = Object.keys(ALIASES);
const norm = (h) => String(h).trim().toLowerCase().replace(/[_\s]+/g, ' ');

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
  const s = String(v).trim().replace(/[฿,\s+]/g, '').replace(/บาท|ชิ้น/g, '');
  if (!s) return null;
  const m = s.match(/^(-?\d+(?:\.\d+)?)([kKmM]|พัน|หมื่น|แสน|ล้าน)?%?$/);
  if (!m) return null;
  const mult = { k: 1e3, K: 1e3, m: 1e6, M: 1e6, พัน: 1e3, หมื่น: 1e4, แสน: 1e5, ล้าน: 1e6 }[m[2]] ?? 1;
  return Number(m[1]) * mult;
}

/**
 * CSV text → trend items + per-row errors.
 * @param {string} text
 * @param {{platform:string, mapping?:Record<string,number>}} opts
 */
function csvToItems(text, { platform, mapping: override } = {}) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { header: rows[0] ?? [], mapping: {}, items: [], errors: [{ row: 1, message: 'ไม่พบข้อมูล (ต้องมีหัวตาราง + อย่างน้อย 1 แถว)' }] };
  const [header, ...data] = rows;
  const mapping = { ...detectMapping(header), ...(override ?? {}) };
  const items = [];
  const errors = [];
  if (mapping.title === undefined) errors.push({ row: 1, message: 'ไม่พบคอลัมน์ชื่อสินค้า กรุณาเลือกคอลัมน์ "ชื่อสินค้า"' });
  else {
    data.forEach((r, i) => {
      const get = (f) => (mapping[f] === undefined ? null : (r[mapping[f]] ?? '').trim() || null);
      const title = get('title');
      if (!title) {
        errors.push({ row: i + 2, message: 'ไม่มีชื่อสินค้า' });
        return;
      }
      let commission = parseNumber(get('commissionRate'));
      // Fractions ("0.12") are rates, not percents
      if (commission != null && commission > 0 && commission < 1 && !String(get('commissionRate')).includes('%')) commission *= 100;
      items.push({
        platform,
        externalId: get('externalId'),
        title,
        url: get('url'),
        imageUrl: get('imageUrl'),
        shopName: get('shopName'),
        price: parseNumber(get('price')),
        soldCount: parseNumber(get('soldCount')),
        rating: parseNumber(get('rating')),
        commissionRate: commission,
        category: get('category'),
      });
    });
  }
  return { header, mapping, items, errors };
}

module.exports = { parseCsv, detectMapping, parseNumber, csvToItems, FIELDS };
