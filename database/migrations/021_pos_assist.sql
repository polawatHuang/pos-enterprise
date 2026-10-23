-- =====================================================================
-- 021_pos_assist — helps a new cashier at the till:
--   * users.pos_pin_hash: a manager's 4-6 digit PIN to approve refunds, voids and
--     price/discount overrides on a cashier's screen (bcrypt hash)
--   * products.open_price: an item whose price is typed at the sale and which keeps
--     no stock (e.g. photocopies, top-up fees, an item without a barcode)
-- For databases installed from schema.sql BEFORE this change.
-- Import once via phpMyAdmin > Import. Compatible with MySQL 8 / MariaDB 10.6+.
-- =====================================================================

ALTER TABLE users
  ADD COLUMN pos_pin_hash VARCHAR(100) NULL COMMENT 'manager PIN for till approvals (bcrypt)' AFTER password_hash;

ALTER TABLE products
  ADD COLUMN open_price TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'price typed at the sale, no stock kept' AFTER track_expiry;

INSERT INTO schema_migrations (version) VALUES ('021_pos_assist');
