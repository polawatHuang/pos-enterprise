-- =====================================================================
-- 020_reversals — undo a mistaken entry without losing history:
--   * an approved welfare withdrawal can be reversed (stock, lots and the 5250 journal go back)
--   * a POS return can be voided (stock taken back out, refund and journal reversed)
-- For databases installed from schema.sql BEFORE this change.
-- Import once via phpMyAdmin > Import. Compatible with MySQL 8 / MariaDB 10.6+.
-- =====================================================================

ALTER TABLE welfare_requests
  MODIFY COLUMN status ENUM('pending','approved','rejected','cancelled','reversed') NOT NULL DEFAULT 'pending',
  ADD COLUMN reversed_by BIGINT UNSIGNED NULL AFTER reject_reason,
  ADD COLUMN reversed_at DATETIME NULL AFTER reversed_by,
  ADD COLUMN reverse_reason VARCHAR(255) NULL AFTER reversed_at;

ALTER TABLE sales_returns
  ADD COLUMN voided_by BIGINT UNSIGNED NULL AFTER created_at,
  ADD COLUMN voided_at DATETIME NULL AFTER voided_by,
  ADD COLUMN void_reason VARCHAR(255) NULL AFTER voided_at;

ALTER TABLE sales_return_items
  ADD COLUMN lot_allocations JSON NULL COMMENT '[{lotId, qty}] put back on restock, taken again on void' AFTER amount;

INSERT INTO schema_migrations (version) VALUES ('020_reversals');
