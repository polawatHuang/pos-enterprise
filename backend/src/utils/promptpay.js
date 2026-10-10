'use strict';

/**
 * Thai PromptPay QR payload (EMVCo Merchant-Presented Mode, BOT spec).
 * Accepts a mobile number (10 digits), national/tax ID (13 digits) or e-wallet ID (15 digits).
 * Pure function — render the returned string as a QR code on the client.
 */
const AID = 'A000000677010111';

const tlv = (id, value) => `${id}${String(value.length).padStart(2, '0')}${value}`;

function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i += 1) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j += 1) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function normalizeTarget(id) {
  const digits = String(id).replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) return { tag: '01', value: `0066${digits.slice(1)}`.padStart(13, '0') };
  if (digits.length === 13) return { tag: '02', value: digits };
  if (digits.length === 15) return { tag: '03', value: digits };
  return null;
}

function isValidPromptPayId(id) {
  return normalizeTarget(id) !== null;
}

/** @param {string} id  @param {number} [amount] THB; omitted -> payer types the amount */
function promptPayPayload(id, amount) {
  const target = normalizeTarget(id);
  if (!target) throw new Error('Invalid PromptPay ID');
  const parts = [
    tlv('00', '01'),
    tlv('01', amount ? '12' : '11'), // 12 = single-use (with amount), 11 = reusable
    tlv('29', tlv('00', AID) + tlv(target.tag, target.value)),
    tlv('53', '764'),
    ...(amount ? [tlv('54', Number(amount).toFixed(2))] : []),
    tlv('58', 'TH'),
  ];
  const body = `${parts.join('')}6304`;
  return body + crc16(body);
}

module.exports = { promptPayPayload, isValidPromptPayId, crc16 };
