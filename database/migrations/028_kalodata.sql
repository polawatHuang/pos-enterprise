-- =====================================================================
-- 028_kalodata — TikTok Shop Thailand market data from the Kalodata OpenAPI:
--   * scrape_sources.platform 'kalodata': one source per org; its runs are the monthly pulls
--   * trend_categories: category ranking per month (levels 1–3) with market size, growth,
--     concentration (top-3 shop share), revenue per shop and channel split — the category report
--   * trend_product_months: each product's month (revenue, units, growth) to chart history
--   * trend_product_extras: per-product data fetched on demand (selling points, comment insight,
--     top videos, creators), cached so a second look costs no credits
--   * trending_products: Kalodata fields + the 30-point selection score
-- For databases installed from schema.sql BEFORE this change.
-- Applied automatically when the backend starts (AUTO_MIGRATE), or import once via phpMyAdmin.
-- =====================================================================

ALTER TABLE scrape_sources
  MODIFY platform ENUM('tiktok_shop','shopee','shopee_affiliate','apify','custom_url','ai_search','kalodata') NOT NULL;

ALTER TABLE trending_products
  ADD COLUMN kalo_category_id VARCHAR(32) NULL COMMENT 'Kalodata level-2 category (phase benchmark group)' AFTER category_rank,
  ADD COLUMN kalo_leaf_id VARCHAR(32) NULL COMMENT 'Kalodata level-3 category, from the product detail' AFTER kalo_category_id,
  ADD COLUMN revenue DECIMAL(16,2) NULL COMMENT 'sales value in the latest month (THB)' AFTER kalo_leaf_id,
  ADD COLUMN revenue_growth_rate DECIMAL(10,2) NULL COMMENT '% vs the month before' AFTER revenue,
  ADD COLUMN creator_count INT NULL AFTER revenue_growth_rate,
  ADD COLUMN video_count INT NULL AFTER creator_count,
  ADD COLUMN live_count INT NULL AFTER video_count,
  ADD COLUMN launch_date DATE NULL AFTER live_count,
  ADD COLUMN channel_split JSON NULL COMMENT '{video, live, showcase} revenue' AFTER launch_date,
  ADD COLUMN select_score TINYINT NULL COMMENT 'selection score out of 30 (6 criteria × 1–5)' AFTER pick_score,
  ADD COLUMN select_detail JSON NULL AFTER select_score,
  ADD KEY idx_trend_kalo (org_id, kalo_category_id);

CREATE TABLE trend_categories (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id            BIGINT UNSIGNED NOT NULL,
  period            CHAR(7) NOT NULL COMMENT 'YYYY-MM',
  category_id       VARCHAR(32) NOT NULL,
  parent_id         VARCHAR(32) NULL,
  level             TINYINT NOT NULL,
  name              VARCHAR(191) NOT NULL,
  rank_no           INT NULL,
  revenue           DECIMAL(18,2) NULL,
  sale              BIGINT NULL,
  growth_rate       DECIMAL(10,2) NULL COMMENT '% vs the month before',
  top3_shop_ratio   DECIMAL(6,2) NULL COMMENT '% of revenue taken by the top 3 shops',
  avg_shop_revenue  DECIMAL(16,2) NULL,
  shop_number       INT NULL,
  active_products   INT NULL,
  live_revenue      DECIMAL(18,2) NULL,
  video_revenue     DECIMAL(18,2) NULL,
  mall_revenue      DECIMAL(18,2) NULL,
  affiliate_revenue DECIMAL(18,2) NULL,
  self_revenue      DECIMAL(18,2) NULL,
  revenue_trend     JSON NULL,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_trend_cat (org_id, period, category_id),
  KEY idx_trend_cat_level (org_id, period, level, parent_id),
  CONSTRAINT fk_tcat_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE trend_product_months (
  trending_product_id BIGINT UNSIGNED NOT NULL,
  period              CHAR(7) NOT NULL,
  revenue             DECIMAL(16,2) NULL,
  sales               BIGINT NULL,
  growth_rate         DECIMAL(10,2) NULL,
  unit_price          DECIMAL(14,2) NULL,
  commission_rate     DECIMAL(5,2) NULL,
  live_revenue        DECIMAL(16,2) NULL,
  video_revenue       DECIMAL(16,2) NULL,
  showcase_revenue    DECIMAL(16,2) NULL,
  rank_in_category    INT NULL,
  PRIMARY KEY (trending_product_id, period),
  CONSTRAINT fk_tpm_product FOREIGN KEY (trending_product_id) REFERENCES trending_products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE trend_product_extras (
  trending_product_id BIGINT UNSIGNED NOT NULL,
  kind                ENUM('detail','analysis','comments','videos','creators') NOT NULL,
  data                JSON NULL,
  credits             DECIMAL(8,2) NOT NULL DEFAULT 0,
  fetched_by          BIGINT UNSIGNED NULL,
  fetched_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trending_product_id, kind),
  CONSTRAINT fk_tpx_product FOREIGN KEY (trending_product_id) REFERENCES trending_products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
