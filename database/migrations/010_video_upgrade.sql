-- =====================================================================
-- 010_video_upgrade — AI Video: own footage, word-by-word captions, hook variants, cover intro
-- For databases installed from schema.sql BEFORE this change.
-- Import once via phpMyAdmin > Import. Compatible with MySQL 8 / MariaDB 10.6+.
-- =====================================================================

ALTER TABLE video_projects
  MODIFY COLUMN visual_mode ENUM('ai_clips','product_images','my_footage') NOT NULL DEFAULT 'product_images',
  ADD COLUMN caption_style VARCHAR(20) NOT NULL DEFAULT 'pop' COMMENT 'pop | clean | none (word-by-word captions)' AFTER visual_mode,
  ADD COLUMN cover_id BIGINT UNSIGNED NULL COMMENT 'AI cover shown as the first frame' AFTER caption_style;

CREATE TABLE video_media (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  video_project_id BIGINT UNSIGNED NOT NULL,
  kind             ENUM('video','image') NOT NULL,
  mime             VARCHAR(50) NOT NULL,
  storage_key      VARCHAR(255) NOT NULL COMMENT 'file name under MEDIA_DIR',
  size_bytes       BIGINT NOT NULL,
  duration_ms      INT NULL,
  label            VARCHAR(100) NULL COMMENT 'what the shot shows, e.g. แกะกล่อง',
  sort_order       INT NOT NULL DEFAULT 0,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_vm_project (video_project_id, sort_order),
  CONSTRAINT fk_vm_project FOREIGN KEY (video_project_id) REFERENCES video_projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_migrations (version) VALUES ('010_video_upgrade');
