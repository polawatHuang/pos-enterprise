'use strict';

/**
 * Amount in Thai words as printed on Thai invoices/receipts:
 *   1501.25 -> "หนึ่งพันห้าร้อยเอ็ดบาทยี่สิบห้าสตางค์", 100 -> "หนึ่งร้อยบาทถ้วน"
 */
const DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

/** Reads an integer below one million. `afterMillion`: a lone trailing 1 is read "เอ็ด". */
function readChunk(n, afterMillion = false) {
  const s = String(n);
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const d = Number(s[i]);
    const place = s.length - i - 1;
    if (d === 0) continue;
    if (place === 1 && d === 1) out += 'สิบ';
    else if (place === 1 && d === 2) out += 'ยี่สิบ';
    else if (place === 0 && d === 1 && (s.length > 1 || afterMillion)) out += 'เอ็ด';
    else out += DIGITS[d] + PLACES[place];
  }
  return out;
}

function readInteger(n) {
  if (n === 0) return DIGITS[0];
  let out = '';
  let rest = n;
  const chunks = [];
  while (rest > 0) {
    chunks.unshift(rest % 1_000_000);
    rest = Math.floor(rest / 1_000_000);
  }
  chunks.forEach((c, i) => {
    out += readChunk(c, i > 0);
    if (i < chunks.length - 1) out += 'ล้าน';
  });
  return out;
}

function thaiBahtText(amount) {
  const value = Math.round(Math.abs(Number(amount) || 0) * 100);
  const baht = Math.floor(value / 100);
  const satang = value % 100;
  const prefix = Number(amount) < 0 ? 'ลบ' : '';
  if (baht === 0 && satang === 0) return 'ศูนย์บาทถ้วน';
  const bahtText = baht > 0 ? `${readInteger(baht)}บาท` : '';
  return `${prefix}${bahtText}${satang ? `${readInteger(satang)}สตางค์` : 'ถ้วน'}`;
}

module.exports = { thaiBahtText };
