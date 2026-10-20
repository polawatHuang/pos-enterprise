-- =====================================================================
-- 014_lots — lots / expiry dates (FEFO), near-expiry markdowns and waste
-- For databases installed from schema.sql BEFORE this change.
-- Import once via phpMyAdmin > Import. Compatible with MySQL 8 / MariaDB 10.6+.
-- =====================================================================

ALTER TABLE products
  ADD COLUMN track_expiry TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'receive with expiry dates, sell first-expiry-first-out' AFTER pack_size,
  ADD COLUMN shelf_life_days INT NULL COMMENT 'default expiry = received date + this' AFTER track_expiry;

CREATE TABLE stock_lots (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id        BIGINT UNSIGNED NOT NULL,
  warehouse_id  BIGINT UNSIGNED NOT NULL,
  product_id    BIGINT UNSIGNED NOT NULL,
  lot_no        VARCHAR(40) NULL,
  expiry_date   DATE NULL,
  quantity      DECIMAL(14,3) NOT NULL DEFAULT 0 COMMENT 'remaining in base units',
  unit_cost     DECIMAL(14,2) NOT NULL DEFAULT 0,
  markdown_pct  DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT 'near-expiry discount applied at the till',
  received_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_lot_fefo (warehouse_id, product_id, expiry_date),
  KEY idx_lot_expiry (org_id, expiry_date),
  CONSTRAINT fk_lot_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_lot_wh FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE,
  CONSTRAINT fk_lot_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE stock_movements
  ADD COLUMN lot_id BIGINT UNSIGNED NULL AFTER variant_id;

ALTER TABLE sales_order_items
  ADD COLUMN lot_allocations JSON NULL COMMENT '[{lotId, qty}] taken FEFO, restored on void' AFTER line_total;

ALTER TABLE stock_transfer_items
  ADD COLUMN lot_allocations JSON NULL COMMENT '[{lotId, qty, expiry, cost}] taken at the source' AFTER qty_received;

INSERT INTO schema_migrations (version) VALUES ('014_lots');
