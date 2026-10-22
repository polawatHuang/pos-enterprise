-- =====================================================================
-- 018_promotions — shop/branch promotions at the POS (7-Eleven style):
--   time_discount  a group of products is cheaper during a time window
--   bundle         buy A together with B for a special price
--   multi_buy      buy N pieces (mix and match within a group) for a special price
-- The till always gives the customer the single best price (promotions never stack).
-- For databases installed from schema.sql BEFORE this change.
-- Import once via phpMyAdmin > Import. Compatible with MySQL 8 / MariaDB 10.6+.
-- =====================================================================

CREATE TABLE pos_promotions (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id         BIGINT UNSIGNED NOT NULL,
  name           VARCHAR(191) NOT NULL,
  kind           ENUM('time_discount','bundle','multi_buy') NOT NULL,
  discount_type  ENUM('percent','amount_off','set_price') NOT NULL,
  value          DECIMAL(12,2) NOT NULL,
  starts_on      DATE NULL,
  ends_on        DATE NULL,
  days_mask      TINYINT UNSIGNED NOT NULL DEFAULT 127 COMMENT 'bit 0 = Sunday ... bit 6 = Saturday',
  time_from      CHAR(5) NULL COMMENT 'HH:MM local; with time_to may wrap past midnight',
  time_to        CHAR(5) NULL,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_by     BIGINT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_promo_org (org_id, is_active),
  CONSTRAINT fk_ppromo_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- No rows = every branch
CREATE TABLE pos_promotion_branches (
  promotion_id   BIGINT UNSIGNED NOT NULL,
  branch_id      BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (promotion_id, branch_id),
  CONSTRAINT fk_ppb_promo FOREIGN KEY (promotion_id) REFERENCES pos_promotions(id) ON DELETE CASCADE,
  CONSTRAINT fk_ppb_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- slot 1 = the products in the deal (bundle: item A); slot 2 = bundle item B.
-- A row names one product or a whole category; qty = pieces needed from that slot.
CREATE TABLE pos_promotion_items (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  promotion_id   BIGINT UNSIGNED NOT NULL,
  slot           TINYINT UNSIGNED NOT NULL DEFAULT 1,
  product_id     BIGINT UNSIGNED NULL,
  category_id    BIGINT UNSIGNED NULL,
  qty            INT UNSIGNED NOT NULL DEFAULT 1,
  KEY idx_ppi_promo (promotion_id, slot),
  CONSTRAINT fk_ppi_promo FOREIGN KEY (promotion_id) REFERENCES pos_promotions(id) ON DELETE CASCADE,
  CONSTRAINT fk_ppi_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_ppi_category FOREIGN KEY (category_id) REFERENCES product_categories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE sales_order_items
  ADD COLUMN promo_discount DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT 'part of discount that came from a promotion' AFTER discount,
  ADD COLUMN promotion_id BIGINT UNSIGNED NULL AFTER promo_discount,
  ADD KEY idx_soi_promo (promotion_id);

ALTER TABLE sales_orders
  ADD COLUMN promo_discount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER code_discount;

INSERT INTO schema_migrations (version) VALUES ('018_promotions');
