-- =====================================================================
-- POS Enterprise — full database schema (all modules)
-- Compatible with MySQL 8.0+ and MariaDB 10.6+ (phpMyAdmin import)
--
-- How to import via phpMyAdmin:
--   1. Select your database in the left panel (create it in cPanel first)
--   2. Import tab -> choose this file -> Character set: utf-8 -> Go
--   3. Then import seed.sql the same way
--
-- Rules followed so phpMyAdmin imports cleanly:
--   * No DELIMITER / triggers / stored procedures / events
--   * No CREATE DATABASE / USE (works on shared hosting with prefixed DB names)
--   * Tables created in dependency order; drop order reversed
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- Drop (reverse dependency order) — safe re-import on an empty install.
-- WARNING: re-importing this file DELETES ALL DATA.
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS payment_intents, tax_invoice_requests, welfare_request_items, welfare_requests, pos_promotion_items, pos_promotion_branches, pos_promotions, sales_return_items, sales_returns, app_config, stock_lots, stock_transfer_items, stock_transfers, notification_reads, notifications, stock_count_items, stock_counts, payment_slips, cash_movements, held_bills, product_units, cover_assets, cover_projects, document_sequences, channel_profiles, trend_category_benchmarks, trending_snapshots, scrape_runs, trending_products, scrape_sources,
  post_results, scheduled_posts, video_media, video_assets, video_projects, affiliate_links, social_accounts,
  ai_offers, disputes, returns, messages, conversations, ai_agent_profiles, channels,
  tax_reports, document_items, documents, transactions, journal_lines, journal_entries, chart_of_accounts,
  discount_codes, promotions, pos_shifts, payments, sales_order_items, sales_orders, customers,
  purchase_order_items, purchase_orders, suppliers, stock_movements, stock_levels, warehouses,
  product_knowledge, product_variants, products, product_categories,
  files, webhook_events, jobs, integration_credentials, settings, audit_logs, refresh_tokens,
  user_roles, role_permissions, permissions, roles, users, branches, organizations,
  schema_migrations;

-- =====================================================================
-- CORE
-- =====================================================================

CREATE TABLE schema_migrations (
  version     VARCHAR(64)  NOT NULL PRIMARY KEY,
  applied_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE organizations (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(191) NOT NULL,
  legal_name    VARCHAR(191) NULL,
  tax_id        VARCHAR(20)  NULL COMMENT 'Thai 13-digit tax ID',
  vat_registered TINYINT(1)  NOT NULL DEFAULT 1,
  address       TEXT NULL,
  phone         VARCHAR(50)  NULL,
  email         VARCHAR(191) NULL,
  currency      CHAR(3)      NOT NULL DEFAULT 'THB',
  timezone      VARCHAR(64)  NOT NULL DEFAULT 'Asia/Bangkok',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE branches (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id      BIGINT UNSIGNED NOT NULL,
  code        VARCHAR(32)  NOT NULL,
  name        VARCHAR(191) NOT NULL,
  branch_no   VARCHAR(5)   NOT NULL DEFAULT '00000' COMMENT 'Revenue Dept branch number',
  address     TEXT NULL,
  promptpay_id VARCHAR(20) NULL COMMENT 'NULL = shop-wide PromptPay',
  bank_account LONGTEXT NULL COMMENT 'JSON {bank,type,number,name}; NULL = shop-wide account',
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_branch_code (org_id, code),
  CONSTRAINT fk_branch_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE users (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id                BIGINT UNSIGNED NOT NULL,
  branch_id             BIGINT UNSIGNED NULL,
  email                 VARCHAR(191) NOT NULL,
  password_hash         VARCHAR(255) NOT NULL,
  pos_pin_hash          VARCHAR(100) NULL COMMENT 'manager PIN for till approvals (bcrypt)',
  full_name             VARCHAR(191) NOT NULL,
  phone                 VARCHAR(50)  NULL,
  welfare_monthly_limit DECIMAL(12,2) NULL COMMENT 'welfare withdrawal limit per month at cost; NULL = org default (settings welfare.monthly_limit)',
  avatar_url            VARCHAR(500) NULL,
  status                ENUM('active','disabled') NOT NULL DEFAULT 'active',
  must_change_password  TINYINT(1) NOT NULL DEFAULT 0,
  failed_login_count    INT NOT NULL DEFAULT 0,
  locked_until          DATETIME NULL,
  last_login_at         DATETIME NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_email (email),
  KEY idx_user_org (org_id),
  CONSTRAINT fk_user_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE roles (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code         VARCHAR(50)  NOT NULL,
  name         VARCHAR(100) NOT NULL,
  description  VARCHAR(255) NULL,
  is_system    TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_role_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE permissions (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code         VARCHAR(100) NOT NULL COMMENT 'module:action e.g. inventory:write',
  module       VARCHAR(50)  NOT NULL,
  description  VARCHAR(255) NULL,
  UNIQUE KEY uq_perm_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE role_permissions (
  role_id        BIGINT UNSIGNED NOT NULL,
  permission_id  BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_rp_perm FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_roles (
  user_id  BIGINT UNSIGNED NOT NULL,
  role_id  BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE refresh_tokens (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  token_hash   CHAR(64) NOT NULL COMMENT 'sha256 hex of the opaque token',
  family_id    CHAR(36) NOT NULL COMMENT 'rotation family; reuse of a revoked token revokes the family',
  expires_at   DATETIME NOT NULL,
  revoked_at   DATETIME NULL,
  replaced_by  BIGINT UNSIGNED NULL,
  user_agent   VARCHAR(255) NULL,
  ip           VARCHAR(45)  NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rt_hash (token_hash),
  KEY idx_rt_family (family_id),
  CONSTRAINT fk_rt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Integration keys saved from the web UI (system-wide, encrypted; wins over the environment)
CREATE TABLE app_config (
  name        VARCHAR(100) NOT NULL PRIMARY KEY COMMENT 'environment variable name, e.g. MINIMAX_API_KEY',
  value_enc   TEXT NOT NULL COMMENT 'AES-256-GCM with APP_ENCRYPTION_KEY',
  updated_by  BIGINT UNSIGNED NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_logs (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id       BIGINT UNSIGNED NULL,
  user_id      BIGINT UNSIGNED NULL,
  action       VARCHAR(100) NOT NULL,
  entity_type  VARCHAR(50)  NULL,
  entity_id    VARCHAR(64)  NULL,
  metadata     JSON NULL,
  ip           VARCHAR(45)  NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_org_time (org_id, created_at),
  KEY idx_audit_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE settings (
  org_id      BIGINT UNSIGNED NOT NULL,
  setting_key VARCHAR(100) NOT NULL,
  value       JSON NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (org_id, setting_key),
  CONSTRAINT fk_settings_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE integration_credentials (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id         BIGINT UNSIGNED NOT NULL,
  provider       VARCHAR(50)  NOT NULL COMMENT 'tiktok, shopee, meta, line, anthropic, ...',
  account_ref    VARCHAR(191) NOT NULL DEFAULT 'default' COMMENT 'shop id / page id / open id',
  data_encrypted TEXT NOT NULL COMMENT 'AES-256-GCM JSON (access/refresh tokens)',
  expires_at     DATETIME NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_integration (org_id, provider, account_ref),
  CONSTRAINT fk_integ_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- MySQL-backed job queue (no Redis on shared hosting). Driven by cPanel cron -> /internal/cron/tick
CREATE TABLE jobs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id        BIGINT UNSIGNED NULL,
  type          VARCHAR(100) NOT NULL COMMENT 'e.g. social.publish, video.render.poll',
  payload       JSON NULL,
  status        ENUM('queued','running','succeeded','failed','cancelled') NOT NULL DEFAULT 'queued',
  priority      INT NOT NULL DEFAULT 0,
  attempts      INT NOT NULL DEFAULT 0,
  max_attempts  INT NOT NULL DEFAULT 5,
  run_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at     DATETIME NULL,
  locked_by     VARCHAR(100) NULL,
  last_error    TEXT NULL,
  result        JSON NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_jobs_pick (status, run_at, priority),
  KEY idx_jobs_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE webhook_events (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  provider     VARCHAR(50)  NOT NULL,
  event_id     VARCHAR(191) NULL COMMENT 'provider event id for idempotency',
  payload      JSON NOT NULL,
  processed_at DATETIME NULL,
  error        TEXT NULL,
  received_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_webhook_event (provider, event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE files (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id       BIGINT UNSIGNED NOT NULL,
  storage      ENUM('r2','local','external') NOT NULL DEFAULT 'r2',
  storage_key  VARCHAR(500) NOT NULL,
  public_url   VARCHAR(1000) NULL,
  mime_type    VARCHAR(100) NULL,
  size_bytes   BIGINT UNSIGNED NULL,
  original_name VARCHAR(255) NULL,
  uploaded_by  BIGINT UNSIGNED NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_files_org (org_id),
  CONSTRAINT fk_files_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- PRODUCTS / INVENTORY / POS
-- =====================================================================

CREATE TABLE product_categories (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id     BIGINT UNSIGNED NOT NULL,
  parent_id  BIGINT UNSIGNED NULL,
  name       VARCHAR(191) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  sale_block JSON NULL COMMENT '{"from":"00:00","to":"11:00","label":"..."} no-sale window (local time)',
  age_restricted TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'ask the customer to confirm age 20+',
  CONSTRAINT fk_cat_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_cat_parent FOREIGN KEY (parent_id) REFERENCES product_categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE products (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id          BIGINT UNSIGNED NOT NULL,
  category_id     BIGINT UNSIGNED NULL,
  supplier_id     BIGINT UNSIGNED NULL COMMENT 'usual supplier',
  sku             VARCHAR(64)  NOT NULL,
  barcode         VARCHAR(64)  NULL,
  name            VARCHAR(255) NOT NULL,
  description     TEXT NULL,
  selling_points  TEXT NULL COMMENT 'used by AI chat agent & video scripts',
  unit            VARCHAR(30)  NOT NULL DEFAULT 'ชิ้น',
  price           DECIMAL(14,2) NOT NULL DEFAULT 0,
  cost            DECIMAL(14,2) NOT NULL DEFAULT 0,
  vat_type        ENUM('vat7','exempt','zero') NOT NULL DEFAULT 'vat7',
  reorder_point   INT NOT NULL DEFAULT 0,
  pack_size       DECIMAL(12,3) NOT NULL DEFAULT 1 COMMENT 'order in multiples of this many base units',
  track_expiry    TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'receive with expiry dates, sell first-expiry-first-out',
  open_price      TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'price typed at the sale, no stock kept',
  shelf_life_days INT NULL COMMENT 'default expiry = received date + this',
  image_url       VARCHAR(1000) NULL,
  shopee_item_id  VARCHAR(64) NULL,
  tiktok_product_id VARCHAR(64) NULL,
  status          ENUM('active','draft','archived') NOT NULL DEFAULT 'active',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_product_sku (org_id, sku),
  KEY idx_product_barcode (barcode),
  KEY idx_product_supplier (supplier_id),
  FULLTEXT KEY ft_product_knowledge (name, description, selling_points),
  CONSTRAINT fk_product_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_product_cat FOREIGN KEY (category_id) REFERENCES product_categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE product_units (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id      BIGINT UNSIGNED NOT NULL,
  product_id  BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(30) NOT NULL COMMENT 'แพ็ก, ลัง, ...',
  factor      DECIMAL(12,3) NOT NULL COMMENT 'base units per this unit',
  barcode     VARCHAR(64) NULL,
  price       DECIMAL(14,2) NULL COMMENT 'NULL = factor x base price',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_unit_barcode (org_id, barcode),
  KEY idx_unit_product (product_id),
  CONSTRAINT fk_unit_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_unit_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE product_variants (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  product_id  BIGINT UNSIGNED NOT NULL,
  sku         VARCHAR(64)  NOT NULL,
  name        VARCHAR(191) NOT NULL COMMENT 'e.g. สีแดง / XL',
  price       DECIMAL(14,2) NULL COMMENT 'NULL = use product price',
  cost        DECIMAL(14,2) NULL,
  barcode     VARCHAR(64) NULL,
  UNIQUE KEY uq_variant_sku (product_id, sku),
  CONSTRAINT fk_variant_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Extra knowledge for the AI agent (FAQ, policies, objection handling)
CREATE TABLE product_knowledge (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id      BIGINT UNSIGNED NOT NULL,
  product_id  BIGINT UNSIGNED NULL COMMENT 'NULL = store-wide knowledge (shipping, return policy)',
  kind        ENUM('faq','policy','objection','usage','other') NOT NULL DEFAULT 'faq',
  question    VARCHAR(500) NULL,
  answer      TEXT NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FULLTEXT KEY ft_knowledge (question, answer),
  CONSTRAINT fk_pk_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_pk_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE warehouses (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id     BIGINT UNSIGNED NOT NULL,
  branch_id  BIGINT UNSIGNED NULL,
  code       VARCHAR(32)  NOT NULL,
  name       VARCHAR(191) NOT NULL,
  UNIQUE KEY uq_wh_code (org_id, code),
  CONSTRAINT fk_wh_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_wh_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_levels (
  warehouse_id  BIGINT UNSIGNED NOT NULL,
  product_id    BIGINT UNSIGNED NOT NULL,
  variant_id    BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0 = base product',
  quantity      DECIMAL(14,3) NOT NULL DEFAULT 0,
  reserved      DECIMAL(14,3) NOT NULL DEFAULT 0,
  reorder_point DECIMAL(14,3) NULL COMMENT 'per-warehouse override of products.reorder_point',
  max_qty       DECIMAL(14,3) NULL COMMENT 'order-up-to level',
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (warehouse_id, product_id, variant_id),
  CONSTRAINT fk_sl_wh FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE,
  CONSTRAINT fk_sl_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_lots (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id        BIGINT UNSIGNED NOT NULL,
  warehouse_id  BIGINT UNSIGNED NOT NULL,
  product_id    BIGINT UNSIGNED NOT NULL,
  lot_no        VARCHAR(40) NULL,
  expiry_date   DATE NULL,
  quantity      DECIMAL(14,3) NOT NULL DEFAULT 0 COMMENT 'remaining in base units',
  unit_cost     DECIMAL(14,2) NOT NULL DEFAULT 0,
  markdown_pct  DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT 'near-expiry discount applied at the till',
  received_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_lot_fefo (warehouse_id, product_id, expiry_date),
  KEY idx_lot_expiry (org_id, expiry_date),
  CONSTRAINT fk_lot_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_lot_wh FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE,
  CONSTRAINT fk_lot_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_movements (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id        BIGINT UNSIGNED NOT NULL,
  warehouse_id  BIGINT UNSIGNED NOT NULL,
  product_id    BIGINT UNSIGNED NOT NULL,
  variant_id    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  lot_id        BIGINT UNSIGNED NULL,
  type          ENUM('purchase','sale','return','adjustment','transfer_in','transfer_out','opening','count','waste','welfare') NOT NULL,
  quantity      DECIMAL(14,3) NOT NULL COMMENT 'signed: + in, - out',
  unit_cost     DECIMAL(14,2) NULL,
  ref_type      VARCHAR(50) NULL,
  ref_id        BIGINT UNSIGNED NULL,
  note          VARCHAR(255) NULL,
  created_by    BIGINT UNSIGNED NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sm_product_time (product_id, created_at),
  CONSTRAINT fk_sm_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_sm_wh FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE,
  CONSTRAINT fk_sm_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_counts (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id       BIGINT UNSIGNED NOT NULL,
  warehouse_id BIGINT UNSIGNED NOT NULL,
  count_no     VARCHAR(30) NOT NULL,
  scope        ENUM('full','category') NOT NULL DEFAULT 'full',
  category_id  BIGINT UNSIGNED NULL,
  blind        TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'counters do not see the system quantity',
  status       ENUM('counting','review','approved','cancelled') NOT NULL DEFAULT 'counting',
  note         VARCHAR(255) NULL,
  start_movement_id BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'last stock_movements.id included in the snapshot',
  created_by   BIGINT UNSIGNED NOT NULL,
  approved_by  BIGINT UNSIGNED NULL,
  approved_at  DATETIME NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_sc_org (org_id, status),
  CONSTRAINT fk_sc_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_sc_wh FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_count_items (
  count_id     BIGINT UNSIGNED NOT NULL,
  product_id   BIGINT UNSIGNED NOT NULL,
  snapshot_qty DECIMAL(14,3) NOT NULL COMMENT 'system quantity when the count started',
  unit_cost    DECIMAL(14,2) NOT NULL DEFAULT 0,
  counted_qty  DECIMAL(14,3) NULL,
  counted_by   BIGINT UNSIGNED NULL,
  counted_at   DATETIME NULL,
  reason       VARCHAR(200) NULL,
  PRIMARY KEY (count_id, product_id),
  CONSTRAINT fk_sci_count FOREIGN KEY (count_id) REFERENCES stock_counts(id) ON DELETE CASCADE,
  CONSTRAINT fk_sci_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notifications (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id      BIGINT UNSIGNED NOT NULL,
  type        VARCHAR(40) NOT NULL,
  severity    ENUM('info','warning','danger') NOT NULL DEFAULT 'info',
  title       VARCHAR(191) NOT NULL,
  body        TEXT NULL,
  link        VARCHAR(255) NULL,
  permission  VARCHAR(50) NULL COMMENT 'only users with this permission see it',
  ref_key     VARCHAR(191) NOT NULL COMMENT 'dedupe key, e.g. out:2:15:2026-10-20',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_notif_ref (org_id, ref_key),
  KEY idx_notif_org_time (org_id, created_at),
  CONSTRAINT fk_notif_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notification_reads (
  notification_id BIGINT UNSIGNED NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  read_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (notification_id, user_id),
  CONSTRAINT fk_nr_notif FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE suppliers (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id      BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(191) NOT NULL,
  tax_id      VARCHAR(20)  NULL,
  branch_no   VARCHAR(5)   NULL,
  contact     VARCHAR(191) NULL,
  phone       VARCHAR(50)  NULL,
  email       VARCHAR(191) NULL,
  address     TEXT NULL,
  lead_time_days INT NOT NULL DEFAULT 2 COMMENT 'days from order to delivery',
  note        VARCHAR(255) NULL,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sup_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE purchase_orders (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id        BIGINT UNSIGNED NOT NULL,
  supplier_id   BIGINT UNSIGNED NULL,
  warehouse_id  BIGINT UNSIGNED NULL,
  po_no         VARCHAR(32) NOT NULL,
  status        ENUM('draft','ordered','partial','received','cancelled') NOT NULL DEFAULT 'draft',
  source        ENUM('manual','suggestion') NOT NULL DEFAULT 'manual',
  order_date    DATE NOT NULL,
  expected_date DATE NULL,
  subtotal      DECIMAL(14,2) NOT NULL DEFAULT 0,
  vat_amount    DECIMAL(14,2) NOT NULL DEFAULT 0,
  total         DECIMAL(14,2) NOT NULL DEFAULT 0,
  note          TEXT NULL,
  sent_at       DATETIME NULL,
  received_at   DATETIME NULL,
  created_by    BIGINT UNSIGNED NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_po_no (org_id, po_no),
  CONSTRAINT fk_po_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_po_sup FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
  CONSTRAINT fk_po_wh FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE purchase_order_items (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  po_id         BIGINT UNSIGNED NOT NULL,
  product_id    BIGINT UNSIGNED NOT NULL,
  variant_id    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  quantity      DECIMAL(14,3) NOT NULL,
  received_qty  DECIMAL(14,3) NOT NULL DEFAULT 0,
  unit_cost     DECIMAL(14,2) NOT NULL,
  CONSTRAINT fk_poi_po FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_poi_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_transfers (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id            BIGINT UNSIGNED NOT NULL,
  transfer_no       VARCHAR(30) NOT NULL,
  from_warehouse_id BIGINT UNSIGNED NOT NULL,
  to_warehouse_id   BIGINT UNSIGNED NOT NULL,
  status            ENUM('in_transit','received','cancelled') NOT NULL DEFAULT 'in_transit',
  note              VARCHAR(255) NULL,
  created_by        BIGINT UNSIGNED NOT NULL,
  received_by       BIGINT UNSIGNED NULL,
  shipped_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  received_at       DATETIME NULL,
  KEY idx_tr_org (org_id, status),
  CONSTRAINT fk_tr_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_tr_from FOREIGN KEY (from_warehouse_id) REFERENCES warehouses(id),
  CONSTRAINT fk_tr_to FOREIGN KEY (to_warehouse_id) REFERENCES warehouses(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_transfer_items (
  transfer_id   BIGINT UNSIGNED NOT NULL,
  product_id    BIGINT UNSIGNED NOT NULL,
  qty_sent      DECIMAL(14,3) NOT NULL,
  qty_received  DECIMAL(14,3) NULL,
  lot_allocations JSON NULL COMMENT '[{lotId, qty, expiry, cost}] taken at the source',
  PRIMARY KEY (transfer_id, product_id),
  CONSTRAINT fk_tri_tr FOREIGN KEY (transfer_id) REFERENCES stock_transfers(id) ON DELETE CASCADE,
  CONSTRAINT fk_tri_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customers (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id         BIGINT UNSIGNED NOT NULL,
  name           VARCHAR(191) NOT NULL,
  member_no      VARCHAR(20)  NULL,
  phone          VARCHAR(50)  NULL,
  email          VARCHAR(191) NULL,
  tax_id         VARCHAR(20)  NULL,
  branch_no      VARCHAR(5)   NULL,
  address        TEXT NULL,
  tags           VARCHAR(500) NULL,
  total_spent    DECIMAL(14,2) NOT NULL DEFAULT 0,
  order_count    INT NOT NULL DEFAULT 0,
  points         INT NOT NULL DEFAULT 0,
  consent_marketing TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'PDPA consent',
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_cust_phone (org_id, phone),
  UNIQUE KEY uq_cust_member (org_id, member_no),
  CONSTRAINT fk_cust_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pos_shifts (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id         BIGINT UNSIGNED NOT NULL,
  branch_id      BIGINT UNSIGNED NOT NULL,
  user_id        BIGINT UNSIGNED NOT NULL,
  opened_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at      DATETIME NULL,
  opening_cash   DECIMAL(14,2) NOT NULL DEFAULT 0,
  closing_cash   DECIMAL(14,2) NULL,
  expected_cash  DECIMAL(14,2) NULL,
  denominations  JSON NULL COMMENT 'closing count per note/coin',
  note           VARCHAR(255) NULL,
  CONSTRAINT fk_shift_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_shift_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  CONSTRAINT fk_shift_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sales_orders (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id           BIGINT UNSIGNED NOT NULL,
  branch_id        BIGINT UNSIGNED NULL,
  customer_id      BIGINT UNSIGNED NULL,
  shift_id         BIGINT UNSIGNED NULL,
  order_no         VARCHAR(40) NOT NULL,
  receipt_token    CHAR(22) NULL COMMENT 'public receipt link id',
  channel          ENUM('pos','shopee','tiktok','facebook','instagram','line','website','other') NOT NULL DEFAULT 'pos',
  external_order_id VARCHAR(100) NULL,
  status           ENUM('pending','paid','packed','shipped','completed','cancelled','refunded') NOT NULL DEFAULT 'pending',
  subtotal         DECIMAL(14,2) NOT NULL DEFAULT 0,
  discount         DECIMAL(14,2) NOT NULL DEFAULT 0,
  shipping_fee     DECIMAL(14,2) NOT NULL DEFAULT 0,
  vat_amount       DECIMAL(14,2) NOT NULL DEFAULT 0,
  total            DECIMAL(14,2) NOT NULL DEFAULT 0,
  cost_total       DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT 'COGS snapshot for gross profit',
  platform_fee     DECIMAL(14,2) NOT NULL DEFAULT 0,
  points_earned    INT NOT NULL DEFAULT 0,
  points_used      INT NOT NULL DEFAULT 0,
  discount_code_id BIGINT UNSIGNED NULL,
  code_discount    DECIMAL(14,2) NOT NULL DEFAULT 0,
  promo_discount   DECIMAL(14,2) NOT NULL DEFAULT 0,
  refunded_amount  DECIMAL(14,2) NOT NULL DEFAULT 0,
  ordered_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       BIGINT UNSIGNED NULL,
  conversation_id  BIGINT UNSIGNED NULL COMMENT 'set when closed by AI agent',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_order_no (org_id, order_no),
  UNIQUE KEY uq_order_receipt_token (receipt_token),
  KEY idx_so_time (org_id, ordered_at),
  KEY idx_so_channel (org_id, channel, ordered_at),
  CONSTRAINT fk_so_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_so_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  CONSTRAINT fk_so_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  CONSTRAINT fk_so_shift FOREIGN KEY (shift_id) REFERENCES pos_shifts(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sales_order_items (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id    BIGINT UNSIGNED NOT NULL,
  product_id  BIGINT UNSIGNED NOT NULL,
  variant_id  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  name        VARCHAR(255) NOT NULL COMMENT 'snapshot',
  unit_name   VARCHAR(30) NULL COMMENT 'pack/carton name when sold by unit',
  unit_factor DECIMAL(12,3) NOT NULL DEFAULT 1 COMMENT 'base units per sold unit',
  quantity    DECIMAL(14,3) NOT NULL,
  returned_qty DECIMAL(14,3) NOT NULL DEFAULT 0,
  unit_price  DECIMAL(14,2) NOT NULL,
  unit_cost   DECIMAL(14,2) NOT NULL DEFAULT 0,
  discount    DECIMAL(14,2) NOT NULL DEFAULT 0,
  promo_discount DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT 'part of discount that came from a promotion',
  promotion_id BIGINT UNSIGNED NULL,
  line_total  DECIMAL(14,2) NOT NULL,
  lot_allocations JSON NULL COMMENT '[{lotId, qty}] taken FEFO, restored on void',
  KEY idx_soi_product (product_id),
  KEY idx_soi_promo (promotion_id),
  CONSTRAINT fk_soi_order FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_soi_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payments (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id      BIGINT UNSIGNED NOT NULL,
  order_id    BIGINT UNSIGNED NULL,
  method      ENUM('cash','promptpay','card','transfer','ewallet','platform','cod','other') NOT NULL,
  amount      DECIMAL(14,2) NOT NULL,
  reference   VARCHAR(191) NULL,
  paid_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pay_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_pay_order FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE held_bills (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id      BIGINT UNSIGNED NOT NULL,
  branch_id   BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  label       VARCHAR(100) NULL,
  cart        JSON NOT NULL,
  customer_id BIGINT UNSIGNED NULL,
  total       DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_held_branch (org_id, branch_id),
  CONSTRAINT fk_held_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cash_movements (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  shift_id    BIGINT UNSIGNED NOT NULL,
  type        ENUM('pay_in','pay_out','pickup') NOT NULL COMMENT 'pickup = cash moved to the safe',
  amount      DECIMAL(14,2) NOT NULL,
  reason      VARCHAR(200) NOT NULL,
  created_by  BIGINT UNSIGNED NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cm_shift (shift_id),
  CONSTRAINT fk_cm_shift FOREIGN KEY (shift_id) REFERENCES pos_shifts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE payment_slips (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id      BIGINT UNSIGNED NOT NULL,
  trans_ref   VARCHAR(64) NOT NULL COMMENT 'bank transaction reference read from the slip',
  amount      DECIMAL(14,2) NOT NULL,
  order_id    BIGINT UNSIGNED NULL,
  raw         JSON NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_slip_ref (org_id, trans_ref),
  CONSTRAINT fk_slip_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_slip_order FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE promotions (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id       BIGINT UNSIGNED NOT NULL,
  name         VARCHAR(191) NOT NULL,
  type         ENUM('percent','fixed','bundle','free_shipping') NOT NULL,
  value        DECIMAL(14,2) NOT NULL DEFAULT 0,
  rules        JSON NULL,
  starts_at    DATETIME NULL,
  ends_at      DATETIME NULL,
  is_active    TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT fk_promo_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- POS promotions (time_discount / bundle / multi_buy), per branch; see migration 018
CREATE TABLE pos_promotions (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id         BIGINT UNSIGNED NOT NULL,
  name           VARCHAR(191) NOT NULL,
  kind           ENUM('time_discount','bundle','multi_buy') NOT NULL,
  discount_type  ENUM('percent','amount_off','set_price') NOT NULL,
  value          DECIMAL(12,2) NOT NULL,
  starts_on      DATE NULL,
  ends_on        DATE NULL,
  days_mask      TINYINT UNSIGNED NOT NULL DEFAULT 127 COMMENT 'bit 0 = Sunday ... bit 6 = Saturday',
  time_from      CHAR(5) NULL COMMENT 'HH:MM local; with time_to may wrap past midnight',
  time_to        CHAR(5) NULL,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_by     BIGINT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_promo_org (org_id, is_active),
  CONSTRAINT fk_ppromo_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- No rows = every branch
CREATE TABLE pos_promotion_branches (
  promotion_id   BIGINT UNSIGNED NOT NULL,
  branch_id      BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (promotion_id, branch_id),
  CONSTRAINT fk_ppb_promo FOREIGN KEY (promotion_id) REFERENCES pos_promotions(id) ON DELETE CASCADE,
  CONSTRAINT fk_ppb_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- slot 1 = the products in the deal (bundle: item A); slot 2 = bundle item B.
-- A row names one product or a whole category; qty = pieces needed from that slot.
CREATE TABLE pos_promotion_items (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  promotion_id   BIGINT UNSIGNED NOT NULL,
  slot           TINYINT UNSIGNED NOT NULL DEFAULT 1,
  product_id     BIGINT UNSIGNED NULL,
  category_id    BIGINT UNSIGNED NULL,
  qty            INT UNSIGNED NOT NULL DEFAULT 1,
  KEY idx_ppi_promo (promotion_id, slot),
  CONSTRAINT fk_ppi_promo FOREIGN KEY (promotion_id) REFERENCES pos_promotions(id) ON DELETE CASCADE,
  CONSTRAINT fk_ppi_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_ppi_category FOREIGN KEY (category_id) REFERENCES product_categories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE discount_codes (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id         BIGINT UNSIGNED NOT NULL,
  code           VARCHAR(50) NOT NULL,
  description    VARCHAR(191) NULL,
  type           ENUM('percent','fixed') NOT NULL,
  value          DECIMAL(14,2) NOT NULL,
  min_spend      DECIMAL(14,2) NOT NULL DEFAULT 0,
  max_uses       INT NULL,
  used_count     INT NOT NULL DEFAULT 0,
  customer_id    BIGINT UNSIGNED NULL COMMENT 'single-customer code (e.g. issued by AI)',
  issued_by      ENUM('user','ai_agent') NOT NULL DEFAULT 'user',
  expires_at     DATETIME NULL,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_discount_code (org_id, code),
  CONSTRAINT fk_dc_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_dc_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE sales_orders ADD CONSTRAINT fk_so_dcode FOREIGN KEY (discount_code_id) REFERENCES discount_codes(id) ON DELETE SET NULL;

CREATE TABLE sales_returns (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id         BIGINT UNSIGNED NOT NULL,
  order_id       BIGINT UNSIGNED NOT NULL,
  return_no      VARCHAR(40) NOT NULL,
  reason         VARCHAR(255) NOT NULL,
  refund_method  ENUM('cash','promptpay','card','transfer','ewallet','platform','cod','other') NOT NULL,
  refund_amount  DECIMAL(14,2) NOT NULL,
  vat_amount     DECIMAL(14,2) NOT NULL DEFAULT 0,
  cost_amount    DECIMAL(14,2) NOT NULL DEFAULT 0,
  restocked      TINYINT(1) NOT NULL DEFAULT 1 COMMENT '0 = damaged goods, not put back on the shelf',
  shift_id       BIGINT UNSIGNED NULL COMMENT 'shift that paid the refund',
  aftersales_return_id BIGINT UNSIGNED NULL COMMENT 'returns row from the chat after-sales flow',
  created_by     BIGINT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_by      BIGINT UNSIGNED NULL,
  voided_at      DATETIME NULL,
  void_reason    VARCHAR(255) NULL,
  UNIQUE KEY uq_sales_return_no (org_id, return_no),
  KEY idx_sret_order (order_id),
  CONSTRAINT fk_sret_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_sret_order FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sales_return_items (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  return_id      BIGINT UNSIGNED NOT NULL,
  order_item_id  BIGINT UNSIGNED NOT NULL,
  product_id     BIGINT UNSIGNED NOT NULL,
  quantity       DECIMAL(14,3) NOT NULL COMMENT 'in the units sold on the bill',
  amount         DECIMAL(14,2) NOT NULL COMMENT 'refunded for this line incl. VAT',
  lot_allocations JSON NULL COMMENT '[{lotId, qty}] put back on restock, taken again on void',
  CONSTRAINT fk_sreti_return FOREIGN KEY (return_id) REFERENCES sales_returns(id) ON DELETE CASCADE,
  CONSTRAINT fk_sreti_item FOREIGN KEY (order_item_id) REFERENCES sales_order_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Employee welfare withdrawals: request -> manager approves -> stock out at cost (5250 ค่าสวัสดิการพนักงาน)
CREATE TABLE welfare_requests (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id         BIGINT UNSIGNED NOT NULL,
  request_no     VARCHAR(40) NOT NULL,
  warehouse_id   BIGINT UNSIGNED NOT NULL,
  employee_id    BIGINT UNSIGNED NOT NULL COMMENT 'the staff member receiving the goods (users.id)',
  status         ENUM('pending','approved','rejected','cancelled','reversed') NOT NULL DEFAULT 'pending',
  note           VARCHAR(255) NULL,
  total_cost     DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT 'at products.cost; re-priced on approval',
  requested_by   BIGINT UNSIGNED NULL,
  requested_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by    BIGINT UNSIGNED NULL COMMENT 'manager who approved or rejected',
  approved_at    DATETIME NULL,
  reject_reason  VARCHAR(255) NULL,
  reversed_by    BIGINT UNSIGNED NULL,
  reversed_at    DATETIME NULL,
  reverse_reason VARCHAR(255) NULL,
  UNIQUE KEY uq_welfare_no (org_id, request_no),
  KEY idx_welfare_emp_time (employee_id, requested_at),
  KEY idx_welfare_org_status (org_id, status),
  CONSTRAINT fk_welfare_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_welfare_wh FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE,
  CONSTRAINT fk_welfare_emp FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE welfare_request_items (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id       BIGINT UNSIGNED NOT NULL,
  product_id       BIGINT UNSIGNED NOT NULL,
  quantity         DECIMAL(14,3) NOT NULL,
  unit_cost        DECIMAL(14,2) NOT NULL DEFAULT 0,
  lot_allocations  JSON NULL COMMENT '[{lotId, qty, expiry, cost}] taken FEFO on approval',
  KEY idx_welfare_item_req (request_id),
  CONSTRAINT fk_welfare_item_req FOREIGN KEY (request_id) REFERENCES welfare_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_welfare_item_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- ACCOUNTING
-- =====================================================================

CREATE TABLE chart_of_accounts (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id      BIGINT UNSIGNED NOT NULL,
  code        VARCHAR(20)  NOT NULL,
  name        VARCHAR(191) NOT NULL,
  type        ENUM('asset','liability','equity','revenue','expense') NOT NULL,
  parent_id   BIGINT UNSIGNED NULL,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_coa_code (org_id, code),
  CONSTRAINT fk_coa_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_coa_parent FOREIGN KEY (parent_id) REFERENCES chart_of_accounts(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE journal_entries (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id      BIGINT UNSIGNED NOT NULL,
  entry_no    VARCHAR(32) NOT NULL,
  entry_date  DATE NOT NULL,
  description VARCHAR(500) NULL,
  ref_type    VARCHAR(50) NULL,
  ref_id      BIGINT UNSIGNED NULL,
  status      ENUM('draft','posted','void') NOT NULL DEFAULT 'posted',
  created_by  BIGINT UNSIGNED NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_je_no (org_id, entry_no),
  KEY idx_je_ref (org_id, ref_type, ref_id),
  KEY idx_je_date (org_id, entry_date),
  CONSTRAINT fk_je_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE journal_lines (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  entry_id    BIGINT UNSIGNED NOT NULL,
  account_id  BIGINT UNSIGNED NOT NULL,
  debit       DECIMAL(14,2) NOT NULL DEFAULT 0,
  credit      DECIMAL(14,2) NOT NULL DEFAULT 0,
  memo        VARCHAR(255) NULL,
  CONSTRAINT fk_jl_entry FOREIGN KEY (entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
  KEY idx_jl_account (account_id),
  CONSTRAINT fk_jl_account FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Simple income/expense ledger (what most SME owners interact with)
CREATE TABLE transactions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id          BIGINT UNSIGNED NOT NULL,
  branch_id       BIGINT UNSIGNED NULL,
  type            ENUM('income','expense') NOT NULL,
  category        VARCHAR(100) NOT NULL,
  account_id      BIGINT UNSIGNED NULL,
  amount          DECIMAL(14,2) NOT NULL COMMENT 'before VAT',
  vat_amount      DECIMAL(14,2) NOT NULL DEFAULT 0,
  vat_claimable   TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = has a full tax invoice, input VAT can be claimed',
  wht_amount      DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT 'withholding tax',
  wht_rate        DECIMAL(5,2) NULL,
  wht_income_type VARCHAR(10) NULL COMMENT 'Revenue Code section, e.g. 40(2), 40(5), 40(8)',
  txn_date        DATE NOT NULL,
  description     VARCHAR(500) NULL,
  counterparty    VARCHAR(191) NULL,
  counterparty_tax_id VARCHAR(20) NULL,
  counterparty_type ENUM('individual','company') NULL COMMENT 'PND3 = individual, PND53 = company',
  payment_method  VARCHAR(30) NULL,
  ref_type        VARCHAR(50) NULL,
  ref_id          BIGINT UNSIGNED NULL,
  document_id     BIGINT UNSIGNED NULL,
  receipt_file_id BIGINT UNSIGNED NULL,
  ai_extracted    TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'filled by AI receipt OCR',
  status          ENUM('posted','void') NOT NULL DEFAULT 'posted',
  created_by      BIGINT UNSIGNED NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_txn_date (org_id, txn_date),
  KEY idx_txn_wht (org_id, txn_date, wht_amount),
  CONSTRAINT fk_txn_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_txn_account FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  CONSTRAINT fk_txn_file FOREIGN KEY (receipt_file_id) REFERENCES files(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE documents (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id        BIGINT UNSIGNED NOT NULL,
  doc_type      ENUM('quotation','invoice','tax_invoice','receipt','tax_invoice_receipt','credit_note','debit_note','wht_certificate','purchase_order','expense_voucher') NOT NULL,
  doc_no        VARCHAR(40) NOT NULL,
  doc_date      DATE NOT NULL,
  due_date      DATE NULL,
  customer_id   BIGINT UNSIGNED NULL,
  supplier_id   BIGINT UNSIGNED NULL,
  party_name    VARCHAR(191) NULL,
  party_tax_id  VARCHAR(20)  NULL,
  party_address TEXT NULL,
  subtotal      DECIMAL(14,2) NOT NULL DEFAULT 0,
  discount      DECIMAL(14,2) NOT NULL DEFAULT 0,
  vat_amount    DECIMAL(14,2) NOT NULL DEFAULT 0,
  wht_amount    DECIMAL(14,2) NOT NULL DEFAULT 0,
  total         DECIMAL(14,2) NOT NULL DEFAULT 0,
  status        ENUM('draft','issued','paid','void') NOT NULL DEFAULT 'draft',
  paid_at       DATETIME NULL,
  payment_method VARCHAR(30) NULL,
  ref_doc_id    BIGINT UNSIGNED NULL,
  order_id      BIGINT UNSIGNED NULL,
  transaction_id BIGINT UNSIGNED NULL COMMENT 'source transaction for WHT certificates',
  pdf_file_id   BIGINT UNSIGNED NULL,
  note          TEXT NULL,
  created_by    BIGINT UNSIGNED NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_doc_no (org_id, doc_type, doc_no),
  KEY idx_doc_date (org_id, doc_date),
  CONSTRAINT fk_doc_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_doc_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  CONSTRAINT fk_doc_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
  CONSTRAINT fk_doc_order FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tax_invoice_requests (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id      BIGINT UNSIGNED NOT NULL,
  order_id    BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(191) NOT NULL,
  tax_id      VARCHAR(13) NOT NULL,
  branch_no   VARCHAR(5) NOT NULL DEFAULT '00000',
  address     VARCHAR(1000) NOT NULL,
  email       VARCHAR(191) NULL,
  status      ENUM('pending','issued') NOT NULL DEFAULT 'pending',
  document_id BIGINT UNSIGNED NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tir_order (order_id),
  KEY idx_tir_org_status (org_id, status),
  CONSTRAINT fk_tir_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_tir_order FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_tir_doc FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE document_items (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  document_id  BIGINT UNSIGNED NOT NULL,
  product_id   BIGINT UNSIGNED NULL,
  description  VARCHAR(500) NOT NULL,
  quantity     DECIMAL(14,3) NOT NULL DEFAULT 1,
  unit_price   DECIMAL(14,2) NOT NULL,
  discount     DECIMAL(14,2) NOT NULL DEFAULT 0,
  vat_type     ENUM('vat7','exempt','zero') NOT NULL DEFAULT 'vat7',
  line_total   DECIMAL(14,2) NOT NULL,
  CONSTRAINT fk_di_doc FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tax_reports (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id       BIGINT UNSIGNED NOT NULL,
  form_type    ENUM('PP30','PND1','PND3','PND53','PND50','PND51') NOT NULL,
  period_year  SMALLINT NOT NULL,
  period_month TINYINT NULL,
  data         JSON NULL COMMENT 'computed form values',
  status       ENUM('draft','ready','filed') NOT NULL DEFAULT 'draft',
  filed_at     DATETIME NULL,
  file_id      BIGINT UNSIGNED NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tax_period (org_id, form_type, period_year, period_month),
  CONSTRAINT fk_tax_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- UNIFIED INBOX / AI AGENT / RETURNS & DISPUTES
-- =====================================================================

CREATE TABLE channels (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id       BIGINT UNSIGNED NOT NULL,
  platform     ENUM('facebook','instagram','line','tiktok','shopee','website','email') NOT NULL,
  name         VARCHAR(191) NOT NULL,
  external_id  VARCHAR(191) NULL COMMENT 'page id / LINE channel id / shop id',
  ai_enabled   TINYINT(1) NOT NULL DEFAULT 1,
  is_active    TINYINT(1) NOT NULL DEFAULT 1,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_channel_ext (org_id, platform, external_id),
  CONSTRAINT fk_ch_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ai_agent_profiles (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id            BIGINT UNSIGNED NOT NULL,
  name              VARCHAR(100) NOT NULL,
  persona           TEXT NULL COMMENT 'tone, name, speaking style (e.g. ค่ะ/ครับ)',
  sales_rules       TEXT NULL,
  max_discount_pct  DECIMAL(5,2) NOT NULL DEFAULT 10 COMMENT 'upper bound AI may offer without approval',
  handoff_keywords  VARCHAR(500) NULL,
  is_default        TINYINT(1) NOT NULL DEFAULT 0,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_aap_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE conversations (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id            BIGINT UNSIGNED NOT NULL,
  channel_id        BIGINT UNSIGNED NOT NULL,
  customer_id       BIGINT UNSIGNED NULL,
  external_thread_id VARCHAR(191) NOT NULL COMMENT 'PSID / LINE userId / buyer id',
  customer_name     VARCHAR(191) NULL,
  status            ENUM('open','pending','resolved','closed') NOT NULL DEFAULT 'open',
  mode              ENUM('ai','human','hybrid') NOT NULL DEFAULT 'ai',
  handoff_reason    VARCHAR(255) NULL COMMENT 'why the AI handed this chat to a human',
  ai_lock_until     DATETIME NULL COMMENT 'claim so only one worker replies at a time',
  assigned_to       BIGINT UNSIGNED NULL,
  intent            VARCHAR(50) NULL COMMENT 'inquiry, purchase, return, complaint, ...',
  sentiment         ENUM('positive','neutral','negative') NULL,
  unread_count      INT NOT NULL DEFAULT 0,
  last_message_at   DATETIME NULL,
  last_customer_message_at DATETIME NULL COMMENT 'for Meta 24h window',
  last_ai_reply_at  DATETIME NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_conv_thread (channel_id, external_thread_id),
  KEY idx_conv_status (org_id, status, last_message_at),
  CONSTRAINT fk_conv_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_conv_channel FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  CONSTRAINT fk_conv_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  CONSTRAINT fk_conv_user FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE messages (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  conversation_id     BIGINT UNSIGNED NOT NULL,
  direction           ENUM('in','out') NOT NULL,
  sender_type         ENUM('customer','ai','agent','system') NOT NULL,
  sender_user_id      BIGINT UNSIGNED NULL,
  content             TEXT NULL,
  attachments         JSON NULL,
  external_message_id VARCHAR(191) NULL,
  delivery_status     ENUM('pending','sent','delivered','failed') NOT NULL DEFAULT 'sent',
  ai_meta             JSON NULL COMMENT 'model, tokens, tool calls',
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_msg_conv (conversation_id, created_at),
  KEY idx_msg_external (external_message_id),
  CONSTRAINT fk_msg_conv FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE returns (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id           BIGINT UNSIGNED NOT NULL,
  order_id         BIGINT UNSIGNED NULL,
  conversation_id  BIGINT UNSIGNED NULL,
  customer_id      BIGINT UNSIGNED NULL,
  reason           VARCHAR(100) NOT NULL,
  detail           TEXT NULL,
  resolution       ENUM('pending','refund','exchange','discount','store_credit','rejected') NOT NULL DEFAULT 'pending',
  resolution_note  TEXT NULL,
  amount           DECIMAL(14,2) NOT NULL DEFAULT 0,
  status           ENUM('requested','approved','received','completed','rejected') NOT NULL DEFAULT 'requested',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ret_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_ret_order FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE SET NULL,
  CONSTRAINT fk_ret_conv FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE disputes (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id           BIGINT UNSIGNED NOT NULL,
  order_id         BIGINT UNSIGNED NULL,
  conversation_id  BIGINT UNSIGNED NULL,
  platform         VARCHAR(30) NULL,
  external_dispute_id VARCHAR(100) NULL,
  category         VARCHAR(100) NOT NULL,
  summary          TEXT NULL,
  severity         ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
  status           ENUM('open','negotiating','resolved','escalated','lost') NOT NULL DEFAULT 'open',
  resolution_note  TEXT NULL,
  resolved_at      DATETIME NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_disp_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_disp_order FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE SET NULL,
  CONSTRAINT fk_disp_conv FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Offers the AI proposed (discounts / remedies) — auditable, with approval gate
CREATE TABLE ai_offers (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id           BIGINT UNSIGNED NOT NULL,
  conversation_id  BIGINT UNSIGNED NOT NULL,
  return_id        BIGINT UNSIGNED NULL,
  dispute_id       BIGINT UNSIGNED NULL,
  offer_type       ENUM('discount_code','partial_refund','free_shipping','gift','exchange') NOT NULL,
  value            DECIMAL(14,2) NOT NULL DEFAULT 0,
  discount_code_id BIGINT UNSIGNED NULL,
  rationale        TEXT NULL,
  status           ENUM('proposed','needs_approval','accepted','declined','expired') NOT NULL DEFAULT 'proposed',
  approved_by      BIGINT UNSIGNED NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_offer_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_offer_conv FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_offer_dc FOREIGN KEY (discount_code_id) REFERENCES discount_codes(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- SOCIAL / AI VIDEO / SCRAPING
-- =====================================================================

CREATE TABLE social_accounts (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id         BIGINT UNSIGNED NOT NULL,
  platform       ENUM('tiktok','facebook','instagram') NOT NULL,
  external_id    VARCHAR(191) NOT NULL COMMENT 'TikTok open_id / FB page id / IG user id',
  display_name   VARCHAR(191) NULL,
  avatar_url     VARCHAR(1000) NULL,
  credential_id  BIGINT UNSIGNED NULL,
  status         ENUM('connected','expired','error') NOT NULL DEFAULT 'connected',
  token_expires_at DATETIME NULL COMMENT 'UTC; NULL = does not expire',
  last_error     TEXT NULL,
  meta           JSON NULL COMMENT 'e.g. linked page id for Instagram',
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_social_acc (org_id, platform, external_id),
  CONSTRAINT fk_sa_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_sa_cred FOREIGN KEY (credential_id) REFERENCES integration_credentials(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE affiliate_links (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id        BIGINT UNSIGNED NOT NULL,
  product_id    BIGINT UNSIGNED NULL,
  label         VARCHAR(191) NULL,
  platform      ENUM('shopee','tiktok_shop','lazada','other') NOT NULL DEFAULT 'shopee',
  original_url  VARCHAR(1000) NOT NULL,
  short_url     VARCHAR(500) NULL,
  sub_id        VARCHAR(100) NULL COMMENT 'tracking sub id per post',
  clicks        INT NOT NULL DEFAULT 0,
  conversions   INT NOT NULL DEFAULT 0,
  commission    DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_aff_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_aff_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE video_projects (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id             BIGINT UNSIGNED NOT NULL,
  product_id         BIGINT UNSIGNED NULL,
  trending_product_id BIGINT UNSIGNED NULL,
  title              VARCHAR(255) NOT NULL,
  brief              JSON NULL COMMENT 'tone, length, audience, product facts used for the script',
  script             TEXT NULL,
  script_json        JSON NULL COMMENT 'scenes: voiceover, caption, visual, durationSec',
  post_caption       TEXT NULL,
  hashtags           VARCHAR(500) NULL,
  avatar_id          VARCHAR(100) NULL,
  voice_id           VARCHAR(100) NULL,
  voice_provider     VARCHAR(30) NULL,
  visual_mode        ENUM('ai_clips','product_images','my_footage') NOT NULL DEFAULT 'product_images',
  caption_style      VARCHAR(20) NOT NULL DEFAULT 'pop' COMMENT 'pop | clean | none (word-by-word captions)',
  cover_id           BIGINT UNSIGNED NULL COMMENT 'AI cover shown as the first frame',
  aspect_ratio       VARCHAR(10) NOT NULL DEFAULT '9:16',
  duration_sec       INT NULL,
  status             ENUM('draft','scripting','script_ready','voicing','generating_clips','rendering_avatar','compositing','parts_ready','ready','failed') NOT NULL DEFAULT 'draft',
  stage_detail       VARCHAR(255) NULL COMMENT 'human-readable progress',
  provider_job_ids   JSON NULL,
  output_file_id     BIGINT UNSIGNED NULL,
  output_url         VARCHAR(1000) NULL,
  subtitle_file_id   BIGINT UNSIGNED NULL,
  subtitle_srt       MEDIUMTEXT NULL,
  error              TEXT NULL,
  created_by         BIGINT UNSIGNED NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_vp_status (org_id, status),
  CONSTRAINT fk_vp_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_vp_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  CONSTRAINT fk_vp_output FOREIGN KEY (output_file_id) REFERENCES files(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE video_assets (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  video_project_id  BIGINT UNSIGNED NOT NULL,
  kind              ENUM('voice','avatar','broll','music','subtitle','thumbnail','final') NOT NULL,
  scene_index       INT NULL,
  provider          VARCHAR(30) NULL,
  external_id       VARCHAR(191) NULL COMMENT 'provider task / render id',
  status            ENUM('pending','processing','ready','failed') NOT NULL DEFAULT 'ready',
  duration_ms       INT NULL,
  file_id           BIGINT UNSIGNED NULL,
  external_url      VARCHAR(1000) NULL,
  meta              JSON NULL,
  error             TEXT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_va_project (video_project_id, kind, scene_index),
  CONSTRAINT fk_va_project FOREIGN KEY (video_project_id) REFERENCES video_projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_va_file FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE scheduled_posts (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id             BIGINT UNSIGNED NOT NULL,
  social_account_id  BIGINT UNSIGNED NOT NULL,
  video_project_id   BIGINT UNSIGNED NULL,
  media_file_id      BIGINT UNSIGNED NULL,
  media_url          VARCHAR(1000) NULL COMMENT 'public MP4 URL when not taken from a video project',
  caption            TEXT NULL,
  hashtags           VARCHAR(1000) NULL,
  affiliate_link_id  BIGINT UNSIGNED NULL,
  link_placement     ENUM('caption','bio','none') NOT NULL DEFAULT 'caption',
  scheduled_at       DATETIME NOT NULL COMMENT 'stored in UTC',
  privacy            VARCHAR(40) NOT NULL DEFAULT 'PUBLIC_TO_EVERYONE',
  platform_options   JSON NULL COMMENT 'TikTok privacy / interactions / commercial disclosure',
  is_ai_generated    TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'AIGC disclosure flag',
  status             ENUM('draft','scheduled','publishing','published','failed','cancelled') NOT NULL DEFAULT 'scheduled',
  job_id             BIGINT UNSIGNED NULL,
  attempts           INT NOT NULL DEFAULT 0,
  error              TEXT NULL,
  published_at       DATETIME NULL,
  created_by         BIGINT UNSIGNED NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_sp_due (status, scheduled_at),
  CONSTRAINT fk_sp_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_sp_account FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_sp_video FOREIGN KEY (video_project_id) REFERENCES video_projects(id) ON DELETE SET NULL,
  CONSTRAINT fk_sp_aff FOREIGN KEY (affiliate_link_id) REFERENCES affiliate_links(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE post_results (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  scheduled_post_id  BIGINT UNSIGNED NOT NULL,
  external_post_id   VARCHAR(191) NULL,
  permalink          VARCHAR(1000) NULL,
  status             VARCHAR(40) NULL COMMENT 'provider publish status',
  views              BIGINT NOT NULL DEFAULT 0,
  likes              BIGINT NOT NULL DEFAULT 0,
  comments           BIGINT NOT NULL DEFAULT 0,
  shares             BIGINT NOT NULL DEFAULT 0,
  fetched_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pr_post FOREIGN KEY (scheduled_post_id) REFERENCES scheduled_posts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE scrape_sources (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id      BIGINT UNSIGNED NOT NULL,
  platform    ENUM('tiktok_shop','shopee','shopee_affiliate','apify','custom_url','ai_search') NOT NULL,
  method      ENUM('official_api','scraping_service','http_fetch','ai_web_search') NOT NULL DEFAULT 'official_api',
  name        VARCHAR(191) NOT NULL,
  config      JSON NULL COMMENT 'category ids, keywords, url, actor id',
  schedule_cron VARCHAR(50) NULL COMMENT 'informational; executed by job queue',
  interval_hours INT NULL COMMENT 'auto-run every N hours; NULL = manual only',
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  last_run_at DATETIME NULL,
  last_error  TEXT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ss_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE scrape_runs (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  source_id    BIGINT UNSIGNED NOT NULL,
  status       ENUM('running','succeeded','failed') NOT NULL DEFAULT 'running',
  stage        VARCHAR(30) NULL COMMENT 'current step of a multi-step run (AI search)',
  items_found  INT NOT NULL DEFAULT 0,
  items_new    INT NOT NULL DEFAULT 0,
  external_run_id VARCHAR(191) NULL COMMENT 'e.g. Apify run id',
  state        JSON NULL COMMENT 'step state and result summary (AI search)',
  triggered_by BIGINT UNSIGNED NULL COMMENT 'user id; NULL = schedule',
  error        TEXT NULL,
  started_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at  DATETIME NULL,
  CONSTRAINT fk_sr_source FOREIGN KEY (source_id) REFERENCES scrape_sources(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE trending_products (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id          BIGINT UNSIGNED NOT NULL,
  source_id       BIGINT UNSIGNED NULL,
  platform        VARCHAR(30) NOT NULL,
  external_id     VARCHAR(191) NOT NULL,
  title           VARCHAR(500) NOT NULL,
  url             VARCHAR(1000) NULL,
  shop_name       VARCHAR(191) NULL,
  shop_rating     DECIMAL(3,2) NULL,
  shop_response_rate DECIMAL(5,2) NULL COMMENT '% chats answered within 24h',
  shop_ship48_rate DECIMAL(5,2) NULL COMMENT '% orders shipped within 48h',
  image_url       VARCHAR(1000) NULL,
  price           DECIMAL(14,2) NULL,
  sold_count      BIGINT NULL,
  sold_velocity   DECIMAL(14,2) NULL COMMENT 'units sold per day between snapshots',
  monthly_sold    BIGINT NULL COMMENT 'units sold last month',
  prev_monthly_sold BIGINT NULL COMMENT 'units sold the month before',
  rating          DECIMAL(3,2) NULL,
  review_count    INT NULL,
  media_review_count INT NULL COMMENT 'reviews with photos/videos',
  positive_review_pct DECIMAL(5,2) NULL COMMENT '4-5 star share of reviews',
  commission_rate DECIMAL(5,2) NULL,
  has_flash_sale  TINYINT(1) NULL,
  category        VARCHAR(191) NULL,
  category_rank   INT NULL COMMENT 'rank in the platform category best-seller list (30 days)',
  trend_score     DECIMAL(10,2) NULL,
  lifecycle_phase VARCHAR(2) NULL COMMENT '1-5 rising, A peak, B-E declining',
  phase_ratio     DECIMAL(7,2) NULL COMMENT 'sold as % of the category peak',
  phase_notes     JSON NULL,
  checklist       JSON NULL,
  checklist_passed TINYINT NULL,
  pick_score      DECIMAL(6,2) NULL COMMENT 'fit for affiliate selling, 0-100',
  manual_checks   JSON NULL COMMENT 'criteria confirmed by a person',
  status          ENUM('new','watching','imported','ignored') NOT NULL DEFAULT 'new',
  imported_product_id BIGINT UNSIGNED NULL,
  affiliate_link_id BIGINT UNSIGNED NULL,
  ai_analysis     JSON NULL,
  ai_analyzed_at  DATETIME NULL,
  raw             JSON NULL,
  first_seen_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_trend_ext (org_id, platform, external_id),
  KEY idx_trend_score (org_id, trend_score),
  KEY idx_trend_status (org_id, status),
  KEY idx_trend_pick (org_id, pick_score),
  KEY idx_trend_category (org_id, platform, category),
  CONSTRAINT fk_tp_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_tp_source FOREIGN KEY (source_id) REFERENCES scrape_sources(id) ON DELETE SET NULL,
  CONSTRAINT fk_tp_product FOREIGN KEY (imported_product_id) REFERENCES products(id) ON DELETE SET NULL,
  CONSTRAINT fk_tp_aff FOREIGN KEY (affiliate_link_id) REFERENCES affiliate_links(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE trend_category_benchmarks (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id      BIGINT UNSIGNED NOT NULL,
  platform    VARCHAR(30) NOT NULL,
  category    VARCHAR(191) NOT NULL,
  peak_sold   BIGINT NOT NULL COMMENT 'average units sold of the category #1-#2',
  source      ENUM('auto','manual') NOT NULL DEFAULT 'auto',
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_benchmark (org_id, platform, category),
  CONSTRAINT fk_tcb_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE channel_profiles (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id      BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(191) NOT NULL,
  persona     TEXT NOT NULL COMMENT 'who is behind the channel: age, job, hobbies, pets, style',
  interests   JSON NULL,
  audience    VARCHAR(500) NULL,
  on_camera   TINYINT(1) NOT NULL DEFAULT 0,
  ai_plan     JSON NULL,
  ai_planned_at DATETIME NULL,
  is_default  TINYINT(1) NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_cp_org (org_id),
  CONSTRAINT fk_cp_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE trending_snapshots (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  trending_product_id BIGINT UNSIGNED NOT NULL,
  captured_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  price               DECIMAL(14,2) NULL,
  sold_count          BIGINT NULL,
  rating              DECIMAL(3,2) NULL,
  commission_rate     DECIMAL(5,2) NULL,
  KEY idx_ts_product (trending_product_id, captured_at),
  CONSTRAINT fk_ts_product FOREIGN KEY (trending_product_id) REFERENCES trending_products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Gap-free document numbering per type and month (Revenue Department requires sequential numbers)
CREATE TABLE document_sequences (
  org_id    BIGINT UNSIGNED NOT NULL,
  doc_type  VARCHAR(40) NOT NULL,
  period    CHAR(6) NOT NULL COMMENT 'YYYYMM',
  last_no   INT NOT NULL DEFAULT 0 COMMENT 'last number issued',
  PRIMARY KEY (org_id, doc_type, period),
  CONSTRAINT fk_docseq_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- This file already contains every migration up to the one listed last
INSERT INTO schema_migrations (version) VALUES ('001_initial'), ('002_accounting'), ('003_inbox'), ('004_trends'), ('005_video'), ('006_social'), ('007_trend_lifecycle'), ('008_ai_search'), ('009_covers'), ('010_video_upgrade'), ('011_pos_retail'), ('012_stock_ops'), ('013_purchasing'), ('014_lots'), ('015_app_config'), ('016_discounts_returns'), ('017_branch_payment'), ('018_promotions'), ('019_welfare'), ('020_reversals'), ('021_pos_assist'), ('022_customer_receipt'), ('023_payment_gateway');

SET FOREIGN_KEY_CHECKS = 1;
