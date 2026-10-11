-- =====================================================================
-- 007_trend_lifecycle — product lifecycle phase, selection checklist and channel profiles
-- (method from the book "คู่มือทำนายหน้า TikTok ด้วย AI"; see docs/PRODUCT_RESEARCH.md)
-- For databases installed from schema.sql BEFORE this change.
-- Import once via phpMyAdmin > Import. Compatible with MySQL 8 / MariaDB 10.6+.
-- =====================================================================

ALTER TABLE trending_products
  ADD COLUMN category_rank INT NULL COMMENT 'rank in the platform category best-seller list (30 days)' AFTER category,
  ADD COLUMN monthly_sold BIGINT NULL COMMENT 'units sold last month' AFTER sold_velocity,
  ADD COLUMN prev_monthly_sold BIGINT NULL COMMENT 'units sold the month before' AFTER monthly_sold,
  ADD COLUMN review_count INT NULL AFTER rating,
  ADD COLUMN media_review_count INT NULL COMMENT 'reviews with photos/videos' AFTER review_count,
  ADD COLUMN positive_review_pct DECIMAL(5,2) NULL COMMENT '4-5 star share of reviews' AFTER media_review_count,
  ADD COLUMN shop_rating DECIMAL(3,2) NULL AFTER shop_name,
  ADD COLUMN shop_response_rate DECIMAL(5,2) NULL COMMENT '% chats answered within 24h' AFTER shop_rating,
  ADD COLUMN shop_ship48_rate DECIMAL(5,2) NULL COMMENT '% orders shipped within 48h' AFTER shop_response_rate,
  ADD COLUMN has_flash_sale TINYINT(1) NULL AFTER commission_rate,
  ADD COLUMN lifecycle_phase VARCHAR(2) NULL COMMENT '1-5 rising, A peak, B-E declining' AFTER trend_score,
  ADD COLUMN phase_ratio DECIMAL(7,2) NULL COMMENT 'sold as % of the category peak' AFTER lifecycle_phase,
  ADD COLUMN phase_notes JSON NULL AFTER phase_ratio,
  ADD COLUMN checklist JSON NULL AFTER phase_notes,
  ADD COLUMN checklist_passed TINYINT NULL AFTER checklist,
  ADD COLUMN pick_score DECIMAL(6,2) NULL COMMENT 'fit for affiliate selling, 0-100' AFTER checklist_passed,
  ADD COLUMN manual_checks JSON NULL COMMENT 'criteria confirmed by a person' AFTER pick_score,
  ADD KEY idx_trend_pick (org_id, pick_score),
  ADD KEY idx_trend_category (org_id, platform, category);

CREATE TABLE trend_category_benchmarks (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id      BIGINT UNSIGNED NOT NULL,
  platform    VARCHAR(30) NOT NULL,
  category    VARCHAR(191) NOT NULL,
  peak_sold   BIGINT NOT NULL COMMENT 'average units sold of the category #1-#2',
  source      ENUM('auto','manual') NOT NULL DEFAULT 'auto',
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_benchmark (org_id, platform, category),
  CONSTRAINT fk_tcb_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE channel_profiles (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id      BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(191) NOT NULL,
  persona     TEXT NOT NULL COMMENT 'who is behind the channel: age, job, hobbies, pets, style',
  interests   JSON NULL,
  audience    VARCHAR(500) NULL,
  on_camera   TINYINT(1) NOT NULL DEFAULT 0,
  ai_plan     JSON NULL,
  ai_planned_at DATETIME NULL,
  is_default  TINYINT(1) NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_cp_org (org_id),
  CONSTRAINT fk_cp_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_migrations (version) VALUES ('007_trend_lifecycle');
