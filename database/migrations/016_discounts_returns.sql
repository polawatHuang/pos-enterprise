-- =====================================================================
-- 016_discounts_returns — redeem discount codes at the POS, and return/refund part of a bill.
-- For databases installed from schema.sql BEFORE this change.
-- Import once via phpMyAdmin > Import. Compatible with MySQL 8 / MariaDB 10.6+.
-- =====================================================================

ALTER TABLE discount_codes
  ADD COLUMN description VARCHAR(191) NULL AFTER code,
  ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER expires_at;

ALTER TABLE sales_orders
  ADD COLUMN discount_code_id BIGINT UNSIGNED NULL AFTER points_used,
  ADD COLUMN code_discount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER discount_code_id,
  ADD COLUMN refunded_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER code_discount,
  ADD CONSTRAINT fk_so_dcode FOREIGN KEY (discount_code_id) REFERENCES discount_codes(id) ON DELETE SET NULL;

ALTER TABLE sales_order_items
  ADD COLUMN returned_qty DECIMAL(14,3) NOT NULL DEFAULT 0 AFTER quantity;

CREATE TABLE sales_returns (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id         BIGINT UNSIGNED NOT NULL,
  order_id       BIGINT UNSIGNED NOT NULL,
  return_no      VARCHAR(40) NOT NULL,
  reason         VARCHAR(255) NOT NULL,
  refund_method  ENUM('cash','promptpay','card','transfer','ewallet','platform','cod','other') NOT NULL,
  refund_amount  DECIMAL(14,2) NOT NULL,
  vat_amount     DECIMAL(14,2) NOT NULL DEFAULT 0,
  cost_amount    DECIMAL(14,2) NOT NULL DEFAULT 0,
  restocked      TINYINT(1) NOT NULL DEFAULT 1 COMMENT '0 = damaged goods, not put back on the shelf',
  shift_id       BIGINT UNSIGNED NULL COMMENT 'shift that paid the refund',
  aftersales_return_id BIGINT UNSIGNED NULL COMMENT 'returns row from the chat after-sales flow',
  created_by     BIGINT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sales_return_no (org_id, return_no),
  KEY idx_sret_order (order_id),
  CONSTRAINT fk_sret_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_sret_order FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sales_return_items (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  return_id      BIGINT UNSIGNED NOT NULL,
  order_item_id  BIGINT UNSIGNED NOT NULL,
  product_id     BIGINT UNSIGNED NOT NULL,
  quantity       DECIMAL(14,3) NOT NULL COMMENT 'in the units sold on the bill',
  amount         DECIMAL(14,2) NOT NULL COMMENT 'refunded for this line incl. VAT',
  CONSTRAINT fk_sreti_return FOREIGN KEY (return_id) REFERENCES sales_returns(id) ON DELETE CASCADE,
  CONSTRAINT fk_sreti_item FOREIGN KEY (order_item_id) REFERENCES sales_order_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_migrations (version) VALUES ('016_discounts_returns');
