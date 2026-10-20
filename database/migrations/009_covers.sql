-- =====================================================================
-- 009_covers — "AI ปกคลิป": AI-generated video cover/thumbnail images
-- For databases installed from schema.sql BEFORE this change.
-- Import once via phpMyAdmin > Import. Compatible with MySQL 8 / MariaDB 10.6+.
-- =====================================================================

CREATE TABLE cover_projects (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id      BIGINT UNSIGNED NOT NULL,
  created_by  BIGINT UNSIGNED NULL,
  orientation ENUM('portrait','landscape') NOT NULL DEFAULT 'portrait',
  style       VARCHAR(200) NOT NULL,
  headline    VARCHAR(80) NOT NULL,
  subtext     VARCHAR(120) NULL,
  badge       VARCHAR(30) NULL,
  upload_kind ENUM('product','person') NULL COMMENT 'how the attached photo is used',
  design      JSON NULL COMMENT 'AI layout/palette/font + user edits',
  status      ENUM('generating','ready','failed') NOT NULL DEFAULT 'generating',
  error       VARCHAR(1000) NULL,
  provider    VARCHAR(30) NULL,
  model       VARCHAR(100) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_cover_org (org_id, created_at),
  CONSTRAINT fk_cover_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cover_assets (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cover_id    BIGINT UNSIGNED NOT NULL,
  kind        ENUM('upload','background','final') NOT NULL,
  mime        VARCHAR(50) NOT NULL,
  data        MEDIUMBLOB NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cover_asset (cover_id, kind),
  CONSTRAINT fk_ca_cover FOREIGN KEY (cover_id) REFERENCES cover_projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_migrations (version) VALUES ('009_covers');
