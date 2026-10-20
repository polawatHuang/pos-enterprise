-- =====================================================================
-- 011_pos_retail — POS upgrade: pack/carton units, held bills, split payments,
-- cash in/out, members & points, PromptPay slip check, category sale-hour rules
-- For databases installed from schema.sql BEFORE this change.
-- Import once via phpMyAdmin > Import. Compatible with MySQL 8 / MariaDB 10.6+.
-- =====================================================================

ALTER TABLE product_categories
  ADD COLUMN sale_block JSON NULL COMMENT '{"from":"00:00","to":"11:00","label":"..."} no-sale window (local time)' AFTER sort_order,
  ADD COLUMN age_restricted TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'ask the customer to confirm age 20+' AFTER sale_block;

CREATE TABLE product_units (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id      BIGINT UNSIGNED NOT NULL,
  product_id  BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(30) NOT NULL COMMENT 'แพ็ก, ลัง, ...',
  factor      DECIMAL(12,3) NOT NULL COMMENT 'base units per this unit',
  barcode     VARCHAR(64) NULL,
  price       DECIMAL(14,2) NULL COMMENT 'NULL = factor x base price',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_unit_barcode (org_id, barcode),
  KEY idx_unit_product (product_id),
  CONSTRAINT fk_unit_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_unit_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE customers
  ADD COLUMN member_no VARCHAR(20) NULL AFTER name,
  ADD COLUMN points INT NOT NULL DEFAULT 0 AFTER order_count,
  ADD UNIQUE KEY uq_cust_member (org_id, member_no);

ALTER TABLE pos_shifts
  ADD COLUMN denominations JSON NULL COMMENT 'closing count per note/coin' AFTER expected_cash;

ALTER TABLE sales_orders
  ADD COLUMN points_earned INT NOT NULL DEFAULT 0 AFTER platform_fee,
  ADD COLUMN points_used INT NOT NULL DEFAULT 0 AFTER points_earned;

ALTER TABLE sales_order_items
  ADD COLUMN unit_name VARCHAR(30) NULL COMMENT 'pack/carton name when sold by unit' AFTER name,
  ADD COLUMN unit_factor DECIMAL(12,3) NOT NULL DEFAULT 1 COMMENT 'base units per sold unit' AFTER unit_name;

ALTER TABLE payments
  MODIFY COLUMN method ENUM('cash','promptpay','card','transfer','ewallet','platform','cod','other') NOT NULL;

CREATE TABLE held_bills (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id      BIGINT UNSIGNED NOT NULL,
  branch_id   BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  label       VARCHAR(100) NULL,
  cart        JSON NOT NULL,
  customer_id BIGINT UNSIGNED NULL,
  total       DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_held_branch (org_id, branch_id),
  CONSTRAINT fk_held_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cash_movements (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  shift_id    BIGINT UNSIGNED NOT NULL,
  type        ENUM('pay_in','pay_out','pickup') NOT NULL COMMENT 'pickup = cash moved to the safe',
  amount      DECIMAL(14,2) NOT NULL,
  reason      VARCHAR(200) NOT NULL,
  created_by  BIGINT UNSIGNED NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cm_shift (shift_id),
  CONSTRAINT fk_cm_shift FOREIGN KEY (shift_id) REFERENCES pos_shifts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payment_slips (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id      BIGINT UNSIGNED NOT NULL,
  trans_ref   VARCHAR(64) NOT NULL COMMENT 'bank transaction reference read from the slip',
  amount      DECIMAL(14,2) NOT NULL,
  order_id    BIGINT UNSIGNED NULL,
  raw         JSON NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_slip_ref (org_id, trans_ref),
  CONSTRAINT fk_slip_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_slip_order FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_migrations (version) VALUES ('011_pos_retail');
