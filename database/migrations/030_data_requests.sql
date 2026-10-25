-- =====================================================================
-- 030_data_requests — requests from data subjects (PDPA sections 30–36): delete, access, correct,
-- object, withdraw consent. Sent from the public /data-deletion page (also the Data Deletion URL
-- for Meta / TikTok app review); the shop answers within 30 days.
-- Applied automatically when the backend starts (AUTO_MIGRATE), or import once via phpMyAdmin.
-- =====================================================================

CREATE TABLE IF NOT EXISTS data_requests (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id         BIGINT UNSIGNED NOT NULL,
  ref_code       VARCHAR(20)  NOT NULL,
  kind           ENUM('delete','access','correct','object','withdraw') NOT NULL,
  requester_name VARCHAR(191) NOT NULL,
  contact        VARCHAR(191) NOT NULL,
  platform       ENUM('facebook','instagram','line','tiktok','shop','other') NOT NULL DEFAULT 'other',
  detail         TEXT NULL,
  status         ENUM('new','in_progress','done','rejected') NOT NULL DEFAULT 'new',
  note           TEXT NULL COMMENT 'what was done / why rejected',
  ip             VARCHAR(45)  NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  handled_at     DATETIME NULL,
  handled_by     BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_data_request_ref (ref_code),
  KEY idx_data_request_org (org_id, status, created_at),
  CONSTRAINT fk_data_request_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
