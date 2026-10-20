-- =====================================================================
-- 013_purchasing — 7-Eleven style ordering: supplier lead times, product supplier + order
-- multiple, purchase orders from suggestions, receiving against POs, in-transit transfers
-- For databases installed from schema.sql BEFORE this change.
-- Import once via phpMyAdmin > Import. Compatible with MySQL 8 / MariaDB 10.6+.
-- =====================================================================

ALTER TABLE suppliers
  ADD COLUMN lead_time_days INT NOT NULL DEFAULT 2 COMMENT 'days from order to delivery' AFTER address,
  ADD COLUMN note VARCHAR(255) NULL AFTER lead_time_days,
  ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER note;

ALTER TABLE products
  ADD COLUMN supplier_id BIGINT UNSIGNED NULL COMMENT 'usual supplier' AFTER category_id,
  ADD COLUMN pack_size DECIMAL(12,3) NOT NULL DEFAULT 1 COMMENT 'order in multiples of this many base units' AFTER reorder_point,
  ADD KEY idx_product_supplier (supplier_id);

ALTER TABLE purchase_orders
  ADD COLUMN source ENUM('manual','suggestion') NOT NULL DEFAULT 'manual' AFTER status,
  ADD COLUMN sent_at DATETIME NULL AFTER note,
  ADD COLUMN received_at DATETIME NULL AFTER sent_at;

CREATE TABLE stock_transfers (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id            BIGINT UNSIGNED NOT NULL,
  transfer_no       VARCHAR(30) NOT NULL,
  from_warehouse_id BIGINT UNSIGNED NOT NULL,
  to_warehouse_id   BIGINT UNSIGNED NOT NULL,
  status            ENUM('in_transit','received','cancelled') NOT NULL DEFAULT 'in_transit',
  note              VARCHAR(255) NULL,
  created_by        BIGINT UNSIGNED NOT NULL,
  received_by       BIGINT UNSIGNED NULL,
  shipped_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  received_at       DATETIME NULL,
  KEY idx_tr_org (org_id, status),
  CONSTRAINT fk_tr_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_tr_from FOREIGN KEY (from_warehouse_id) REFERENCES warehouses(id),
  CONSTRAINT fk_tr_to FOREIGN KEY (to_warehouse_id) REFERENCES warehouses(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_transfer_items (
  transfer_id   BIGINT UNSIGNED NOT NULL,
  product_id    BIGINT UNSIGNED NOT NULL,
  qty_sent      DECIMAL(14,3) NOT NULL,
  qty_received  DECIMAL(14,3) NULL,
  PRIMARY KEY (transfer_id, product_id),
  CONSTRAINT fk_tri_tr FOREIGN KEY (transfer_id) REFERENCES stock_transfers(id) ON DELETE CASCADE,
  CONSTRAINT fk_tri_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_migrations (version) VALUES ('013_purchasing');
