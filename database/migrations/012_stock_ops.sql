-- =====================================================================
-- 012_stock_ops — stock counts (stocktake) with variance approval, per-warehouse reorder
-- levels, in-app notifications (low stock / out of stock) and new permissions
-- For databases installed from schema.sql BEFORE this change.
-- Import once via phpMyAdmin > Import. Compatible with MySQL 8 / MariaDB 10.6+.
-- =====================================================================

ALTER TABLE stock_levels
  ADD COLUMN reorder_point DECIMAL(14,3) NULL COMMENT 'per-warehouse override of products.reorder_point' AFTER reserved,
  ADD COLUMN max_qty DECIMAL(14,3) NULL COMMENT 'order-up-to level' AFTER reorder_point;

ALTER TABLE stock_movements
  MODIFY COLUMN type ENUM('purchase','sale','return','adjustment','transfer_in','transfer_out','opening','count','waste') NOT NULL;

CREATE TABLE stock_counts (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id       BIGINT UNSIGNED NOT NULL,
  warehouse_id BIGINT UNSIGNED NOT NULL,
  count_no     VARCHAR(30) NOT NULL,
  scope        ENUM('full','category') NOT NULL DEFAULT 'full',
  category_id  BIGINT UNSIGNED NULL,
  blind        TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'counters do not see the system quantity',
  status       ENUM('counting','review','approved','cancelled') NOT NULL DEFAULT 'counting',
  note         VARCHAR(255) NULL,
  start_movement_id BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'last stock_movements.id included in the snapshot',
  created_by   BIGINT UNSIGNED NOT NULL,
  approved_by  BIGINT UNSIGNED NULL,
  approved_at  DATETIME NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_sc_org (org_id, status),
  CONSTRAINT fk_sc_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_sc_wh FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_count_items (
  count_id     BIGINT UNSIGNED NOT NULL,
  product_id   BIGINT UNSIGNED NOT NULL,
  snapshot_qty DECIMAL(14,3) NOT NULL COMMENT 'system quantity when the count started',
  unit_cost    DECIMAL(14,2) NOT NULL DEFAULT 0,
  counted_qty  DECIMAL(14,3) NULL,
  counted_by   BIGINT UNSIGNED NULL,
  counted_at   DATETIME NULL,
  reason       VARCHAR(200) NULL,
  PRIMARY KEY (count_id, product_id),
  CONSTRAINT fk_sci_count FOREIGN KEY (count_id) REFERENCES stock_counts(id) ON DELETE CASCADE,
  CONSTRAINT fk_sci_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notifications (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id      BIGINT UNSIGNED NOT NULL,
  type        VARCHAR(40) NOT NULL,
  severity    ENUM('info','warning','danger') NOT NULL DEFAULT 'info',
  title       VARCHAR(191) NOT NULL,
  body        TEXT NULL,
  link        VARCHAR(255) NULL,
  permission  VARCHAR(50) NULL COMMENT 'only users with this permission see it',
  ref_key     VARCHAR(191) NOT NULL COMMENT 'dedupe key, e.g. out:2:15:2026-10-20',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_notif_ref (org_id, ref_key),
  KEY idx_notif_org_time (org_id, created_at),
  CONSTRAINT fk_notif_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notification_reads (
  notification_id BIGINT UNSIGNED NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  read_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (notification_id, user_id),
  CONSTRAINT fk_nr_notif FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permissions (id, code, module, description) VALUES
  (24, 'inventory:count', 'inventory', 'ตรวจนับสต๊อก (สแกนนับ)'),
  (25, 'inventory:approve', 'inventory', 'อนุมัติผลตรวจนับและส่วนต่าง'),
  (26, 'purchasing:write', 'inventory', 'สั่งซื้อ รับของ และโอนย้ายระหว่างสาขา');
-- owner, admin, manager: all three; cashier: counting only
INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES
  (1, 24), (1, 25), (1, 26), (2, 24), (2, 25), (2, 26), (3, 24), (3, 25), (3, 26), (5, 24);

INSERT INTO schema_migrations (version) VALUES ('012_stock_ops');
