-- =====================================================================
-- 008_ai_search — "AI ค้นหาสินค้าขายดี": AI web search as a trend source
-- For databases installed from schema.sql BEFORE this change.
-- Import once via phpMyAdmin > Import. Compatible with MySQL 8 / MariaDB 10.6+.
-- =====================================================================

ALTER TABLE scrape_sources
  MODIFY COLUMN platform ENUM('tiktok_shop','shopee','shopee_affiliate','apify','custom_url','ai_search') NOT NULL,
  MODIFY COLUMN method ENUM('official_api','scraping_service','http_fetch','ai_web_search') NOT NULL DEFAULT 'official_api';

ALTER TABLE scrape_runs
  ADD COLUMN stage VARCHAR(30) NULL COMMENT 'current step of a multi-step run (AI search)' AFTER status,
  ADD COLUMN state JSON NULL COMMENT 'step state and result summary (AI search)' AFTER external_run_id;

INSERT INTO schema_migrations (version) VALUES ('008_ai_search');
