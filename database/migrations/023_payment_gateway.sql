-- =====================================================================
-- 023_payment_gateway — PromptPay QR that closes the bill by itself when the money arrives:
--   * payment_intents: one row per QR the till asked a payment provider for
--     (pending -> paid by the provider's webhook/status check -> used by the sale that claims it)
-- Provider keys live encrypted in integration_credentials (provider 'payment:<name>'); the
-- on/off switch is the settings key pos.payment_gateway.
-- For databases installed from schema.sql BEFORE this change.
-- Import once via phpMyAdmin > Import. Compatible with MySQL 8 / MariaDB 10.6+.
-- =====================================================================

CREATE TABLE payment_intents (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id       BIGINT UNSIGNED NOT NULL,
  branch_id    BIGINT UNSIGNED NULL,
  shift_id     BIGINT UNSIGNED NULL,
  user_id      BIGINT UNSIGNED NULL,
  provider     VARCHAR(30) NOT NULL,
  provider_ref VARCHAR(100) NOT NULL COMMENT 'the provider''s charge id',
  amount       DECIMAL(14,2) NOT NULL,
  status       ENUM('pending','paid','expired','failed','cancelled','used') NOT NULL DEFAULT 'pending',
  qr_payload   TEXT NULL COMMENT 'EMVCo text, when the provider returns one',
  qr_image     VARCHAR(1000) NULL COMMENT 'image link, when the provider returns one',
  order_id     BIGINT UNSIGNED NULL COMMENT 'the sale that used this payment',
  paid_at      DATETIME NULL,
  checked_at   DATETIME NULL,
  expires_at   DATETIME NULL,
  raw          JSON NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_intent_ref (provider, provider_ref),
  KEY idx_intent_org_status (org_id, status),
  CONSTRAINT fk_intent_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_intent_order FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_migrations (version) VALUES ('023_payment_gateway');
