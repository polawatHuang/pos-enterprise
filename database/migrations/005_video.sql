-- =====================================================================
-- 005_video — Phase 6 (AI video: script → voice → clips → composition)
-- For databases installed from schema.sql BEFORE phase 6.
-- Import once via phpMyAdmin > Import. Compatible with MySQL 8 / MariaDB 10.6+.
-- =====================================================================

ALTER TABLE video_projects
  MODIFY COLUMN status ENUM('draft','scripting','script_ready','voicing','generating_clips','rendering_avatar','compositing','parts_ready','ready','failed') NOT NULL DEFAULT 'draft',
  ADD COLUMN brief JSON NULL COMMENT 'tone, length, audience, product facts used for the script' AFTER title,
  ADD COLUMN script_json JSON NULL COMMENT 'scenes: voiceover, caption, visual, durationSec' AFTER script,
  ADD COLUMN post_caption TEXT NULL AFTER script_json,
  ADD COLUMN hashtags VARCHAR(500) NULL AFTER post_caption,
  ADD COLUMN voice_provider VARCHAR(30) NULL AFTER voice_id,
  ADD COLUMN visual_mode ENUM('ai_clips','product_images') NOT NULL DEFAULT 'product_images' AFTER voice_provider,
  ADD COLUMN output_url VARCHAR(1000) NULL AFTER output_file_id,
  ADD COLUMN subtitle_srt MEDIUMTEXT NULL AFTER subtitle_file_id,
  ADD COLUMN stage_detail VARCHAR(255) NULL COMMENT 'human-readable progress' AFTER status;

ALTER TABLE video_assets
  ADD COLUMN scene_index INT NULL AFTER kind,
  ADD COLUMN provider VARCHAR(30) NULL AFTER scene_index,
  ADD COLUMN external_id VARCHAR(191) NULL COMMENT 'provider task / render id' AFTER provider,
  ADD COLUMN status ENUM('pending','processing','ready','failed') NOT NULL DEFAULT 'ready' AFTER external_id,
  ADD COLUMN duration_ms INT NULL AFTER status,
  ADD COLUMN error TEXT NULL AFTER meta,
  ADD KEY idx_va_project (video_project_id, kind, scene_index);

INSERT INTO schema_migrations (version) VALUES ('005_video');
