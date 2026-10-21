'use strict';

const db = require('../../db/pool');

/**
 * Shop VAT settings (Settings > ภาษีมูลค่าเพิ่ม), read wherever VAT is computed:
 *   vatRegistered  organizations.vat_registered — an unregistered shop never charges or records VAT
 *   vatRate        setting tax.vat_rate (percent, Thai standard 7)
 *   defaultVatType setting tax.default_vat_type — preselected for new products
 * The product/line VAT type 'vat7' means "the shop's standard rate", whatever vatRate is.
 */
const DEFAULT_RATE = 7;
const VAT_TYPES = ['vat7', 'exempt', 'zero'];
const KEYS = { vatRate: 'tax.vat_rate', defaultVatType: 'tax.default_vat_type' };

// MySQL returns JSON parsed, MariaDB as text
const parse = (v) => {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

async function getTaxSettings(orgId) {
  const org = await db.one('SELECT vat_registered FROM organizations WHERE id = :orgId', { orgId });
  const rows = await db.query('SELECT setting_key, value FROM settings WHERE org_id = :orgId AND setting_key IN (:keys)', {
    orgId,
    keys: Object.values(KEYS),
  });
  const get = (key) => parse(rows.find((r) => r.setting_key === key)?.value);
  const rate = Number(get(KEYS.vatRate));
  const type = get(KEYS.defaultVatType);
  return {
    vatRegistered: org ? Boolean(org.vat_registered) : true,
    vatRate: Number.isFinite(rate) && rate >= 0 && rate <= 30 ? rate : DEFAULT_RATE,
    defaultVatType: VAT_TYPES.includes(type) ? type : 'vat7',
  };
}

async function saveTaxSettings(orgId, { vatRegistered, vatRate, defaultVatType }) {
  if (vatRegistered !== undefined) {
    await db.query('UPDATE organizations SET vat_registered = :v WHERE id = :orgId', { orgId, v: vatRegistered ? 1 : 0 });
  }
  for (const [field, value] of Object.entries({ vatRate, defaultVatType })) {
    if (value === undefined) continue;
    await db.query(
      `INSERT INTO settings (org_id, setting_key, value) VALUES (:orgId, :key, :value)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      { orgId, key: KEYS[field], value: JSON.stringify(value) },
    );
  }
  return getTaxSettings(orgId);
}

/** Percent that applies to a line: 0 for exempt/zero lines or when the shop is not VAT registered. */
const lineRate = (tax, vatType) => (tax.vatRegistered && vatType === 'vat7' ? tax.vatRate : 0);

module.exports = { getTaxSettings, saveTaxSettings, lineRate, VAT_TYPES, DEFAULT_RATE };
