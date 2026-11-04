-- =====================================================================
-- 032_drama — "ละคร AI": short AI drama videos (9:16, 1–3 minutes) made in six steps:
-- story settings → script → characters → cover → storyboard (stills / MiniMax H3 clips) → export.
-- Applied automatically when the backend starts (AUTO_MIGRATE), or import once via phpMyAdmin.
-- =====================================================================

CREATE TABLE IF NOT EXISTS drama_projects (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id            BIGINT UNSIGNED NOT NULL,
  title             VARCHAR(255) NOT NULL,
  genre             VARCHAR(40)  NOT NULL DEFAULT 'drama',
  substyle          VARCHAR(60)  NULL COMMENT 'genre sub-type, e.g. Thai ghost / Ayutthaya era',
  style             VARCHAR(40)  NOT NULL DEFAULT 'realistic',
  length_sec        INT NOT NULL DEFAULT 60,
  visual_mode       ENUM('stills','mixed','clips') NOT NULL DEFAULT 'stills',
  premise           TEXT NULL,
  narrator_voice_id VARCHAR(100) NULL,
  music             TINYINT(1) NOT NULL DEFAULT 1,
  logline           TEXT NULL,
  cover_key         VARCHAR(80) NULL COMMENT 'stored image (video media dir)',
  run_target        VARCHAR(20) NULL COMMENT 'step to finish, or all = auto; NULL = idle',
  run_token         VARCHAR(32) NULL COMMENT 'the running chain; a new run or cancel invalidates older jobs',
  stage_detail      VARCHAR(255) NULL,
  error             TEXT NULL,
  render_id         VARCHAR(100) NULL,
  output_key        VARCHAR(80) NULL,
  output_url        VARCHAR(1000) NULL,
  subtitle_srt      MEDIUMTEXT NULL,
  duration_sec      INT NULL,
  created_by        BIGINT UNSIGNED NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_drama_org (org_id, updated_at),
  CONSTRAINT fk_drama_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS drama_characters (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  drama_project_id BIGINT UNSIGNED NOT NULL,
  char_key         VARCHAR(40)  NOT NULL,
  name             VARCHAR(120) NOT NULL,
  role             VARCHAR(255) NULL,
  gender           VARCHAR(10)  NULL,
  age              VARCHAR(10)  NULL,
  description      TEXT NULL,
  look_prompt      TEXT NULL COMMENT 'English appearance prompt',
  voice_id         VARCHAR(100) NULL,
  portrait_key     VARCHAR(80)  NULL,
  status           VARCHAR(20)  NOT NULL DEFAULT 'pending',
  error            VARCHAR(500) NULL,
  sort_order       INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_drama_char (drama_project_id, char_key),
  CONSTRAINT fk_drama_char_project FOREIGN KEY (drama_project_id) REFERENCES drama_projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS drama_shots (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  drama_project_id BIGINT UNSIGNED NOT NULL,
  seq              INT NOT NULL,
  scene_title      VARCHAR(255) NULL,
  narration        TEXT NULL,
  dialogue         LONGTEXT NULL COMMENT 'JSON [{character, line}]',
  visual_prompt    TEXT NULL COMMENT 'English shot description',
  camera           VARCHAR(255) NULL,
  characters       VARCHAR(500) NULL COMMENT 'JSON character keys in the shot',
  kind             ENUM('still','clip') NOT NULL DEFAULT 'still',
  image_key        VARCHAR(80)  NULL,
  image_status     VARCHAR(20)  NOT NULL DEFAULT 'pending',
  clip_task_id     VARCHAR(100) NULL,
  clip_key         VARCHAR(80)  NULL,
  clip_status      VARCHAR(20)  NOT NULL DEFAULT 'pending',
  clip_polls       INT NOT NULL DEFAULT 0,
  audio            LONGTEXT NULL COMMENT 'JSON [{speaker, text, url, ms}]',
  audio_status     VARCHAR(20)  NOT NULL DEFAULT 'pending',
  error            VARCHAR(500) NULL,
  KEY idx_drama_shot (drama_project_id, seq),
  CONSTRAINT fk_drama_shot_project FOREIGN KEY (drama_project_id) REFERENCES drama_projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS drama_style_previews (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id     BIGINT UNSIGNED NOT NULL,
  genre      VARCHAR(40) NOT NULL,
  style      VARCHAR(40) NOT NULL,
  image_key  VARCHAR(80) NULL,
  status     VARCHAR(20) NOT NULL DEFAULT 'pending',
  error      VARCHAR(500) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_drama_preview (org_id, genre, style),
  CONSTRAINT fk_drama_preview_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
