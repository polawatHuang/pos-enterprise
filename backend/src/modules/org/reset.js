'use strict';

const db = require('../../db/pool');

/**
 * "Delete all demo data" (Settings > จัดการข้อมูล): clears every business record of the
 * organization and every other user, keeping only what a real shop needs to start: the
 * organization, branches, warehouses, chart of accounts, settings (PromptPay, bank account,
 * LINE), saved API keys, AI chat settings, and the owner/admin account that runs it.
 *
 * Scoped to one org_id, run in one transaction (all or nothing), children before parents so it
 * does not depend on cascade rules. Returns the number of rows removed per table.
 *
 * A database that has not imported every migration yet simply lacks some feature tables; there is
 * nothing to delete in them, so steps touching a missing table are skipped instead of failing
 * the whole reset.
 */
const STEPS = [
  ['notification_reads', 'DELETE r FROM notification_reads r JOIN notifications n ON n.id = r.notification_id WHERE n.org_id = :orgId'],
  ['notifications', 'DELETE FROM notifications WHERE org_id = :orgId'],
  ['cash_movements', 'DELETE m FROM cash_movements m JOIN pos_shifts s ON s.id = m.shift_id WHERE s.org_id = :orgId'],
  ['held_bills', 'DELETE FROM held_bills WHERE org_id = :orgId'],
  ['payment_slips', 'DELETE FROM payment_slips WHERE org_id = :orgId'],
  ['payments', 'DELETE FROM payments WHERE org_id = :orgId'],
  ['document_items', 'DELETE i FROM document_items i JOIN documents d ON d.id = i.document_id WHERE d.org_id = :orgId'],
  ['documents', 'DELETE FROM documents WHERE org_id = :orgId'],
  ['journal_lines', 'DELETE l FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.org_id = :orgId'],
  ['journal_entries', 'DELETE FROM journal_entries WHERE org_id = :orgId'],
  ['transactions', 'DELETE FROM transactions WHERE org_id = :orgId'],
  ['tax_reports', 'DELETE FROM tax_reports WHERE org_id = :orgId'],
  ['document_sequences', 'DELETE FROM document_sequences WHERE org_id = :orgId'],
  ['ai_offers', 'DELETE FROM ai_offers WHERE org_id = :orgId'],
  ['disputes', 'DELETE FROM disputes WHERE org_id = :orgId'],
  ['returns', 'DELETE FROM returns WHERE org_id = :orgId'],
  ['messages', 'DELETE m FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.org_id = :orgId'],
  ['conversations', 'DELETE FROM conversations WHERE org_id = :orgId'],
  ['sales_return_items', 'DELETE ri FROM sales_return_items ri JOIN sales_returns r ON r.id = ri.return_id WHERE r.org_id = :orgId'],
  ['sales_returns', 'DELETE FROM sales_returns WHERE org_id = :orgId'],
  ['sales_order_items', 'DELETE i FROM sales_order_items i JOIN sales_orders o ON o.id = i.order_id WHERE o.org_id = :orgId'],
  ['sales_orders', 'DELETE FROM sales_orders WHERE org_id = :orgId'],
  ['pos_shifts', 'DELETE FROM pos_shifts WHERE org_id = :orgId'],
  ['channels', 'DELETE FROM channels WHERE org_id = :orgId'],
  ['post_results', 'DELETE r FROM post_results r JOIN scheduled_posts p ON p.id = r.scheduled_post_id WHERE p.org_id = :orgId'],
  ['scheduled_posts', 'DELETE FROM scheduled_posts WHERE org_id = :orgId'],
  ['affiliate_links', 'DELETE FROM affiliate_links WHERE org_id = :orgId'],
  ['social_accounts', 'DELETE FROM social_accounts WHERE org_id = :orgId'],
  ['video_media', 'DELETE m FROM video_media m JOIN video_projects v ON v.id = m.video_project_id WHERE v.org_id = :orgId'],
  ['video_assets', 'DELETE a FROM video_assets a JOIN video_projects v ON v.id = a.video_project_id WHERE v.org_id = :orgId'],
  ['video_projects', 'DELETE FROM video_projects WHERE org_id = :orgId'],
  ['cover_assets', 'DELETE a FROM cover_assets a JOIN cover_projects c ON c.id = a.cover_id WHERE c.org_id = :orgId'],
  ['cover_projects', 'DELETE FROM cover_projects WHERE org_id = :orgId'],
  ['trending_snapshots', 'DELETE s FROM trending_snapshots s JOIN trending_products t ON t.id = s.trending_product_id WHERE t.org_id = :orgId'],
  ['trending_products', 'DELETE FROM trending_products WHERE org_id = :orgId'],
  ['scrape_runs', 'DELETE r FROM scrape_runs r JOIN scrape_sources s ON s.id = r.source_id WHERE s.org_id = :orgId'],
  ['scrape_sources', 'DELETE FROM scrape_sources WHERE org_id = :orgId'],
  ['trend_category_benchmarks', 'DELETE FROM trend_category_benchmarks WHERE org_id = :orgId'],
  ['channel_profiles', 'DELETE FROM channel_profiles WHERE org_id = :orgId'],
  ['stock_count_items', 'DELETE i FROM stock_count_items i JOIN stock_counts c ON c.id = i.count_id WHERE c.org_id = :orgId'],
  ['stock_counts', 'DELETE FROM stock_counts WHERE org_id = :orgId'],
  ['stock_transfer_items', 'DELETE i FROM stock_transfer_items i JOIN stock_transfers t ON t.id = i.transfer_id WHERE t.org_id = :orgId'],
  ['stock_transfers', 'DELETE FROM stock_transfers WHERE org_id = :orgId'],
  ['stock_lots', 'DELETE FROM stock_lots WHERE org_id = :orgId'],
  ['stock_movements', 'DELETE FROM stock_movements WHERE org_id = :orgId'],
  ['stock_levels', 'DELETE l FROM stock_levels l JOIN warehouses w ON w.id = l.warehouse_id WHERE w.org_id = :orgId'],
  ['purchase_order_items', 'DELETE i FROM purchase_order_items i JOIN purchase_orders p ON p.id = i.po_id WHERE p.org_id = :orgId'],
  ['purchase_orders', 'DELETE FROM purchase_orders WHERE org_id = :orgId'],
  ['product_knowledge', 'DELETE FROM product_knowledge WHERE org_id = :orgId'],
  ['product_units', 'DELETE FROM product_units WHERE org_id = :orgId'],
  ['product_variants', 'DELETE v FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.org_id = :orgId'],
  ['products', 'DELETE FROM products WHERE org_id = :orgId'],
  ['product_categories', 'DELETE FROM product_categories WHERE org_id = :orgId'],
  ['suppliers', 'DELETE FROM suppliers WHERE org_id = :orgId'],
  ['customers', 'DELETE FROM customers WHERE org_id = :orgId'],
  ['discount_codes', 'DELETE FROM discount_codes WHERE org_id = :orgId'],
  ['promotions', 'DELETE FROM promotions WHERE org_id = :orgId'],
  ['jobs', 'DELETE FROM jobs WHERE org_id = :orgId'],
  ['files', 'DELETE FROM files WHERE org_id = :orgId'],
  ['audit_logs', 'DELETE FROM audit_logs WHERE org_id = :orgId'],
  ['refresh_tokens', 'DELETE t FROM refresh_tokens t JOIN users u ON u.id = t.user_id WHERE u.org_id = :orgId AND u.id <> :keepUserId'],
  ['user_roles', 'DELETE r FROM user_roles r JOIN users u ON u.id = r.user_id WHERE u.org_id = :orgId AND u.id <> :keepUserId'],
  ['users', 'DELETE FROM users WHERE org_id = :orgId AND id <> :keepUserId'],
];

/** The phrase the user types in the confirmation dialog. */
const CONFIRM_PHRASE = 'ลบข้อมูลทั้งหมด';

/** Every table a statement reads or deletes from. */
const tablesOf = (sql) => [...new Set([...sql.matchAll(/\b(?:FROM|JOIN)\s+(\w+)/g)].map((m) => m[1]))];

/** Steps whose tables all exist; the rest are reported as skipped. */
function stepsToRun(existing) {
  const run = [];
  const skipped = [];
  for (const step of STEPS) (tablesOf(step[1]).every((t) => existing.has(t)) ? run : skipped).push(step);
  return { run, skipped: skipped.map(([table]) => table) };
}

async function existingTables() {
  const rows = await db.query('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
  return new Set(rows.map((r) => r.name));
}

async function resetOrgData({ orgId, keepUserId }) {
  const { run, skipped } = stepsToRun(await existingTables());
  const deleted = await db.tx(async (conn) => {
    const out = {};
    for (const [table, sql] of run) {
      const [r] = await conn.query(sql, { orgId, keepUserId });
      if (r.affectedRows) out[table] = r.affectedRows;
    }
    return out;
  });
  return { deleted, skipped };
}

module.exports = { resetOrgData, STEPS, CONFIRM_PHRASE, tablesOf, stepsToRun };
