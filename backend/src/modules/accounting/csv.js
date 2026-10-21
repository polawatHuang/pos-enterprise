'use strict';

/**
 * Quote every cell and neutralise spreadsheet formula injection (=, +, -, @ prefixes). Plain
 * numbers such as "-1250.00" (a loss, a contra balance) stay numeric so Excel can sum them.
 */
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** Money as a plain 2-decimal string (no thousands separator) for spreadsheets. */
const money = (n) => (n == null || n === '' ? '' : Number(n).toFixed(2));

/**
 * Send rows as a CSV download: UTF-8 with BOM so Excel shows Thai, CRLF line endings.
 * @param {import('express').Response} res
 * @param {string} filename  ASCII file name, e.g. "balance-sheet-2026-10-31.csv"
 * @param {unknown[][]} rows  header row first
 */
function sendCsv(res, filename, rows) {
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.set('Cache-Control', 'no-store');
  res.send(`\uFEFF${csv}\r\n`);
}

module.exports = { csvCell, money, sendCsv };
