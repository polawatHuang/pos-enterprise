CREATE TABLE saas_plans (
  code VARCHAR(32) NOT NULL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  monthly_price_satangs INT UNSIGNED NOT NULL,
  max_branches INT UNSIGNED NOT NULL,
  max_users INT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO saas_plans (code, name, monthly_price_satangs, max_branches, max_users) VALUES
  ('starter', 'Starter', 99000, 1, 3),
  ('growth', 'Growth', 199000, 3, 10),
  ('business', 'Business', 499000, 10, 30);

CREATE TABLE saas_subscriptions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id BIGINT UNSIGNED NOT NULL,
  plan_code VARCHAR(32) NOT NULL,
  status ENUM('trialing','active','past_due','canceled','expired','legacy') NOT NULL,
  trial_ends_at DATETIME NULL,
  current_period_start DATETIME NULL,
  current_period_end DATETIME NULL,
  provider VARCHAR(32) NULL,
  provider_subscription_id VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_saas_subscription_org (org_id),
  KEY idx_saas_subscription_status_end (status, current_period_end),
  CONSTRAINT fk_saas_subscription_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO saas_subscriptions (org_id, plan_code, status)
SELECT id, 'legacy', 'legacy' FROM organizations;

CREATE TABLE ai_credit_wallets (
  org_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  balance BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ai_wallet_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO ai_credit_wallets (org_id, balance) SELECT id, 0 FROM organizations;

CREATE TABLE ai_credit_reservations (
  id CHAR(36) NOT NULL PRIMARY KEY,
  org_id BIGINT UNSIGNED NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  category VARCHAR(64) NOT NULL,
  reserved_credits BIGINT UNSIGNED NOT NULL,
  charged_credits BIGINT UNSIGNED NULL,
  status ENUM('reserved','settled','released') NOT NULL DEFAULT 'reserved',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  settled_at DATETIME NULL,
  UNIQUE KEY uq_ai_reservation_idempotency (org_id, idempotency_key),
  KEY idx_ai_reservation_org_created (org_id, created_at),
  CONSTRAINT fk_ai_reservation_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ai_credit_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id BIGINT UNSIGNED NOT NULL,
  reservation_id CHAR(36) NULL,
  amount BIGINT NOT NULL,
  balance_after BIGINT UNSIGNED NOT NULL,
  entry_type ENUM('topup','reserve','settlement_refund','release','adjustment') NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  description VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ai_credit_ledger_idempotency (org_id, idempotency_key),
  KEY idx_ai_credit_ledger_org_created (org_id, created_at),
  CONSTRAINT fk_ai_ledger_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_ledger_reservation FOREIGN KEY (reservation_id) REFERENCES ai_credit_reservations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE saas_payment_orders (
  id CHAR(36) NOT NULL PRIMARY KEY,
  org_id BIGINT UNSIGNED NOT NULL,
  order_type ENUM('subscription','ai_credits') NOT NULL,
  plan_code VARCHAR(32) NULL,
  credits INT UNSIGNED NULL,
  amount_satangs INT UNSIGNED NOT NULL,
  status ENUM('pending','paid','expired','failed') NOT NULL DEFAULT 'pending',
  provider VARCHAR(32) NOT NULL,
  provider_ref VARCHAR(191) NULL,
  expires_at DATETIME NOT NULL,
  paid_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_saas_payment_provider_ref (provider, provider_ref),
  KEY idx_saas_payment_org_created (org_id, created_at),
  KEY idx_saas_payment_status_expiry (status, expires_at),
  CONSTRAINT fk_saas_payment_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE saas_webhook_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  provider VARCHAR(32) NOT NULL,
  event_id VARCHAR(191) NOT NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_saas_webhook_event (provider, event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE saas_terms_acceptances (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  terms_version VARCHAR(32) NOT NULL,
  privacy_version VARCHAR(32) NOT NULL,
  ip VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  accepted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_saas_terms_org (org_id, accepted_at),
  CONSTRAINT fk_saas_terms_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_saas_terms_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE jobs ADD COLUMN saas_admin_bypass TINYINT(1) NOT NULL DEFAULT 0;

INSERT INTO schema_migrations (version) VALUES ('038_saas_billing');
