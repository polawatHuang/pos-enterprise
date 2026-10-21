-- =====================================================================
-- 015_app_config — integration API keys set from the web UI (Settings > การเชื่อมต่อ API).
-- System-wide, encrypted; a saved value is used instead of the server environment variable.
-- For databases installed from schema.sql BEFORE this change.
-- Import once via phpMyAdmin > Import. Compatible with MySQL 8 / MariaDB 10.6+.
-- =====================================================================

CREATE TABLE app_config (
  name        VARCHAR(100) NOT NULL PRIMARY KEY COMMENT 'environment variable name, e.g. MINIMAX_API_KEY',
  value_enc   TEXT NOT NULL COMMENT 'AES-256-GCM with APP_ENCRYPTION_KEY',
  updated_by  BIGINT UNSIGNED NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_migrations (version) VALUES ('015_app_config');
