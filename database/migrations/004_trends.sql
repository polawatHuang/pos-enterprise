-- =====================================================================
-- 004_trends — Phase 5 (trending products: sources, snapshots, AI analysis)
-- For databases installed from schema.sql BEFORE phase 5.
-- Import once via phpMyAdmin > Import. Compatible with MySQL 8 / MariaDB 10.6+.
-- =====================================================================

ALTER TABLE scrape_sources
  ADD COLUMN interval_hours INT NULL COMMENT 'auto-run every N hours; NULL = manual only' AFTER schedule_cron,
  ADD COLUMN last_error TEXT NULL AFTER last_run_at;

ALTER TABLE scrape_runs
  ADD COLUMN items_new INT NOT NULL DEFAULT 0 AFTER items_found,
  ADD COLUMN external_run_id VARCHAR(191) NULL COMMENT 'e.g. Apify run id' AFTER items_new,
  ADD COLUMN triggered_by BIGINT UNSIGNED NULL COMMENT 'user id; NULL = schedule' AFTER external_run_id;

ALTER TABLE trending_products
  ADD COLUMN shop_name VARCHAR(191) NULL AFTER url,
  ADD COLUMN sold_velocity DECIMAL(14,2) NULL COMMENT 'units sold per day between snapshots' AFTER sold_count,
  ADD COLUMN status ENUM('new','watching','imported','ignored') NOT NULL DEFAULT 'new' AFTER trend_score,
  ADD COLUMN imported_product_id BIGINT UNSIGNED NULL AFTER status,
  ADD COLUMN affiliate_link_id BIGINT UNSIGNED NULL AFTER imported_product_id,
  ADD COLUMN ai_analysis JSON NULL AFTER affiliate_link_id,
  ADD COLUMN ai_analyzed_at DATETIME NULL AFTER ai_analysis,
  ADD KEY idx_trend_status (org_id, status),
  ADD CONSTRAINT fk_tp_product FOREIGN KEY (imported_product_id) REFERENCES products(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_tp_aff FOREIGN KEY (affiliate_link_id) REFERENCES affiliate_links(id) ON DELETE SET NULL;

CREATE TABLE trending_snapshots (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  trending_product_id BIGINT UNSIGNED NOT NULL,
  captured_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  price               DECIMAL(14,2) NULL,
  sold_count          BIGINT NULL,
  rating              DECIMAL(3,2) NULL,
  commission_rate     DECIMAL(5,2) NULL,
  KEY idx_ts_product (trending_product_id, captured_at),
  CONSTRAINT fk_ts_product FOREIGN KEY (trending_product_id) REFERENCES trending_products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_migrations (version) VALUES ('004_trends');
