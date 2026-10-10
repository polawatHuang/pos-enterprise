-- =====================================================================
-- 006_social — Phase 7 (auto-post to TikTok / Facebook / Instagram + Shopee affiliate links)
-- For databases installed from schema.sql BEFORE phase 7.
-- Import once via phpMyAdmin > Import. Compatible with MySQL 8 / MariaDB 10.6+.
-- =====================================================================

ALTER TABLE social_accounts
  ADD COLUMN avatar_url VARCHAR(1000) NULL AFTER display_name,
  ADD COLUMN status ENUM('connected','expired','error') NOT NULL DEFAULT 'connected' AFTER credential_id,
  ADD COLUMN token_expires_at DATETIME NULL COMMENT 'UTC; NULL = does not expire' AFTER status,
  ADD COLUMN last_error TEXT NULL AFTER token_expires_at,
  ADD COLUMN meta JSON NULL COMMENT 'e.g. linked page id for Instagram' AFTER last_error,
  ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

ALTER TABLE scheduled_posts
  ADD COLUMN media_url VARCHAR(1000) NULL COMMENT 'public MP4 URL when not taken from a video project' AFTER media_file_id,
  ADD COLUMN link_placement ENUM('caption','bio','none') NOT NULL DEFAULT 'caption' AFTER affiliate_link_id,
  ADD COLUMN platform_options JSON NULL COMMENT 'TikTok privacy / interactions / commercial disclosure' AFTER privacy,
  ADD COLUMN attempts INT NOT NULL DEFAULT 0 AFTER job_id,
  ADD COLUMN published_at DATETIME NULL AFTER error,
  ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

ALTER TABLE post_results
  ADD COLUMN status VARCHAR(40) NULL COMMENT 'provider publish status' AFTER permalink;

ALTER TABLE affiliate_links
  ADD COLUMN label VARCHAR(191) NULL AFTER product_id;

INSERT INTO schema_migrations (version) VALUES ('006_social');
